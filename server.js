
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
const isProduction = process.env.NODE_ENV === "production";

const CHANNELS = ["geral", "jogos", "tecnologia", "conversa"];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && isProduction
      ? { rejectUnauthorized: false }
      : undefined,
});

if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

// --------------------------------------------------
// BANCO DE DADOS
// --------------------------------------------------

async function initializeDatabase() {
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
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username VARCHAR(24) NOT NULL,
      message TEXT NOT NULL,
      channel VARCHAR(32) NOT NULL DEFAULT 'geral',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  // Compatibilidade com tabelas messages mais antigas.
  await pool.query(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS user_id INTEGER
        REFERENCES users(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_channel_created
    ON messages(channel, created_at)
  `);

  console.log("Banco de dados inicializado.");
}

// --------------------------------------------------
// SESSÕES
// --------------------------------------------------

const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  }),
  name: "connect.sid",
  secret: process.env.SESSION_SECRET || "troque-esta-chave-no-arquivo-env",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

io.engine.use(sessionMiddleware);

// --------------------------------------------------
// ARQUIVOS DO SITE
// --------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --------------------------------------------------
// FUNÇÕES AUXILIARES
// --------------------------------------------------

function sameOrigin(req, res, next) {
  const origin = req.get("origin");

  if (!origin) {
    return next();
  }

  try {
    const originUrl = new URL(origin);
    const requestHost = req.get("host");

    if (originUrl.host !== requestHost) {
      return res.status(403).json({
        error: "Origem da requisição não permitida.",
      });
    }
  } catch {
    return res.status(403).json({
      error: "Origem inválida.",
    });
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      error: "Faça login para continuar.",
    });
  }

  next();
}

function validChannel(channel) {
  return typeof channel === "string" && CHANNELS.includes(channel);
}

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 72
  );
}

function validMessage(message) {
  return (
    typeof message === "string" &&
    message.trim().length > 0 &&
    message.length <= 2000
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    created_at: user.created_at,
  };
}

function emitError(socket, message) {
  socket.emit("error message", { error: message });
}


function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

// --------------------------------------------------
// API
// --------------------------------------------------

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    name: "NEXO",
    channels: CHANNELS,
  });
});

app.get("/api/channels", (req, res) => {
  res.json(CHANNELS.map((name) => ({ name, channel: name })));
});

app.get("/api/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({
      error: "Você não está conectado.",
    });
  }

  res.json({
    user: req.session.user,
  });
});

// Cadastro
app.post("/api/register", sameOrigin, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({
      error:
        "O nome de usuário deve ter de 3 a 24 caracteres, usando letras, números ou _.",
    });
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      error: "Informe um e-mail válido.",
    });
  }

  if (!validPassword(password)) {
    return res.status(400).json({
      error: "A senha deve ter entre 8 e 72 caracteres.",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );

    const user = publicUser(result.rows[0]);

    req.session.user = user;
    await saveSession(req);

    res.status(201).json({
      ok: true,
      user,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Este nome de usuário ou e-mail já está cadastrado.",
      });
    }

    console.error("Erro no cadastro:", error);

    res.status(500).json({
      error: "Não foi possível criar a conta.",
    });
  }
});

// Login: aceita e-mail ou nome de usuário em identifier.
app.post("/api/login", sameOrigin, async (req, res) => {
  const identifier =
    typeof req.body?.identifier === "string"
      ? req.body.identifier.trim()
      : "";

  const password = req.body?.password;

  if (!identifier || typeof password !== "string") {
    return res.status(400).json({
      error: "Informe seu usuário ou e-mail e sua senha.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, email, password_hash, created_at
       FROM users
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($1)
       LIMIT 1`,
      [identifier]
    );

    const account = result.rows[0];

    if (!account || !(await bcrypt.compare(password, account.password_hash))) {
      return res.status(401).json({
        error: "Usuário, e-mail ou senha incorretos.",
      });
    }

    // Regenera a sessão para reduzir o risco de session fixation.
    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const user = publicUser(account);
    req.session.user = user;

    await saveSession(req);

    res.json({
      ok: true,
      user,
    });
  } catch (error) {
    console.error("Erro no login:", error);

    res.status(500).json({
      error: "Não foi possível entrar na conta.",
    });
  }
});

// Logout
app.post("/api/logout", sameOrigin, (req, res) => {
  if (!req.session) {
    res.clearCookie("connect.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    });

    return res.json({ ok: true });
  }

  req.session.destroy((error) => {
    if (error) {
      console.error("Erro ao encerrar sessão:", error);

      return res.status(500).json({
        error: "Não foi possível sair da conta.",
      });
    }

    res.clearCookie("connect.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    });

    res.json({ ok: true });
  });
});

// Histórico das mensagens
app.get(
  "/api/messages/:channel",
  requireAuth,
  async (req, res) => {
    const channel = req.params.channel;

    if (!validChannel(channel)) {
      return res.status(404).json({
        error: "Canal não encontrado.",
      });
    }

    try {
      const messages = await getChannelMessages(channel);
      res.json(messages);
    } catch (error) {
      console.error("Erro ao carregar mensagens:", error);

      res.status(500).json({
        error: "Não foi possível carregar as mensagens.",
      });
    }
  }
);

// --------------------------------------------------
// SOCKET.IO: AUTENTICAÇÃO
// --------------------------------------------------

io.use((socket, next) => {
  const user = socket.request.session?.user;

  if (!user) {
    return next(new Error("Faça login para conectar ao chat."));
  }

  socket.user = user;
  next();
});

// --------------------------------------------------
// SOCKET.IO: CHAT, PRESENÇA E DIGITAÇÃO
// --------------------------------------------------

const onlineSockets = new Map();
const typingByChannel = new Map();
const lastMessageAt = new Map();


function getOnlineUsers() {
  const uniqueUsers = new Map();

  for (const user of onlineSockets.values()) {
    uniqueUsers.set(String(user.id), {
      id: user.id,
      username: user.username,
    });
  }

  return Array.from(uniqueUsers.values());
}

function broadcastOnlineUsers() {
  io.emit("online users", getOnlineUsers());
}

function removeTyping(socket, channel) {
  const users = typingByChannel.get(channel);

  if (!users) return;

  users.delete(socket.id);

  if (users.size === 0) {
    typingByChannel.delete(channel);
  }

  io.to(channel).emit(
    "typing users",
    Array.from(typingByChannel.get(channel)?.values() || [])
  );
}

io.on("connection", (socket) => {
  const user = socket.user;

  onlineSockets.set(socket.id, {
    id: user.id,
    username: user.username,
  });

  broadcastOnlineUsers();

  socket.on("join channel", async (channel) => {
    if (!validChannel(channel)) {
      emitError(socket, "Canal inválido.");
      return;
    }

    try {
      if (socket.currentChannel) {
        const previous = socket.currentChannel;

        removeTyping(socket, previous);
        socket.leave(previous);
      }

      socket.join(channel);
      socket.currentChannel = channel;

      const messages = await getChannelMessages(channel);

      socket.emit("channel joined", { channel });
      socket.emit("chat history", messages);
    } catch (error) {
      console.error("Erro ao entrar no canal:", error);
      emitError(socket, "Não foi possível abrir este canal.");
    }
  });

  socket.on("typing", (payload) => {
    const channel =
      typeof payload === "string" ? payload : payload?.channel;

    if (
      !validChannel(channel) ||
      socket.currentChannel !== channel ||
      !socket.rooms.has(channel)
    ) {
      return;
    }

    if (!typingByChannel.has(channel)) {
      typingByChannel.set(channel, new Map());
    }

    typingByChannel.get(channel).set(socket.id, {
      id: user.id,
      username: user.username,
    });

    io.to(channel).emit(
      "typing users",
      Array.from(typingByChannel.get(channel).values())
    );
  });

  socket.on("stop typing", (payload) => {
    const channel =
      typeof payload === "string"
        ? payload
        : payload?.channel || socket.currentChannel;

    if (validChannel(channel)) {
      removeTyping(socket, channel);
    }
  });

  socket.on("send message", async (payload, callback) => {
    const reply = (data) => {
      if (typeof callback === "function") callback(data);
    };

    const channel = payload?.channel;

    const message =
      typeof payload?.message === "string"
        ? payload.message.trim()
        : typeof payload?.content === "string"
          ? payload.content.trim()
          : "";

    if (!validChannel(channel)) {
      reply({ ok: false, error: "Canal inválido." });
      return;
    }

    if (
      socket.currentChannel !== channel ||
      !socket.rooms.has(channel)
    ) {
      reply({
        ok: false,
        error: "Entre no canal antes de enviar mensagens.",
      });
      return;
    }

    if (!validMessage(message)) {
      reply({
        ok: false,
        error: "A mensagem deve ter entre 1 e 2000 caracteres.",
      });
      return;
    }

    // Pequeno intervalo entre mensagens para reduzir spam.
    const now = Date.now();
    const previousTime = lastMessageAt.get(socket.id) || 0;

    if (now - previousTime < 500) {
      reply({
        ok: false,
        error: "Espere um instante antes de enviar outra mensagem.",
      });
      return;
    }

    lastMessageAt.set(socket.id, now);

    try {
      const result = await pool.query(
        `INSERT INTO messages (user_id, username, message, channel)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, username, message, channel,
                   created_at, updated_at`,
        [user.id, user.username, message, channel]
      );

      const savedMessage = result.rows[0];

      io.to(channel).emit("chat message", savedMessage);

      removeTyping(socket, channel);

      reply({
        ok: true,
        message: savedMessage,
      });
    } catch (error) {
      console.error("Erro ao salvar mensagem:", error);

      reply({
        ok: false,
        error: "Não foi possível enviar a mensagem.",
      });
    }
  });

  // Retransmite eventos de chamadas apenas entre usuários autenticados.
  // O cliente deve validar a identidade e o contexto da chamada.
  const callEvents = [
    "call:request",
    "call:accept",
    "call:decline",
    "call:offer",
    "call:answer",
    "call:ice-candidate",
    "call:end",
    "call:busy",
  ];

  for (const eventName of callEvents) {
    socket.on(eventName, (payload = {}) => {
      const targetId = payload?.targetId;

      if (!targetId) return;

      for (const [socketId, onlineUser] of onlineSockets.entries()) {
        if (
          String(onlineUser.id) === String(targetId) &&
          socketId !== socket.id
        ) {
          io.to(socketId).emit(eventName, {
            ...payload,
            from: {
              id: user.id,
              username: user.username,
            },
          });
        }
      }
    });
  }

  socket.on("disconnect", () => {
    onlineSockets.delete(socket.id);

    if (socket.currentChannel) {
      removeTyping(socket, socket.currentChannel);
    }

    lastMessageAt.delete(socket.id);
    broadcastOnlineUsers();
  });
});

// --------------------------------------------------
// ERROS
// --------------------------------------------------

app.use((err, req, res, next) => {
  console.error("Erro inesperado:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Ocorreu um erro interno no servidor.",
  });
});

// --------------------------------------------------
// INICIALIZAÇÃO
// --------------------------------------------------

async function startServer() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL não foi definida no arquivo .env."
      );
    }

    if (
      isProduction &&
      (!process.env.SESSION_SECRET ||
        process.env.SESSION_SECRET.length < 32)
    ) {
      throw new Error(
        "Defina SESSION_SECRET com pelo menos 32 caracteres no ambiente de produção."
      );
    }

    await pool.query("SELECT 1");
    await initializeDatabase();

    server.listen(PORT, () => {
      console.log(`NEXO rodando na porta ${PORT}`);
      console.log(`Ambiente: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("Não foi possível iniciar o NEXO:", error.message);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});

startServer();
