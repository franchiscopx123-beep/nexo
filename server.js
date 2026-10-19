
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

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === "production";

const channels = [
  { id: "geral", name: "Geral", icon: "#" },
  { id: "jogos", name: "Jogos", icon: "#" },
  { id: "tecnologia", name: "Tecnologia", icon: "#" },
  { id: "conversa", name: "Conversa", icon: "#" }
];

console.log("Diagnóstico NEXO:", {
  DATABASE_URL_CONFIGURADA: Boolean(DATABASE_URL),
  SESSION_SECRET_CONFIGURADA: Boolean(SESSION_SECRET)
});

if (!DATABASE_URL || !SESSION_SECRET) {
  console.error(
    "Configure DATABASE_URL e SESSION_SECRET " +
    "em Environment no Render."
  );
  process.exit(1);
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL)
    ? false
    : { rejectUnauthorized: false }
});

pool.on("error", (err) => {
  console.error("Erro inesperado no banco:", err.message);
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
    secure: isProduction,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

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
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).json({
          error: "Origem não permitida."
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

function validChannel(channel) {
  return channels.some((item) => item.id === channel);
}

app.get("/api/status", (req, res) => {
  res.json({ app: "NEXO", status: "online" });
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
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: "Use um nome com 3 a 24 letras, números ou _."
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

    if (
      password.length < 10 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        error: "A senha deve ter 10 ou mais caracteres e até 72 bytes."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, hash]
    );

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        console.error("Erro ao criar sessão:", sessionError.message);
        return res.status(500).json({
          error: "Não foi possível iniciar a sessão."
        });
      }

      req.session.user = result.rows[0];

      req.session.save((saveError) => {
        if (saveError) {
          console.error("Erro ao salvar sessão:", saveError.message);
          return res.status(500).json({
            error: "Não foi possível salvar a sessão."
          });
        }

        res.status(201).json({ user: result.rows[0] });
      });
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Esse nome de usuário ou e-mail já existe."
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
    const identifier = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");

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
        error: "Usuário, e-mail ou senha incorretos."
      });
    }

    const user = {
      id: account.id,
      username: account.username,
      email: account.email
    };

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        console.error("Erro ao criar sessão:", sessionError.message);
        return res.status(500).json({
          error: "Não foi possível iniciar a sessão."
        });
      }

      req.session.user = user;

      req.session.save((saveError) => {
        if (saveError) {
          console.error("Erro ao salvar sessão:", saveError.message);
          return res.status(500).json({
            error: "Não foi possível salvar a sessão."
          });
        }

        res.json({ user });
      });
    });
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
        error: "Não foi possível encerrar a sessão."
      });
    }

    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax"
    });

    res.json({ success: true });
  });
});

app.get("/api/messages/:channel", requireAuth, async (req, res) => {
  const channel = req.params.channel;

  if (!validChannel(channel)) {
    return res.status(400).json({ error: "Canal inválido." });
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
    console.error("Erro ao carregar mensagens:", err.message);
    res.status(500).json({
      error: "Não foi possível carregar as mensagens."
    });
  }
});

io.use((socket, next) => {
  if (!socket.request.session?.user) {
    return next(new Error("Faça login para conectar ao chat."));
  }

  socket.user = socket.request.session.user;
  next();
});

io.on("connection", (socket) => {
  socket.on("join channel", async (channel) => {
    if (typeof channel !== "string" || !validChannel(channel)) return;

    for (const room of socket.rooms) {
      if (validChannel(room)) socket.leave(room);
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

  socket.on("send message", async (data, callback) => {
    try {
      if (!data || typeof data !== "object") return;

      const channel = data.channel;
      const message = typeof data.message === "string"
        ? data.message.trim()
        : "";

      if (!validChannel(channel) || !socket.rooms.has(channel)) {
        return socket.emit("chat error", "Entre em um canal válido.");
      }

      if (!message || message.length > 2000) {
        return socket.emit(
          "chat error",
          "A mensagem deve ter entre 1 e 2000 caracteres."
        );
      }

      const result = await pool.query(
        `INSERT INTO messages (username, message, channel)
         VALUES ($1, $2, $3)
         RETURNING id, username, message, channel, created_at`,
        [socket.user.username, message, channel]
      );

      io.to(channel).emit("chat message", result.rows[0]);

      if (typeof callback === "function") callback({ ok: true });
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err.message);
      socket.emit("chat error", "Não foi possível enviar a mensagem.");

      if (typeof callback === "function") {
        callback({ ok: false });
      }
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

  await pool.query("SELECT 1");

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
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
