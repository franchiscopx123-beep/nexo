
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
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!DATABASE_URL || !SESSION_SECRET) {
  console.error("Configure DATABASE_URL e SESSION_SECRET nas variáveis de ambiente.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : undefined
});

const CHANNELS = ["geral", "jogos", "tecnologia", "conversa"];

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
    const requestHost = req.get("host");

    if (originUrl.host !== requestHost) {
      return res.status(403).json({ error: "Origem da requisição não permitida." });
    }
  } catch {
    return res.status(403).json({ error: "Origem inválida." });
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Você precisa entrar na sua conta." });
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
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

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
    const password = req.body.password;

    if (!identifier || typeof password !== "string") {
      return res.status(400).json({ error: "Informe usuário/e-mail e senha." });
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)
       LIMIT 1`,
      [identifier]
    );

    const userRecord = result.rows[0];
    if (!userRecord || !(await bcrypt.compare(password, userRecord.password_hash))) {
      return res.status(401).json({ error: "Usuário ou senha incorretos." });
    }

    const user = publicUser(userRecord);
    req.session.user = user;
    await saveSession(req);

    res.json({ user });
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ error: "Não foi possível entrar na sua conta." });
  }
});

app.post("/api/logout", sameOrigin, (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Erro ao encerrar sessão:", error);
      return res.status(500).json({ error: "Não foi possível sair da conta." });
    }

    res.clearCookie("connect.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    res.json({ ok: true });
  });
});

app.get("/api/messages/:channel", requireAuth, async (req, res) => {
  const channel = req.params.channel;
  if (!CHANNELS.includes(channel)) {
    return res.status(404).json({ error: "Canal não encontrado." });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, message, channel, created_at
       FROM messages
       WHERE channel = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [channel]
    );

    res.json(result.rows.reverse());
  } catch (error) {
    console.error("Erro ao buscar mensagens:", error);
    res.status(500).json({ error: "Não foi possível carregar as mensagens." });
  }
});

io.use((socket, next) => {
  const user = socket.request.session?.user;
  if (!user) return next(new Error("Faça login para conectar ao chat."));
  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  socket.on("join channel", async (channel) => {
    if (typeof channel !== "string" || !CHANNELS.includes(channel)) {
      socket.emit("error message", { error: "Canal inválido." });
      return;
    }

    for (const room of socket.rooms) {
      if (CHANNELS.includes(room)) socket.leave(room);
    }

    socket.join(channel);
    socket.currentChannel = channel;

    try {
      const result = await pool.query(
        `SELECT id, username, message, channel, created_at
         FROM messages
         WHERE channel = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [channel]
      );

      socket.emit("channel joined", { channel });
      socket.emit("chat history", result.rows.reverse());
    } catch (error) {
      console.error("Erro ao carregar histórico:", error);
      socket.emit("error message", { error: "Não foi possível carregar o histórico." });
    }
  });

  socket.on("send message", async (payload, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};

    try {
      const channel = payload?.channel;
      const message = typeof payload?.message === "string"
        ? payload.message.trim()
        : "";

      if (!CHANNELS.includes(channel)) {
        return reply({ error: "Canal inválido." });
      }

      if (socket.currentChannel !== channel || !socket.rooms.has(channel)) {
        return reply({ error: "Entre no canal antes de enviar mensagens." });
      }

      if (!message || message.length > 2000) {
        return reply({ error: "A mensagem deve ter entre 1 e 2000 caracteres." });
      }

      const username = socket.user.username;

      const result = await pool.query(
        `INSERT INTO messages (username, message, channel)
         VALUES ($1, $2, $3)
         RETURNING id, username, message, channel, created_at`,
        [username, message, channel]
      );

      io.to(channel).emit("chat message", result.rows[0]);
      reply({ ok: true });
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      reply({ error: "Não foi possível enviar a mensagem." });
    }
  });
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(24) NOT NULL UNIQUE,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) NOT NULL,
      message TEXT NOT NULL,
      channel VARCHAR(40) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`NEXO está rodando na porta ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Não foi possível iniciar o NEXO:", error);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  server.close();
  await pool.end();
  process.exit(0);
});
