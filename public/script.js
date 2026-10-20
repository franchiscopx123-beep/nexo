
document.addEventListener("DOMContentLoaded", () => {
  const $ = (selector) => document.querySelector(selector);

  const authView = $("#authView");
  const appView = $("#appView");
  const loginTab = $("#loginTab");
  const registerTab = $("#registerTab");
  const authForm = $("#authForm");
  const nameField = $("#nameField");
  const emailField = $("#emailField");
  const nameInput = $("#name");
  const emailInput = $("#email");
  const passwordInput = $("#password");
  const togglePassword = $("#togglePassword");
  const authSubmit = $("#authSubmit");
  const authError = $("#authError");

  const channelsList = $("#channelsList");
  const userAvatar = $("#userAvatar");
  const currentUsername = $("#currentUsername");
  const logoutButton = $("#logoutButton");

  const channelTitle = $("#channelTitle");
  const connectionStatus = $("#connectionStatus");
  const chatMessages = $("#chatMessages");
  const chatError = $("#chatError");
  const chatForm = $("#chatForm");
  const messageInput = $("#messageInput");
  const sendButton = $("#sendButton");

  let mode = "login";
  let socket = null;
  let currentChannel = null;
  let availableChannels = [];

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || "Ocorreu um erro.");
    }

    return data;
  }

  function showError(element, message = "") {
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
  }

  function setMode(nextMode) {
    mode = nextMode;

    const registering = mode === "register";

    loginTab?.classList.toggle("active", !registering);
    registerTab?.classList.toggle("active", registering);

    if (nameField) nameField.hidden = !registering;

    // No login, o mesmo campo aceita nome de usuário ou e-mail.
    if (emailField) emailField.hidden = false;

    if (emailInput) {
      emailInput.type = registering ? "email" : "text";
      emailInput.autocomplete = registering ? "email" : "username";
      emailInput.placeholder = registering
        ? "seu@email.com"
        : "Usuário ou e-mail";
      emailInput.required = true;
    }

    if (nameInput) {
      nameInput.required = registering;
      nameInput.autocomplete = "username";
    }

    if (passwordInput) {
      passwordInput.autocomplete = registering
        ? "new-password"
        : "current-password";
    }

    if (authSubmit) {
      authSubmit.textContent = registering
        ? "Criar conta"
        : "Entrar";
    }

    showError(authError);
  }

  loginTab?.addEventListener("click", () => setMode("login"));
  registerTab?.addEventListener("click", () => setMode("register"));

  togglePassword?.addEventListener("click", () => {
    if (!passwordInput) return;

    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    togglePassword.setAttribute(
      "aria-label",
      show ? "Ocultar senha" : "Mostrar senha"
    );
  });

  function showApp(user) {
    if (authView) authView.hidden = true;
    if (appView) appView.hidden = false;

    const username =
      user?.username || user?.name || user?.email || "Usuário";

    if (currentUsername) currentUsername.textContent = username;
    if (userAvatar) {
      userAvatar.textContent = username.charAt(0).toUpperCase();
    }

    connectSocket();
    loadChannels();
  }

  function showAuth() {
    if (appView) appView.hidden = true;
    if (authView) authView.hidden = false;

    if (socket) {
      socket.disconnect();
      socket = null;
    }

    currentChannel = null;
    availableChannels = [];
    setMode("login");
  }

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    showError(authError);

    const identifier = emailInput?.value.trim() || "";
    const password = passwordInput?.value || "";

    if (!identifier || !password) {
      showError(authError, "Preencha o usuário/e-mail e a senha.");
      return;
    }

    if (mode === "register") {
      if (!nameInput?.value.trim()) {
        showError(authError, "Informe seu nome de usuário.");
        return;
      }

      if (password.length < 6) {
        showError(authError, "A senha deve ter pelo menos 6 caracteres.");
        return;
      }
    }

    if (authSubmit) {
      authSubmit.disabled = true;
      authSubmit.textContent = "Aguarde...";
    }

    try {
      let data;

      if (mode === "register") {
        data = await api("/api/register", {
          method: "POST",
          body: JSON.stringify({
            username: nameInput.value.trim(),
            email: identifier,
            password,
          }),
        });
      } else {
        data = await api("/api/login", {
          method: "POST",
          body: JSON.stringify({
            identifier,
            password,
          }),
        });
      }

      showApp(data.user);
    } catch (error) {
      showError(authError, error.message || "Não foi possível entrar.");
    } finally {
      if (authSubmit) {
        authSubmit.disabled = false;
        authSubmit.textContent =
          mode === "register" ? "Criar conta" : "Entrar";
      }
    }
  });

  function connectSocket() {
    if (socket) socket.disconnect();

    if (typeof window.io !== "function") {
      showError(
        chatError,
        "O Socket.IO não carregou. Verifique a conexão com o servidor."
      );
      return;
    }

    socket = window.io({ withCredentials: true });

    socket.on("connect", () => {
      if (connectionStatus) {
        connectionStatus.textContent = "Conectado";
      }

      if (currentChannel) {
        socket.emit("join channel", currentChannel);
      }
    });

    socket.on("disconnect", () => {
      if (connectionStatus) {
        connectionStatus.textContent = "Desconectado";
      }
    });

    socket.on("connect_error", () => {
      if (connectionStatus) {
        connectionStatus.textContent = "Reconectando...";
      }
      showError(
        chatError,
        "Não foi possível conectar ao chat. Verifique se o servidor está ativo."
      );
    });

    socket.on("channel joined", (data) => {
      if (data?.channel === currentChannel) {
        showError(chatError);
      }
    });

    socket.on("chat history", (messages) => {
      if (!Array.isArray(messages)) return;

      chatMessages?.replaceChildren();

      messages.forEach((message) => {
        renderMessage(message);
      });

      scrollToBottom();
    });

    socket.on("chat message", (message) => {
      if (!message || message.channel !== currentChannel) return;

      // Evita duplicar uma mensagem que já esteja no histórico.
      if (
        message.id != null &&
        chatMessages?.querySelector(`[data-message-id="${message.id}"]`)
      ) {
        return;
      }

      renderMessage(message);
      scrollToBottom();
    });

    socket.on("error message", (message) => {
      const text =
        typeof message === "string"
          ? message
          : message?.error || message?.message || "Erro no chat.";

      showError(chatError, text);
    });
  }

  async function loadChannels() {
    if (!channelsList) return;

    channelsList.replaceChildren();

    try {
      const data = await api("/api/channels");
      availableChannels = Array.isArray(data)
        ? data
        : data.channels || [];

      availableChannels.forEach((channel) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "channel-item";
        button.dataset.channel = channel;
        button.textContent = `# ${channel}`;

        button.addEventListener("click", () => joinChannel(channel));

        channelsList.appendChild(button);
      });

      if (availableChannels.length > 0) {
        joinChannel(availableChannels[0]);
      }
    } catch (error) {
      showError(
        chatError,
        "Não foi possível carregar os canais: " + error.message
      );
    }
  }

  function joinChannel(channel) {
    if (!availableChannels.includes(channel)) return;

    currentChannel = channel;

    if (channelTitle) channelTitle.textContent = `# ${channel}`;

    if (chatMessages) chatMessages.replaceChildren();

    if (messageInput) {
      messageInput.disabled = false;
      messageInput.placeholder = `Mensagem em #${channel}`;
    }

    if (sendButton) sendButton.disabled = false;

    document.querySelectorAll("[data-channel]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.channel === channel
      );
    });

    showError(chatError);

    if (socket?.connected) {
      socket.emit("join channel", channel);
    }
  }

  function renderMessage(message) {
    if (!chatMessages) return;

    const row = document.createElement("article");
    row.className = "message";

    if (message.id != null) {
      row.dataset.messageId = String(message.id);
    }

    const author = document.createElement("strong");
    author.className = "message-author";
    author.textContent =
      message.username || message.author || message.user?.username || "Usuário";

    const time = document.createElement("time");
    time.className = "message-time";

    if (message.created_at) {
      const date = new Date(message.created_at);

      if (!Number.isNaN(date.getTime())) {
        time.dateTime = date.toISOString();
        time.textContent = date.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }

    const content = document.createElement("p");
    content.className = "message-content";
    content.textContent = message.message || message.content || "";

    row.append(author, time, content);
    chatMessages.appendChild(row);
  }

  function scrollToBottom() {
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  chatForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const message = messageInput?.value.trim();

    if (!message || !currentChannel || !socket?.connected) {
      if (!socket?.connected) {
        showError(chatError, "Você não está conectado ao chat.");
      }
      return;
    }

    showError(chatError);

    if (sendButton) sendButton.disabled = true;

    socket.emit(
      "send message",
      {
        channel: currentChannel,
        message,
      },
      (result) => {
        if (result?.error) {
          showError(chatError, result.error);
        } else if (result?.ok) {
          if (messageInput) messageInput.value = "";
        }

        if (sendButton) {
          sendButton.disabled = !socket?.connected;
        }

        messageInput?.focus();
      }
    );
  });

  messageInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatForm?.requestSubmit();
    }
  });

  logoutButton?.addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch (error) {
      console.error("Erro ao sair:", error);
    } finally {
      showAuth();
    }
  });

  async function initialize() {
    setMode("login");

    try {
      const data = await api("/api/me");

      if (data.authenticated && data.user) {
        showApp(data.user);
      } else {
        showAuth();
      }
    } catch {
      showAuth();
    }
  }

  initialize();
});
