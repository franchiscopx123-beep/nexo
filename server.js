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

      asyncReply(callback, {
        error: "Não foi possível editar a mensagem."
      });
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

      asyncReply(callback, {
        error: "Não foi possível excluir a mensagem."
      });
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

  // Migrações para instalações existentes.
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
