
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
    const password = req.body.password;

    if (!identifier || typeof password !== "string") {
      return res.status(400).json({
        error: "Informe usuário/e-mail e senha."
      });
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($1)
       LIMIT 1`,
      [identifier]
    );

    const record = result.rows[0];

    if (!record || !(await bcrypt.compare(password, record.password_hash))) {
      return res.status(401).json({
        error: "Usuário ou senha incorretos."
      });
    }

    const user = publicUser(record);
    req.session.user = user;

    await saveSession(req);

    res.json({ user });
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ error: "Não foi possível entrar na sua conta." });
  }
});

app.post("/api/logout", sameOrigin, (req, res) => {
  req.session.destroy(error => {
    if (error) {
      console.error("Erro ao encerrar sessão:", error);
      return res.status(500).json({
        error: "Não foi possível sair da conta."
      });
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

  if (!validChannel(channel)) {
    return res.status(404).json({ error: "Canal não encontrado." });
  }

  try {
    res.json(await getChannelMessages(channel));
  } catch (error) {
    console.error("Erro ao buscar mensagens:", error);
    res.status(500).json({
      error: "Não foi possível carregar as mensagens."
    });
  }
});

// -----------------------------------------------------------------------------
// Socket.IO: autenticação e presença
// -----------------------------------------------------------------------------

io.use((socket, next) => {
  const user = socket.request.session?.user;

  if (!user) {
    return next(new Error("Faça login para conectar ao chat."));
  }

  socket.user = user;
  next();
});

const typingByChannel = new Map();

function getTypingMap(channel) {
  if (!typingByChannel.has(channel)) {
    typingByChannel.set(channel, new Map());
  }

  return typingByChannel.get(channel);
}

function broadcastTyping(channel) {
  const users = [...new Set([...getTypingMap(channel).values()])];

  io.to(channel).emit("typing users", { channel, users });
}

function removeTyping(socket, channel) {
  const typing = typingByChannel.get(channel);

  if (!typing) return;

  typing.delete(socket.id);

  if (typing.size === 0) {
    typingByChannel.delete(channel);
  }

  broadcastTyping(channel);
}

async function broadcastOnlineUsers(channel) {
  try {
    const clients = await io.in(channel).fetchSockets();
    const uniqueUsers = new Map();

    for (const client of clients) {
      if (!client.user) continue;

      uniqueUsers.set(String(client.user.id), {
        id: client.user.id,
        username: client.user.username
      });
    }

    io.to(channel).emit("online users", {
      channel,
      users: [...uniqueUsers.values()]
    });
  } catch (error) {
    console.error("Erro ao atualizar usuários online:", error);
  }
}

io.on("connection", socket => {
  socket.data.lastMessageAt = 0;

  socket.on("join channel", async channel => {
    if (!validChannel(channel)) {
      emitError(socket, "Canal inválido.");
      return;
    }

    const previousChannel = socket.currentChannel;

    if (previousChannel && previousChannel !== channel) {
      removeTyping(socket, previousChannel);
      socket.leave(previousChannel);
    }

    socket.join(channel);
    socket.currentChannel = channel;

    try {
      const messages = await getChannelMessages(channel);

      socket.emit("channel joined", { channel });
      socket.emit("chat history", messages);

      await broadcastOnlineUsers(channel);
      broadcastTyping(channel);
    } catch (error) {
      console.error("Erro ao carregar histórico via Socket.IO:", error);
      emitError(socket, "Não foi possível carregar o histórico.");
    }
  });

  socket.on("typing", payload => {
    const channel = payload?.channel;

    if (
      !validChannel(channel) ||
      socket.currentChannel !== channel ||
      !socket.rooms.has(channel)
    ) {
      return;
    }

    const typing = getTypingMap(channel);

    if (payload.isTyping === true) {
      typing.set(socket.id, socket.user.username);
    } else {
      typing.delete(socket.id);
    }

    if (typing.size === 0) {
      typingByChannel.delete(channel);
    }

    broadcastTyping(channel);
  });

  // Enviar mensagens: aceita "message" e "content".
  socket.on("send message", async (payload, callback) => {
    try {
      const channel = payload?.channel;
      const message = typeof payload?.message === "string"
        ? payload.message.trim()
        : typeof payload?.content === "string"
          ? payload.content.trim()
          : "";

      if (!validChannel(channel)) {
        return asyncReply(callback, { error: "Canal inválido." });
      }

      if (
        socket.currentChannel !== channel ||
        !socket.rooms.has(channel)
      ) {
        return asyncReply(callback, {
          error: "Entre no canal antes de enviar mensagens."
        });
      }

      if (!validMessage(message)) {
        return asyncReply(callback, {
          error: "A mensagem deve ter entre 1 e 2000 caracteres."
        });
      }

      const now = Date.now();

      if (now - socket.data.lastMessageAt < MESSAGE_COOLDOWN_MS) {
        return asyncReply(callback, {
          error: "Espere um instante antes de enviar outra mensagem."
        });
      }

      socket.data.lastMessageAt = now;

      const result = await pool.query(
        `INSERT INTO messages (user_id, username, message, channel)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, username, message, channel,
                   created_at, updated_at`,
        [socket.user.id, socket.user.username, message, channel]
      );

      const saved = result.rows[0];

      io.to(channel).emit("chat message", saved);
      removeTyping(socket, channel);

      asyncReply(callback, { ok: true, message: saved });
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      asyncReply(callback, {
        error: "Não foi possível enviar a mensagem."
      });
    }
  });

  // Editar mensagens próprias.
  socket.on("edit message", async (payload, callback) => {
    try {
      const id = Number(payload?.id);
      const channel = payload?.channel;
      const message = typeof payload?.message === "string"
        ? payload.message.trim()
        : typeof payload?.content === "string"
          ? payload.content.trim()
          : "";

      if (!Number.isSafeInteger(id) || id <= 0) {
        return asyncReply(callback, {
          error: "Identificador de mensagem inválido."
        });
      }

      if (
        !validChannel(channel) ||
        socket.currentChannel !== channel ||
        !socket.rooms.has(channel)
      ) {
        return asyncReply(callback, {
          error: "Canal inválido ou não selecionado."
        });
      }

      if (!validMessage(message)) {
        return asyncReply(callback, {
          error: "A mensagem deve ter entre 1 e 2000 caracteres."
        });
      }

      const result = await pool.query(
        `UPDATE messages
         SET message = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3 AND channel = $4
         RETURNING id, user_id, username, message, channel,
                   created_at, updated_at`,
        [message, id, socket.user.id, channel]
      );

      if (!result.rowCount) {
        return asyncReply(callback, {
          error: "Mensagem não encontrada ou você não pode editá-la."
        });
      }

      const updated = result.rows[0];

      io.to(channel).emit("message updated", updated);
      asyncReply(callback, { ok: true, message: updated });
    } catch (error) {
      console.error("Erro ao editar mensagem:", error);
      asyncReply(callback, { error: "Não foi possível editar a mensagem." });
    }
  });

  // Excluir mensagens próprias.
  socket.on("delete message", async (payload, callback) => {
    try {
      const id = Number(payload?.id);
      const channel = payload?.channel;

      if (!Number.isSafeInteger(id) || id <= 0) {
        return asyncReply(callback, {
          error: "Identificador de mensagem inválido."
        });
      }

      if (
        !validChannel(channel) ||
        socket.currentChannel !== channel ||
        !socket.rooms.has(channel)
      ) {
        return asyncReply(callback, {
          error: "Canal inválido ou não selecionado."
        });
      }

      const result = await pool.query(
        `DELETE FROM messages
         WHERE id = $1 AND user_id = $2 AND channel = $3
         RETURNING id, channel`,
        [id, socket.user.id, channel]
      );

      if (!result.rowCount) {
        return asyncReply(callback, {
          error: "Mensagem não encontrada ou você não pode excluí-la."
        });
      }

      const deleted = result.rows[0];

      io.to(channel).emit("message deleted", {
        id: deleted.id,
        channel: deleted.channel
      });

      asyncReply(callback, { ok: true, id: deleted.id });
    } catch (error) {
      console.error("Erro ao excluir mensagem:", error);
      asyncReply(callback, { error: "Não foi possível excluir a mensagem." });
    }
  });

  socket.on("disconnecting", () => {
    for (const room of socket.rooms) {
      if (CHANNELS.includes(room)) {
        removeTyping(socket, room);
      }
    }
  });

  socket.on("disconnect", async () => {
    for (const channel of CHANNELS) {
      await broadcastOnlineUsers(channel);
    }
  });
});

// -----------------------------------------------------------------------------
// Inicialização do PostgreSQL e servidor
// -----------------------------------------------------------------------------

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

  // Migrações seguras para instalações existentes.
  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
  `);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`NEXO está rodando na porta ${PORT}`);
  });
}

start().catch(error => {
  console.error("Não foi possível iniciar o NEXO:", error);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  server.close();
  await pool.end();
  process.exit(0);
});
