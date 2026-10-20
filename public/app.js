
"use strict";

/* ========================================
   NEXO CHAT — APP.JS
   Login, cadastro, senhas, chat e canais
======================================== */

(() => {
  const $ = (selector) => document.querySelector(selector);

  const socket = typeof window.io === "function" ? window.io() : null;

  const elements = {
    authView: $("#authView"),
    appView: $("#appView"),

    authForm: $("#authForm"),
    authSubmit: $("#authSubmit"),
    authMessage: $("#authMessage"),

    usernameGroup: $("#usernameGroup"),
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

  const $all = (selector) => Array.from(document.querySelectorAll(selector));

  /* ========================================
     UTILITÁRIOS
  ======================================== */

  function setText(element, text) {
    if (element) element.textContent = text;
  }

  function setMessage(element, text, type = "") {
    if (!element) return;

    element.textContent = text;
    element.classList.remove("error", "success", "invalid", "valid");

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
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || "Ocorreu um erro.");
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

  function escapeText(value) {
    return String(value ?? "");
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

  function formatChannelName(channel) {
    return channel.charAt(0).toUpperCase() + channel.slice(1);
  }

  /* ========================================
     LOGIN E CADASTRO
  ======================================== */

  function setAuthMode(isRegistering) {
    registering = Boolean(isRegistering);

    const usernameGroup = elements.usernameGroup;
    const username = elements.username;
    const identifierLabel = elements.identifierLabel;
    const identifier = elements.identifier;
    const passwordHint = elements.passwordHint;
    const confirmGroup = elements.confirmPasswordGroup;
    const submit = elements.authSubmit;

    if (usernameGroup) {
      usernameGroup.hidden = !registering;
    } else if (username) {
      username.hidden = !registering;
    }

    if (username) {
      username.required = registering;
    }

    if (identifierLabel) {
      identifierLabel.textContent = registering ? "E-mail" : "E-mail ou usuário";
    }

    if (identifier) {
      identifier.placeholder = registering
        ? "seu@email.com"
        : "Digite seu e-mail ou usuário";

      identifier.autocomplete = registering ? "email" : "username";
      identifier.type = registering ? "email" : "text";
    }

    if (passwordHint) {
      passwordHint.hidden = !registering;
    }

    if (confirmGroup) {
      confirmGroup.hidden = !registering;
    }

    if (elements.confirmPassword) {
      elements.confirmPassword.required = registering;
    }

    if (submit) {
      submit.textContent = registering ? "Criar conta" : "Entrar";
    }

    $all("[data-auth-mode-title]").forEach((element) => {
      element.textContent = registering ? "Criar sua conta" : "Bem-vindo de volta";
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

    resetPasswordVisibility();
    setMessage(elements.authMessage, "");
    setMessage(elements.confirmPasswordMessage, "");

    if (elements.password) elements.password.value = "";
    if (elements.confirmPassword) elements.confirmPassword.value = "";

    updatePasswordConfirmation();
  }

  function toggleAuthMode() {
    setAuthMode(!registering);
  }

  function resetPasswordVisibility() {
    if (elements.password) {
      elements.password.type = "password";
    }

    if (elements.confirmPassword) {
      elements.confirmPassword.type = "password";
    }

    if (elements.togglePassword) {
      elements.togglePassword.textContent = "Mostrar";
      elements.togglePassword.setAttribute("aria-label", "Mostrar senha");
      elements.togglePassword.setAttribute("aria-pressed", "false");
    }

    if (elements.toggleConfirmPassword) {
      elements.toggleConfirmPassword.textContent = "Mostrar";
      elements.toggleConfirmPassword.setAttribute(
        "aria-label",
        "Mostrar confirmação de senha"
      );
      elements.toggleConfirmPassword.setAttribute("aria-pressed", "false");
    }
  }

  function togglePasswordVisibility(input, button, label) {
    if (!input || !button) return;

    const showing = input.type === "password";

    input.type = showing ? "text" : "password";
    button.textContent = showing ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-pressed", String(showing));
    button.setAttribute(
      "aria-label",
      `${showing ? "Ocultar" : "Mostrar"} ${label}`
    );

    input.focus();
  }

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

  function updatePasswordConfirmation() {
    const password = elements.password;
    const confirmation = elements.confirmPassword;
    const message = elements.confirmPasswordMessage;

    if (!password || !confirmation || !message || !registering) {
      if (confirmation) {
        confirmation.removeAttribute("aria-invalid");
        confirmation.classList.remove("field-error", "field-success");
      }

      setMessage(message, "");
      return true;
    }

    const value = confirmation.value;

    confirmation.classList.remove("field-error", "field-success");

    if (!value) {
      confirmation.removeAttribute("aria-invalid");
      setMessage(message, "");
      return false;
    }

    if (value !== password.value) {
      confirmation.setAttribute("aria-invalid", "true");
      confirmation.classList.add("field-error");
      setMessage(message, "As senhas não coincidem.", "error");
      return false;
    }

    confirmation.setAttribute("aria-invalid", "false");
    confirmation.classList.add("field-success");
    setMessage(message, "As senhas coincidem.", "success");

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

    if (!confirmation) {
      return "Confirme sua senha.";
    }

    if (password !== confirmation) {
      updatePasswordConfirmation();
      return "As senhas não coincidem.";
    }

    return "";
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    if (authBusy) return;

    setMessage(elements.authMessage, "");

    const identifier = elements.identifier?.value.trim() || "";
    const password = elements.password?.value || "";

    if (!identifier || !password) {
      setMessage(elements.authMessage, "Preencha todos os campos obrigatórios.", "error");
      return;
    }

    if (registering) {
      const validationError = validateRegistration();

      if (validationError) {
        setMessage(elements.authMessage, validationError, "error");
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

      if (!user || !user.username) {
        await checkSession();
        return;
      }

      enterApp(user);
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
    } catch (error) {
      currentUser = null;
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

    if (socket) {
      socket.connect();
    }

    joinChannel(currentChannel);
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
      console.warn("Usando a lista padrão de canais:", error.message);
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

    renderChannels();
    clearMessages();

    if (socket && socket.connected) {
      socket.emit("join channel", channel);
    } else if (!socket) {
      addSystemMessage("A conexão com o servidor de chat não está disponível.");
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

  function addSystemMessage(text) {
    if (!elements.messages) return;

    const item = document.createElement("div");
    item.className = "message system";
    item.textContent = text;

    elements.messages.appendChild(item);
    scrollMessagesToBottom();
  }

  function scrollMessagesToBottom() {
    if (!elements.messages) return;

    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function renderMessage(message) {
    if (!elements.messages || !message) return;

    const rowChannel = message.channel || joinedChannel || currentChannel;

    if (rowChannel !== currentChannel) return;

    const wrapper = document.createElement("article");
    wrapper.className = "message";

    if (currentUser && message.username === currentUser.username) {
      wrapper.classList.add("own");
    }

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = escapeText(message.username).charAt(0).toUpperCase() || "?";
    avatar.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "message-content";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const username = document.createElement("span");
    username.className = "message-username";
    username.textContent = escapeText(message.username || "Usuário");

    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);

    if (message.created_at) {
      time.dateTime = new Date(message.created_at).toISOString();
    }

    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = escapeText(message.message);

    meta.append(username, time);
    content.append(meta, text);
    wrapper.append(avatar, content);

    elements.messages.appendChild(wrapper);
    scrollMessagesToBottom();
  }

  async function handleSendMessage(event) {
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
      {
        channel: currentChannel,
        message,
      },
      (response) => {
        sendingMessage = false;

        if (elements.sendButton) {
          elements.sendButton.disabled = false;
        }

        if (response && response.error) {
          addSystemMessage(response.error);
          return;
        }

        if (elements.messageInput) {
          elements.messageInput.value = "";
          elements.messageInput.focus();
        }
      }
    );

    // Evita deixar o botão travado caso o servidor não envie callback.
    window.setTimeout(() => {
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
      joinedChannel = typeof channel === "string"
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

      history.forEach((message) => {
        renderMessage(message);
      });
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
    const status = $("#connectionStatus") || $(".connection-status");

    if (!status) return;

    status.classList.toggle("offline", !connected);
    status.classList.toggle("disconnected", !connected);

    status.textContent = connected ? "Conectado" : "Desconectado";
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
        localStorage.setItem("nexo-theme", light ? "light" : "dark");
      });
    }

    const soundToggle = $("#soundToggle");

    if (soundToggle) {
      soundToggle.checked = localStorage.getItem("nexo-sound") !== "off";

      soundToggle.addEventListener("change", () => {
        localStorage.setItem(
          "nexo-sound",
          soundToggle.checked ? "on" : "off"
        );
      });
    }
  }

  /* ========================================
     EVENTOS DA INTERFACE
  ======================================== */

  function setupEvents() {
    if (elements.authForm) {
      elements.authForm.addEventListener("submit", handleAuthSubmit);
    }

    $all("[data-auth-mode-toggle]").forEach((button) => {
      button.addEventListener("click", toggleAuthMode);
    });

    // Compatibilidade com botões de alternância usados em versões anteriores.
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

    if (elements.togglePassword) {
      elements.togglePassword.addEventListener("click", () => {
        togglePasswordVisibility(
          elements.password,
          elements.togglePassword,
          "senha"
        );
      });
    }

    if (elements.toggleConfirmPassword) {
      elements.toggleConfirmPassword.addEventListener("click", () => {
        togglePasswordVisibility(
          elements.confirmPassword,
          elements.toggleConfirmPassword,
          "confirmação de senha"
        );
      });
    }

    if (elements.password) {
      elements.password.addEventListener("input", updatePasswordConfirmation);
    }

    if (elements.confirmPassword) {
      elements.confirmPassword.addEventListener(
        "input",
        updatePasswordConfirmation
      );
    }

    if (elements.logoutButton) {
      elements.logoutButton.addEventListener("click", logout);
    }

    if (elements.settingsButton) {
      elements.settingsButton.addEventListener("click", toggleSettings);
    }

    if (elements.messageForm) {
      elements.messageForm.addEventListener("submit", handleSendMessage);
    }

    if (elements.messageInput) {
      elements.messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();

          if (elements.messageForm?.requestSubmit) {
            elements.messageForm.requestSubmit();
          }
        }
      });
    }

    const closeSettings = $("#closeSettings");

    if (closeSettings) {
      closeSettings.addEventListener("click", () => {
        settingsOpen = true;
        toggleSettings();
      });
    }
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

  document.addEventListener("DOMContentLoaded", init);
})();
