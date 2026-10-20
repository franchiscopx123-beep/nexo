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

  // Sala privada por usuário para encaminhar sinalização de chamadas de voz.
  socket.join("user:" + String(socket.user.id));

  function relayCallEvent(incomingEvent, outgoingEvent) {
    socket.on(incomingEvent, payload => {
      const targetUserId = payload?.targetUserId;

      if (
        targetUserId === undefined ||
        targetUserId === null ||
        String(targetUserId) === String(socket.user.id)
      ) {
        return;
      }

      const forwarded = {
        ...payload,
        targetUserId: undefined,
        fromUserId: socket.user.id,
        fromUsername: socket.user.username
      };

      io.to("user:" + String(targetUserId)).emit(outgoingEvent, forwarded);
    });
  }

  // Solicitação inicial da chamada.
  socket.on("call:request", async (payload, callback) => {
    const targetUserId = payload?.targetUserId;

    if (
      targetUserId === undefined ||
      targetUserId === null ||
      String(targetUserId) === String(socket.user.id)
    ) {
      return asyncReply(callback, {
        error: "Selecione uma pessoa válida para ligar."
      });
    }

    try {
      const targets = await io
        .in("user:" + String(targetUserId))
        .fetchSockets();

      if (!targets.length) {
        return asyncReply(callback, {
          error: "Essa pessoa não está conectada agora."
        });
      }

      io.to("user:" + String(targetUserId)).emit("call:request", {
        fromUserId: socket.user.id,
        fromUsername: socket.user.username
      });

      asyncReply(callback, { ok: true });
    } catch (error) {
      console.error("Erro ao encaminhar chamada:", error);

      asyncReply(callback, {
        error: "Não foi possível iniciar a chamada."
      });
    }
  });

  // Eventos de sinalização WebRTC.
  relayCallEvent("call:accept", "call:accepted");
  relayCallEvent("call:decline", "call:declined");
  relayCallEvent("call:offer", "call:offer");
  relayCallEvent("call:answer", "call:answer");
  relayCallEvent("call:ice-candidate", "call:ice-candidate");
  relayCallEvent("call:end", "call:ended");
  relayCallEvent("call:busy", "call:busy");

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
