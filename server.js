
"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;

console.log("Diagnóstico NEXO:", {
  DATABASE_URL_CONFIGURADA: Boolean(DATABASE_URL),
  SESSION_SECRET_CONFIGURADA: Boolean(SESSION_SECRET)
});

if (!DATABASE_URL || !SESSION_SECRET) {
  throw new Error(
    "Configure DATABASE_URL e SESSION_SECRET nas variáveis de ambiente do Render."
  );
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL)
    ? false
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("Erro inesperado no PostgreSQL:", err.message);
});

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

const channels = ["geral", "jogos", "tecnologia", "conversa"];

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Faça login para continuar."
    });
  }

  next();
}

function sameOrigin(req, res, next) {
  const origin = req.get("origin");

  if (origin) {
    try {
      const originUrl = new URL(origin);

      if (originUrl.host !== req.get("host")) {
        return res.status(403).json({
          error: "Origem da requisição não permitida."
        });
      }
    } catch {
      return res.status(403).json({
        error: "Origem inválida."
      });
    }
  }

  next();
}

function validatePassword(password) {
  if (password.length < 6) {
    return "A senha deve ter pelo menos 6 caracteres.";
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    return "A senha não pode ultrapassar 72 bytes.";
  }

  if (!/[A-Z]/.test(password)) {
    return "Inclua pelo menos uma letra maiúscula.";
  }

  if (!/[a-z]/.test(password)) {
    return "Inclua pelo menos uma letra minúscula.";
  }

  if (!/[0-9]/.test(password)) {
    return "Inclua pelo menos um número.";
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Inclua pelo menos um símbolo, como @, # ou !.";
  }

  return null;
}

app.get("/api/status", (req, res) => {
  res.json({
    app: "NEXO",
    status: "online"
  });
});

app.get("/api/channels", (req, res) => {
  res.json(channels);
});

app.get("/api/me", (req, res) => {
  res.json({
    authenticated: Boolean(req.session.user),
    user: req.session.user || null
  });
});

app.post("/api/register", sameOrigin, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: "O nome deve ter 3 a 24 caracteres: letras, números ou _."
      });
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        error: "Digite um e-mail válido."
      });
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      return res.status(400).json({
        error: passwordError
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, passwordHash]
    );

    const user = result.rows[0];

    await regenerateSession(req);
    req.session.user = user;
    await saveSession(req);

    res.status(201).json({ user });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Esse nome de usuário ou e-mail já está cadastrado."
      });
    }

    console.error("Erro no cadastro:", err.message);

    res.status(500).json({
      error: "Não foi possível criar a conta."
    });
  }
});

app.post("/api/login", sameOrigin, async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || "").trim();
    const password = String(req.body?.password || "");

    if (!identifier || !password || password.length > 1024) {
      return res.status(400).json({
        error: "Informe seu e-mail/usuário e sua senha."
      });
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE LOWER(email) = LOWER($1)
          OR LOWER(username) = LOWER($1)
       LIMIT 1`,
      [identifier]
    );

    const account = result.rows[0];

    const valid = account
      ? await bcrypt.compare(password, account.password_hash)
      : false;

    if (!valid) {
      return res.status(401).json({
        error: "E-mail/usuário ou senha incorretos."
      });
    }

    const user = {
      id: account.id,
      username: account.username,
      email: account.email
    };

    await regenerateSession(req);
    req.session.user = user;
    await saveSession(req);

    res.json({ user });
  } catch (err) {
    console.error("Erro no login:", err.message);

    res.status(500).json({
      error: "Não foi possível entrar."
    });
  }
});

app.post("/api/logout", sameOrigin, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        error: "Não foi possível sair."
      });
    }

    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    });

    res.json({ success: true });
  });
});

app.get("/api/messages/:channel", requireAuth, async (req, res) => {
  const channel = req.params.channel;

  if (!channels.includes(channel)) {
    return res.status(400).json({
      error: "Canal inválido."
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, message, channel, created_at
       FROM messages
       WHERE channel = $1
       ORDER BY id DESC
       LIMIT 100`,
      [channel]
    );

    res.json(result.rows.reverse());
  } catch (err) {
    console.error("Erro ao buscar mensagens:", err.message);

    res.status(500).json({
      error: "Não foi possível carregar as mensagens."
    });
  }
});

io.use((socket, next) => {
  const user = socket.request.session?.user;

  if (!user) {
    return next(new Error("Faça login para usar o chat."));
  }

  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  socket.on("join channel", async (channel) => {
    if (typeof channel !== "string" || !channels.includes(channel)) {
      return;
    }

    for (const room of socket.rooms) {
      if (channels.includes(room)) {
        socket.leave(room);
      }
    }

    socket.join(channel);
    socket.emit("channel joined", channel);

    try {
      const result = await pool.query(
        `SELECT id, username, message, channel, created_at
         FROM messages
         WHERE channel = $1
         ORDER BY id DESC
         LIMIT 100`,
        [channel]
      );

      socket.emit("chat history", result.rows.reverse());
    } catch (err) {
      console.error("Erro no histórico:", err.message);
      socket.emit("chat error", "Erro ao carregar o histórico.");
    }
  });

  socket.on("send message", async (data) => {
    try {
      if (!data || typeof data !== "object") return;

      const channel = data.channel;
      const message = typeof data.message === "string"
        ? data.message.trim()
        : "";

      if (!channels.includes(channel)) {
        return socket.emit("chat error", "Canal inválido.");
      }

      if (!socket.rooms.has(channel)) {
        return socket.emit(
          "chat error",
          "Entre no canal antes de enviar."
        );
      }

      if (!message || message.length > 2000) {
        return socket.emit(
          "chat error",
          "A mensagem deve ter de 1 a 2000 caracteres."
        );
      }

      const result = await pool.query(
        `INSERT INTO messages (username, message, channel)
         VALUES ($1, $2, $3)
         RETURNING id, username, message, channel, created_at`,
        [socket.user.username, message, channel]
      );

      io.to(channel).emit("chat message", result.rows[0]);
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err.message);
      socket.emit("chat error", "Não foi possível enviar a mensagem.");
    }
  });
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) NOT NULL UNIQUE,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      channel TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`NEXO online na porta ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Falha ao iniciar NEXO:", err.message);
  process.exit(1);
});

async function shutdown() {
  server.close();
  io.close();

  try {
    await pool.end();
  } catch (err) {
    console.error("Erro ao encerrar PostgreSQL:", err.message);
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
