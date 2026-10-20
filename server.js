"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();

// Necessário para reconhecer HTTPS atrás do proxy do Render.
app.set("trust proxy", 1);

const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!DATABASE_URL || !SESSION_SECRET) {
  console.error(
    "Configure DATABASE_URL e SESSION_SECRET nas variáveis de ambiente."
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : undefined
});

const CHANNELS = ["geral", "jogos", "tecnologia", "conversa"];
const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_COOLDOWN_MS = 400;

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));

const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: true
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, "public")));

function sameOrigin(req, res, next) {
  const origin = req.get("origin");

  if (!origin) return next();

  try {
    const originUrl = new URL(origin);

    if (originUrl.host !== req.get("host")) {
      return res.status(403).json({
        error: "Origem da requisição não permitida."
      });
    }
  } catch {
    return res.status(403).json({ error: "Origem inválida." });
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Você precisa entrar na sua conta."
    });
  }

  next();
}

function validPassword(password) {
  return typeof password === "string"
    && password.length >= 6
    && Buffer.byteLength(password, "utf8") <= 72
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

function validChannel(channel) {
  return typeof channel === "string" && CHANNELS.includes(channel);
}

function validMessage(message) {
  return typeof message === "string"
    && message.trim().length > 0
    && message.trim().length <= MAX_MESSAGE_LENGTH;
}

function asyncReply(callback, data) {
  if (typeof callback === "function") callback(data);
}

function emitError(socket, message) {
  socket.emit("error message", { error: message });
}

async function getChannelMessages(channel) {
  const result = await pool.query(
    `SELECT id, user_id, username, message, channel, created_at, updated_at
     FROM (
       SELECT id, user_id, username, message, channel, created_at, updated_at
       FROM messages
       WHERE channel = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [channel]
  );

  return result.rows;
}

// -----------------------------------------------------------------------------
// API HTTP
// -----------------------------------------------------------------------------

app.get("/api/status", (req, res) => {
  res.json({ ok: true, name: "NEXO" });
});

app.get("/api/channels", (req, res) => {
  res.json(CHANNELS);
});

app.get("/api/me", (req, res) => {
  res.json({
    authenticated: Boolean(req.session.user),
    user: req.session.user || null
  });
});

app.post("/api/register", sameOrigin, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: "O usuário deve ter de 3 a 24 caracteres: letras, números ou _."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Digite um e-mail válido." });
    }

    if (!validPassword(password)) {
      return res.status(400).json({
        error: "A senha deve ter pelo menos 6 caracteres e incluir maiúscula, minúscula, número e símbolo."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, passwordHash]
    );

    const user = publicUser(result.rows[0]);
    req.session.user = user;

    await saveSession(req);

    res.status(201).json({ user });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Este nome de usuário ou e-mail já está cadastrado."
      });
    }

    console.error("Erro no cadastro:", error);
    res.status(500).json({ error: "Não foi possível criar sua conta." });
  }
});

app.post("/api/login", sameOrigin, async (req, res) => {
  try {
    const identifier = String(req.body.identifier || "").trim();
