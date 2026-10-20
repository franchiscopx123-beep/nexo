
"use strict";

/* ========================================
   NEXO CHAT — APP.JS
   Login, cadastro, confirmação de senha,
   chat, canais e configurações
======================================== */

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $all = (selector) => Array.from(document.querySelectorAll(selector));

  const socket = typeof window.io === "function" ? window.io() : null;

  const elements = {
    authView: $("#authView"),
    appView: $("#appView"),

    authForm: $("#authForm"),
    authSubmit: $("#authSubmit"),
    authMessage: $("#authMessage"),

    usernameGroup: $("#usernameGroup") || $("#username")?.parentElement,
    username: $("#username"),

    identifier: $("#identifier"),
    identifierLabel: $("#identifierLabel"),

    password: $("#password"),
    togglePassword: $("#togglePassword"),
    passwordHint: $("#passwordHint"),

    confirmPasswordGroup: $("#confirmPasswordGroup"),
    confirmPassword: $("#confirmPassword"),
    toggleConfirmPassword: $("#toggleConfirmPassword"),
    confirmPasswordMessage: $("#confirmPasswordMessage"),

    currentUsername: $("#currentUsername"),
    currentChannel: $("#currentChannel"),

    channelList: $("#channelList"),
    messages: $("#messages"),

    messageForm: $("#messageForm"),
    messageInput: $("#messageInput"),
    sendButton: $("#sendButton"),

    logoutButton: $("#logoutButton"),
    settingsButton: $("#settingsButton"),
    settingsPanel: $("#settingsPanel"),
    settingsContent: $("#settingsContent"),
  };

  let registering = false;
  let currentUser = null;
  let currentChannel = "geral";
  let joinedChannel = null;
  let channels = ["geral", "jogos", "tecnologia", "conversa"];
  let authBusy = false;
  let sendingMessage = false;
  let settingsOpen = false;
  let sendTimeout = null;

  /* ========================================
     UTILITÁRIOS
  ======================================== */

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function setMessage(element, value, type = "") {
    if (!element) return;

    element.textContent = value;
    element.classList.remove(
      "error",
      "success",
      "invalid",
      "valid"
    );

    if (type) element.classList.add(type);

    if (type === "error") {
      element.setAttribute("role", "alert");
    } else {
      element.removeAttribute("role");
    }
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "Ocorreu um erro."
      );
    }

    return data;
  }

  function showView(view) {
    if (elements.authView) {
      elements.authView.hidden = view !== "auth";
    }

    if (elements.appView) {
      elements.appView.hidden = view !== "app";
    }
  }

  function formatTime(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /* ========================================
     SENHAS: MOSTRAR E OCULTAR
  ======================================== */

  function togglePasswordVisibility(input, button, label) {
    if (!input || !button) return;

    const show = input.type === "password";

    input.type = show ? "text" : "password";
    button.textContent = show ? "Ocultar" : "Mostrar";

    button.setAttribute("aria-pressed", String(show));
    button.setAttribute(
      "aria-label",
      `${show ? "Ocultar" : "Mostrar"} ${label}`
    );

    button.title = show ? "Ocultar senha" : "Mostrar senha";
    input.focus();
  }

  function resetPasswordVisibility() {
    [
      [elements.password, elements.togglePassword, "senha"],
      [
        elements.confirmPassword,
        elements.toggleConfirmPassword,
        "confirmação de senha",
      ],
    ].forEach(([input, button, label]) => {
      if (input) input.type = "password";

      if (button) {
        button.textContent = "Mostrar";
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", `Mostrar ${label}`);
        button.title = "Mostrar senha";
      }
    });
  }

  /* ========================================
     VALIDAÇÃO DE SENHA
  ======================================== */

  function validatePassword(password) {
    if (password.length < 8) {
      return "A senha precisa ter pelo menos 8 caracteres.";
    }

    if (!/[a-z]/.test(password)) {
      return "Inclua pelo menos uma letra minúscula.";
    }

    if (!/[A-Z]/.test(password)) {
      return "Inclua pelo menos uma letra maiúscula.";
    }

    if (!/[0-9]/.test(password)) {
      return "Inclua pelo menos um número.";
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
      return "Inclua pelo menos um símbolo, como ! ou @.";
    }

    if (new TextEncoder().encode(password).length > 72) {
      return "A senha não pode ultrapassar 72 bytes.";
    }

    return "";
  }

  /* ========================================
     CONFIRMAR SENHA
  ======================================== */

  function updatePasswordConfirmation() {
    const password = elements.password;
    const confirmation = elements.confirmPassword;
    const message = elements.confirmPasswordMessage;

    if (!confirmation || !registering) {
      if (confirmation) {
        confirmation.removeAttribute("aria-invalid");
        confirmation.classList.remove(
          "field-error",
          "field-success"
        );
      }

      setMessage(message, "");
      return true;
    }

    confirmation.classList.remove(
      "field-error",
      "field-success"
    );

    if (!confirmation.value) {
      confirmation.removeAttribute("aria-invalid");
      setMessage(message, "");
      return false;
    }

    if (confirmation.value !== (password?.value || "")) {
      confirmation.setAttribute("aria-invalid", "true");
      confirmation.classList.add("field-error");

      setMessage(
        message,
        "As senhas não coincidem.",
        "error"
      );

      return false;
    }

    confirmation.setAttribute("aria-invalid", "false");
    confirmation.classList.add("field-success");

    setMessage(
      message,
      "As senhas coincidem!",
      "success"
    );

    return true;
  }

  function validateRegistration() {
    const username = elements.username?.value.trim() || "";
    const email = elements.identifier?.value.trim() || "";
    const password = elements.password?.value || "";
    const confirmation = elements.confirmPassword?.value || "";

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return "O usuário deve ter de 3 a 24 caracteres, usando letras, números ou _.";
    }

    if (!email || !elements.identifier?.validity.valid) {
      return "Digite um endereço de e-mail válido.";
    }

    const passwordError = validatePassword(password);

    if (passwordError) return passwordError;

    if (!elements.confirmPassword) {
      return "O campo de confirmação de senha não foi encontrado no HTML.";
    }

    if (!confirmation) {
      return "Digite novamente sua senha para confirmar.";
    }

    if (password !== confirmation) {
      updatePasswordConfirmation();
      return "As senhas não coincidem.";
    }

    return "";
  }

  /* ========================================
     ALTERNAR LOGIN E CADASTRO
  ======================================== */

  function setAuthMode(isRegistering) {
    registering = Boolean(isRegistering);

    if (elements.usernameGroup) {
      elements.usernameGroup.hidden = !registering;
    } else if (elements.username) {
      elements.username.hidden = !registering;
    }

    if (elements.username) {
      elements.username.required = registering;
    }

    if (elements.identifierLabel) {
      elements.identifierLabel.textContent = registering
        ? "E-mail"
        : "E-mail ou usuário";
    }

    if (elements.identifier) {
      elements.identifier.type = registering ? "email" : "text";
      elements.identifier.placeholder = registering
        ? "seu@email.com"
        : "Digite seu e-mail ou usuário";

      elements.identifier.autocomplete = registering
        ? "email"
        : "username";
    }

    if (elements.password) {
      elements.password.autocomplete = registering
        ? "new-password"
        : "current-password";
    }

    if (elements.passwordHint) {
      elements.passwordHint.hidden = !registering;
    }

    if (elements.confirmPasswordGroup) {
      elements.confirmPasswordGroup.hidden = !registering;
    }

    if (elements.confirmPassword) {
      elements.confirmPassword.required = registering;
      elements.confirmPassword.autocomplete = "new-password";
    }

    if (elements.authSubmit) {
      elements.authSubmit.textContent = registering
        ? "Criar conta"
        : "Entrar";
    }

    $all("[data-auth-mode-title]").forEach((element) => {
      element.textContent = registering
        ? "Criar sua conta"
        : "Bem-vindo de volta";
    });

    $all("[data-auth-mode-description]").forEach((element) => {
      element.textContent = registering
        ? "Preencha os dados para começar a conversar."
        : "Entre na sua conta para continuar.";
    });

    $all("[data-auth-mode-toggle]").forEach((button) => {
      button.textContent = registering
        ? "Já tenho uma conta"
        : "Criar uma conta";
    });

    if (elements.password) elements.password.value = "";
    if (elements.confirmPassword) {
      elements.confirmPassword.value = "";
    }

    resetPasswordVisibility();
    setMessage(elements.authMessage, "");
    setMessage(elements.confirmPasswordMessage, "");
    updatePasswordConfirmation();
  }

  function toggleAuthMode() {
    setAuthMode(!registering);
  }

  /* ========================================
     ENVIAR LOGIN OU CADASTRO
  ======================================== */

  async function handleAuthSubmit(event) {
    event.preventDefault();

    if (authBusy) return;

    setMessage(elements.authMessage, "");

    const identifier = elements.identifier?.value.trim() || "";
    const password = elements.password?.value || "";

    if (!identifier || !password) {
      setMessage(
        elements.authMessage,
        "Preencha todos os campos obrigatórios.",
        "error"
      );
      return;
    }

    if (registering) {
      const validationError = validateRegistration();

      if (validationError) {
        setMessage(
          elements.authMessage,
          validationError,
          "error"
        );
        return;
      }
    }

    authBusy = true;

    if (elements.authSubmit) {
      elements.authSubmit.disabled = true;
      elements.authSubmit.textContent = registering
        ? "Criando conta..."
        : "Entrando...";
    }

    try {
      let result;

      if (registering) {
        result = await request("/api/register", {
          method: "POST",
          body: JSON.stringify({
            username: elements.username.value.trim(),
            email: identifier,
            password,
          }),
        });
      } else {
        result = await request("/api/login", {
          method: "POST",
          body: JSON.stringify({
            identifier,
            password,
          }),
        });
      }

      const user = result.user || result;

      if (user?.username) {
        enterApp(user);
      } else {
        await checkSession();
      }
    } catch (error) {
      setMessage(
        elements.authMessage,
        error.message || "Não foi possível autenticar.",
        "error"
      );
    } finally {
      authBusy = false;

      if (elements.authSubmit) {
        elements.authSubmit.disabled = false;
        elements.authSubmit.textContent = registering
          ? "Criar conta"
          : "Entrar";
      }
    }
  }

  /* ========================================
     SESSÃO E SAÍDA
  ======================================== */

  async function checkSession() {
    try {
      const result = await request("/api/me");

      if (result.authenticated && result.user) {
        enterApp(result.user);
      } else {
        currentUser = null;
        showView("auth");
      }
    } catch {
      currentUser = null;
      showView("auth");
    }
  }

  async function logout() {
    try {
      if (socket) {
        socket.emit("leave channel", currentChannel);
      }

      await request("/api/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch (error) {
      console.error("Erro ao sair:", error);
    } finally {
      currentUser = null;
      joinedChannel = null;
      currentChannel = "geral";

      if (socket) socket.disconnect();

      if (elements.authForm) elements.authForm.reset();

      setAuthMode(false);
      showView("auth");
    }
  }

  function enterApp(user) {
    currentUser = user;
    currentChannel = "geral";
    joinedChannel = null;

    showView("app");
    setText(elements.currentUsername, user.username);

    renderChannels();
    clearMessages();

    if (socket) socket.connect();

    joinChannel(currentChannel);
  }

  /* ========================================
     CANAIS
  ======================================== */

  async function loadChannels() {
    try {
      const result = await request("/api/channels");

      if (Array.isArray(result)) {
        channels = result;
      } else if (Array.isArray(result.channels)) {
        channels = result.channels;
      }
    } catch (error) {
      console.warn(
        "Usando a lista padrão de canais:",
        error.message
      );
    }

    renderChannels();
  }

  function renderChannels() {
    if (!elements.channelList) return;

    elements.channelList.replaceChildren();

    channels.forEach((channel) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel-button";
      button.dataset.channel = channel;

      if (channel === currentChannel) {
        button.classList.add("active");
        button.setAttribute("aria-current", "true");
      }

      const icon = document.createElement("span");
      icon.className = "channel-icon";
      icon.textContent = "#";

      const name = document.createElement("span");
      name.textContent = channel;

      button.append(icon, name);

      button.addEventListener("click", () => {
        if (channel !== currentChannel) {
          joinChannel(channel);
        }
      });

      elements.channelList.appendChild(button);
    });
  }

  function joinChannel(channel) {
    if (!channel || !channels.includes(channel)) return;

    currentChannel = channel;
    joinedChannel = null;

    setText(elements.currentChannel, `#${channel}`);
    setText($("#channelName"), channel);
    renderChannels();
    clearMessages();

    if (socket?.connected) {
      socket.emit("join channel", channel);
    } else if (!socket) {
      addSystemMessage(
        "A conexão com o servidor de chat não está disponível."
      );
    }
  }

  /* ========================================
     MENSAGENS
  ======================================== */

  function clearMessages() {
    if (elements.messages) {
      elements.messages.replaceChildren();
    }
  }

  function addSystemMessage(value) {
    if (!elements.messages) return;

    const item = document.createElement("div");
    item.className = "message system";
    item.textContent = value;

    elements.messages.appendChild(item);
    scrollMessagesToBottom();
  }

  function scrollMessagesToBottom() {
    if (elements.messages) {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }
  }

  function renderMessage(message) {
    if (!elements.messages || !message) return;

    const rowChannel = message.channel || currentChannel;
    if (rowChannel !== currentChannel) return;

    const wrapper = document.createElement("article");
    wrapper.className = "message";

    if (currentUser?.username === message.username) {
      wrapper.classList.add("own");
    }

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent =
      String(message.username || "?").charAt(0).toUpperCase();
    avatar.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "message-content";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const username = document.createElement("span");
    username.className = "message-username";
    username.textContent = message.username || "Usuário";

    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);

    if (message.created_at) {
      const date = new Date(message.created_at);
      if (!Number.isNaN(date.getTime())) {
        time.dateTime = date.toISOString();
      }
    }

    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = String(message.message ?? "");

    meta.append(username, time);
    content.append(meta, text);
    wrapper.append(avatar, content);
    elements.messages.appendChild(wrapper);

    scrollMessagesToBottom();
  }

  function handleSendMessage(event) {
    event.preventDefault();

    if (!currentUser || !socket || !socket.connected) {
      addSystemMessage("Você não está conectado ao servidor.");
      return;
    }

    if (sendingMessage) return;

    const message = elements.messageInput?.value.trim() || "";
    if (!message) return;

    sendingMessage = true;

    if (elements.sendButton) {
      elements.sendButton.disabled = true;
    }

    socket.emit(
      "send message",
      { channel: currentChannel, message },
      (response) => {
        sendingMessage = false;
        clearTimeout(sendTimeout);

        if (elements.sendButton) {
          elements.sendButton.disabled = false;
        }

        if (response?.error) {
          addSystemMessage(response.error);
          return;
        }

        if (elements.messageInput) {
          elements.messageInput.value = "";
          elements.messageInput.focus();
        }
      }
    );

    sendTimeout = window.setTimeout(() => {
      sendingMessage = false;

      if (elements.sendButton) {
        elements.sendButton.disabled = false;
      }
    }, 5000);
  }

  /* ========================================
     SOCKET.IO
  ======================================== */

  function setupSocket() {
    if (!socket) {
      console.warn("Socket.IO não foi carregado.");
      return;
    }

    socket.on("connect", () => {
      if (currentUser) {
        joinedChannel = null;
        socket.emit("join channel", currentChannel);
      }
    });

    socket.on("disconnect", () => {
      joinedChannel = null;
      updateConnectionStatus(false);
    });

    socket.on("connect_error", (error) => {
      console.error("Erro de conexão:", error.message);
      updateConnectionStatus(false);
    });

    socket.on("channel joined", (channel) => {
      joinedChannel =
        typeof channel === "string"
          ? channel
          : channel?.channel || currentChannel;

      if (joinedChannel === currentChannel) {
        setText(elements.currentChannel, `#${currentChannel}`);
        updateConnectionStatus(true);
      }
    });

    socket.on("chat history", (history) => {
      if (!Array.isArray(history)) return;

      clearMessages();
      history.forEach(renderMessage);
    });

    socket.on("chat message", (message) => {
      if (!message) return;

      if ((message.channel || currentChannel) !== currentChannel) {
        return;
      }

      renderMessage(message);
    });
  }

  function updateConnectionStatus(connected) {
    const status =
      $("#connectionStatus") || $(".connection-status");

    if (!status) return;

    status.classList.toggle("offline", !connected);
    status.classList.toggle("disconnected", !connected);
    status.textContent = connected
      ? "Conectado"
      : "Desconectado";
  }

  /* ========================================
     CONFIGURAÇÕES
  ======================================== */

  function toggleSettings() {
    settingsOpen = !settingsOpen;

    if (elements.settingsPanel) {
      elements.settingsPanel.hidden = !settingsOpen;
    }

    if (elements.settingsContent) {
      elements.settingsContent.hidden = !settingsOpen;
    }

    if (elements.settingsButton) {
      elements.settingsButton.setAttribute(
        "aria-expanded",
        String(settingsOpen)
      );
    }
  }

  function setupSettings() {
    const savedTheme = localStorage.getItem("nexo-theme");

    if (savedTheme === "light") {
      document.body.classList.add("light-theme");
    }

    const themeToggle = $("#themeToggle");

    if (themeToggle) {
      themeToggle.checked = savedTheme === "light";

      themeToggle.addEventListener("change", () => {
        const light = themeToggle.checked;

        document.body.classList.toggle("light-theme", light);
        localStorage.setItem(
          "nexo-theme",
          light ? "light" : "dark"
        );
      });
    }

    const soundToggle = $("#soundToggle");

    if (soundToggle) {
      soundToggle.checked =
        localStorage.getItem("nexo-sound") !== "off";

      soundToggle.addEventListener("change", () => {
        localStorage.setItem(
          "nexo-sound",
          soundToggle.checked ? "on" : "off"
        );
      });
    }
  }

  /* ========================================
     EVENTOS
  ======================================== */

  function setupEvents() {
    elements.authForm?.addEventListener(
      "submit",
      handleAuthSubmit
    );

    $all("[data-auth-mode-toggle]").forEach((button) => {
      button.addEventListener("click", toggleAuthMode);
    });

    [
      "#switchAuthMode",
      "#toggleAuthMode",
      "#authModeToggle",
      "#authSwitchButton",
    ].forEach((selector) => {
      const button = $(selector);

      if (button && !button.hasAttribute("data-auth-mode-toggle")) {
        button.addEventListener("click", toggleAuthMode);
      }
    });

    elements.togglePassword?.addEventListener("click", () => {
      togglePasswordVisibility(
        elements.password,
        elements.togglePassword,
        "senha"
      );
    });

    elements.toggleConfirmPassword?.addEventListener("click", () => {
      togglePasswordVisibility(
        elements.confirmPassword,
        elements.toggleConfirmPassword,
        "confirmação de senha"
      );
    });

    elements.password?.addEventListener(
      "input",
      updatePasswordConfirmation
    );

    elements.confirmPassword?.addEventListener(
      "input",
      updatePasswordConfirmation
    );

    elements.logoutButton?.addEventListener("click", logout);
    elements.settingsButton?.addEventListener("click", toggleSettings);

    elements.messageForm?.addEventListener(
      "submit",
      handleSendMessage
    );

    elements.messageInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        elements.messageForm?.requestSubmit();
      }
    });

    $("#closeSettings")?.addEventListener("click", () => {
      if (settingsOpen) toggleSettings();
    });

    $("#closeRightPanel")?.addEventListener("click", () => {
      if (settingsOpen) toggleSettings();
    });
  }

  /* ========================================
     INICIALIZAÇÃO
  ======================================== */

  async function init() {
    setAuthMode(false);
    setupEvents();
    setupSettings();
    setupSocket();

    await loadChannels();
    await checkSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
