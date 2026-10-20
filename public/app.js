
"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const $ = (selector) => document.querySelector(selector);

  const authView = $("#authView");
  const appView = $("#appView");
  const authForm = $("#authForm");
  const authError = $("#authError");
  const messagesEl = $("#messages");
  const messageForm = $("#messageForm");
  const messageInput = $("#messageInput");
  const chatError = $("#chatError");
  const connectionBanner = $("#connectionBanner");

  let authMode = "login";
  let currentUser = null;
  let currentChannel = "geral";
  let socket = null;
  let toastTimer;
  let toastMessageTimer;

  const channelDescriptions = {
    geral: "Um espaço para conversar e compartilhar ideias.",
    jogos: "Converse sobre jogos e suas novidades.",
    tecnologia: "Ideias, tecnologia e inovação.",
    conversa: "Um lugar para conversas descontraídas."
  };

  function on(selector, event, callback) {
    const element = $(selector);

    if (!element) {
      console.warn(`Elemento não encontrado: ${selector}`);
      return;
    }

    element.addEventListener(event, callback);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `Erro na solicitação (${response.status}).`
      );
    }

    return data;
  }

  function showToast(message) {
    const toast = $("#toast");

    if (!toast) {
      console.info(message);
      return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  function setAuthMode(mode) {
    authMode = mode === "register" ? "register" : "login";

    const registering = authMode === "register";

    $("#loginTab")?.classList.toggle("active", !registering);
    $("#registerTab")?.classList.toggle("active", registering);

    const username = $("#username");
    const usernameLabel = $("#usernameLabel");
    const identifier = $("#identifier");
    const password = $("#password");
    const submit = $("#authSubmit");

    username?.classList.toggle("hidden", !registering);
    usernameLabel?.classList.toggle("hidden", !registering);

    if (username) {
      username.required = registering;
    }

    if (identifier) {
      identifier.placeholder = registering
        ? "voce@exemplo.com"
        : "E-mail ou usuário";

      identifier.autocomplete = registering ? "email" : "username";
    }

    if (password) {
      password.autocomplete = registering
        ? "new-password"
        : "current-password";
    }

    if (submit) {
      submit.textContent = registering
        ? "Criar minha conta"
        : "Entrar no NEXO";
    }

    if (authError) {
      authError.textContent = "";
    }
  }

  on("#loginTab", "click", () => setAuthMode("login"));
  on("#registerTab", "click", () => setAuthMode("register"));

  if (authForm) {
    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (authError) {
        authError.textContent = "";
      }

      const button = $("#authSubmit");
      const identifier = $("#identifier");
      const password = $("#password");
      const username = $("#username");

      if (!identifier || !password || !button) {
        showToast("O formulário de acesso está incompleto.");
        return;
      }

      button.disabled = true;

      try {
        let result;

        if (authMode === "register") {
          result = await api("/api/register", {
            method: "POST",
            body: JSON.stringify({
              username: username?.value.trim() || "",
              email: identifier.value.trim(),
              password: password.value
            })
          });
        } else {
          result = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({
              identifier: identifier.value.trim(),
              password: password.value
            })
          });
        }

        currentUser = result.user;
        await enterApp();
      } catch (error) {
        if (authError) {
          authError.textContent = error.message;
        } else {
          showToast(error.message);
        }
      } finally {
        button.disabled = false;
      }
    });
  } else {
    console.error('Formulário "#authForm" não encontrado no HTML.');
  }

  async function enterApp() {
    if (!currentUser) return;

    authView?.classList.add("hidden");
    appView?.classList.remove("hidden");

    const username = $("#currentUsername");
    const avatar = $("#userAvatar");

    if (username) {
      username.textContent = currentUser.username;
    }

    if (avatar) {
      avatar.textContent = currentUser.username
        .charAt(0)
        .toUpperCase();
    }

    applySavedSettings();

    try {
      await loadChannels();
      connectSocket();
    } catch (error) {
      console.error("Erro ao abrir o NEXO:", error);
      showToast("Não foi possível carregar os canais. Tente novamente.");
    }
  }

  async function loadChannels() {
    const channels = await api("/api/channels");
    const list = $("#channelList");

    if (!list) {
      console.warn('Elemento "#channelList" não encontrado.');
      return;
    }

    list.replaceChildren();

    for (const item of channels) {
      const channel = typeof item === "string"
        ? { id: item, name: item, icon: "#" }
        : item;

      if (!channel?.id) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel-btn";
      button.dataset.channel = channel.id;

      const icon = document.createElement("span");
      icon.className = "channel-hash";
      icon.textContent = channel.icon || "#";

      const name = document.createElement("span");
      name.textContent = channel.name || channel.id;

      button.append(icon, name);
      button.addEventListener("click", () => {
        selectChannel(channel.id);
      });

      list.append(button);
    }

    updateChannelHeader();
  }

  function updateChannelHeader() {
    const button = document.querySelector(
      `.channel-btn[data-channel="${currentChannel}"]`
    );

    const name = $("#channelName");
    const icon = $("#channelIcon");
    const description = $("#channelDescription");

    if (name) {
      name.textContent = button
        ? button.querySelector("span:last-child")?.textContent || currentChannel
        : currentChannel;
    }

    if (icon) {
      icon.textContent = "#";
    }

    if (description) {
      description.textContent =
        channelDescriptions[currentChannel] ||
        "Converse com sua comunidade.";
    }

    document.querySelectorAll(".channel-btn").forEach((item) => {
      item.classList.toggle(
        "active",
        item.dataset.channel === currentChannel
      );
    });
  }

  function selectChannel(channel) {
    currentChannel = channel;

    updateChannelHeader();

    messagesEl?.replaceChildren();
    addWelcomeMessage();

    if (socket?.connected) {
      socket.emit("join channel", channel);
    }
  }

  function addWelcomeMessage() {
    if (!messagesEl) return;

    const welcome = document.createElement("div");
    welcome.className = "welcome-card";

    const symbol = document.createElement("div");
    symbol.className = "welcome-symbol";
    symbol.textContent = "✦";

    const heading = document.createElement("h2");
    heading.textContent = `Bem-vindo ao #${currentChannel}`;

    const description = document.createElement("p");
    description.textContent =
      "Comece uma nova conversa com a comunidade.";

    welcome.append(symbol, heading, description);
    messagesEl.append(welcome);
  }

  function addMessage(message) {
    if (!messagesEl || message.channel !== currentChannel) return;

    messagesEl.querySelector(".welcome-card")?.remove();

    const article = document.createElement("article");
    article.className = "message";

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = String(message.username || "?")
      .charAt(0)
      .toUpperCase();

    const body = document.createElement("div");
    body.className = "message-body";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const username = document.createElement("strong");
    username.textContent = message.username || "Usuário";

    const time = document.createElement("time");
    const date = new Date(message.created_at);

    time.dateTime = Number.isNaN(date.getTime())
      ? ""
      : date.toISOString();

    time.textContent = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit"
        });

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.message || "";

    meta.append(username, time);
    body.append(meta, text);
    article.append(avatar, body);
    messagesEl.append(article);

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function connectSocket() {
    if (typeof window.io !== "function") {
      console.error("Socket.IO não foi carregado no index.html.");
      connectionBanner?.classList.remove("hidden");
      showToast("O chat não conseguiu carregar. Atualize a página.");
      return;
    }

    if (socket) {
      socket.disconnect();
    }

    socket = window.io();

    socket.on("connect", () => {
      connectionBanner?.classList.add("hidden");
      socket.emit("join channel", currentChannel);
    });

    socket.on("disconnect", () => {
      connectionBanner?.classList.remove("hidden");
    });

    socket.on("connect_error", (error) => {
      connectionBanner?.classList.remove("hidden");
      console.error("Falha na conexão do chat:", error.message);
    });

    socket.on("chat history", (history) => {
      if (!messagesEl) return;

      messagesEl.replaceChildren();
      addWelcomeMessage();

      for (const message of history) {
        addMessage(message);
      }
    });

    socket.on("chat message", (message) => {
      addMessage(message);
    });

    socket.on("chat error", (message) => {
      if (chatError) {
        chatError.textContent = message;

        clearTimeout(toastMessageTimer);
        toastMessageTimer = setTimeout(() => {
          chatError.textContent = "";
        }, 3500);
      } else {
        showToast(message);
      }
    });
  }

  if (messageForm) {
    messageForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const message = messageInput?.value.trim() || "";

      if (!message || !socket?.connected) {
        if (!socket?.connected) {
          showToast("Reconectando ao chat...");
        }
        return;
      }

      socket.emit("send message", {
        channel: currentChannel,
        message
      });

      messageInput.value = "";
      messageInput.focus();
    });
  }

  on("#emojiButton", "click", () => {
    if (!messageInput) return;

    messageInput.value += " 😊";
    messageInput.focus();
  });

  on("#logoutButton", "click", async () => {
    try {
      await api("/api/logout", { method: "POST" });

      socket?.disconnect();
      socket = null;
      currentUser = null;

      appView?.classList.add("hidden");
      authView?.classList.remove("hidden");

      authForm?.reset();
      setAuthMode("login");

      showToast("Você saiu da sua conta.");
    } catch (error) {
      showToast(error.message);
    }
  });

  function openSettings() {
    $("#settingsPanel")?.classList.remove("hidden");
  }

  function closeSettings() {
    $("#settingsPanel")?.classList.add("hidden");
  }

  on("#settingsButton", "click", openSettings);
  on("#themeShortcut", "click", openSettings);
  on("#closeSettings", "click", closeSettings);
  on("#closeRightPanel", "click", closeSettings);

  function validColor(value) {
    return /^#[0-9a-f]{6}$/i.test(value)
      ? value
      : "#8b5cf6";
  }

  function applySettings(settings) {
    document.documentElement.style.setProperty(
      "--accent",
      validColor(settings.accent)
    );

    document.documentElement.style.setProperty(
      "--font-size",
      `${Math.max(
        14,
        Math.min(20, Number(settings.fontSize) || 16)
      )}px`
    );

    document.body.classList.remove(
      "dark",
      "midnight",
      "light",
      "serif",
      "mono"
    );

    const theme = ["dark", "midnight", "light"].includes(settings.theme)
      ? settings.theme
      : "dark";

    document.body.classList.add(theme);

    if (settings.font === "serif") {
      document.body.classList.add("serif");
    }

    if (settings.font === "mono") {
      document.body.classList.add("mono");
    }

    const accentColor = $("#accentColor");
    const themeSelect = $("#themeSelect");
    const fontSelect = $("#fontSelect");
    const fontSize = $("#fontSize");
    const fontSizeLabel = $("#fontSizeLabel");

    if (accentColor) accentColor.value = validColor(settings.accent);
    if (themeSelect) themeSelect.value = theme;
    if (fontSelect) fontSelect.value = settings.font || "inter";

    if (fontSize) {
      fontSize.value = settings.fontSize || 16;
    }

    if (fontSizeLabel) {
      fontSizeLabel.textContent = `${fontSize?.value || 16} px`;
    }
  }

  function readSettings() {
    return {
      accent: $("#accentColor")?.value || "#8b5cf6",
      theme: $("#themeSelect")?.value || "dark",
      font: $("#fontSelect")?.value || "inter",
      fontSize: Number($("#fontSize")?.value) || 16
    };
  }

  function applySavedSettings() {
    let settings = {};

    try {
      settings = JSON.parse(
        localStorage.getItem("nexo-settings") || "{}"
      );
    } catch {
      settings = {};
    }

    applySettings({
      accent: settings.accent || "#8b5cf6",
      theme: settings.theme || "dark",
      font: settings.font || "inter",
      fontSize: settings.fontSize || 16
    });
  }

  on("#fontSize", "input", () => {
    const label = $("#fontSizeLabel");

    if (label) {
      label.textContent = `${$("#fontSize").value} px`;
    }

    applySettings(readSettings());
  });

  on("#accentColor", "input", () => {
    applySettings(readSettings());
  });

  on("#themeSelect", "change", () => {
    applySettings(readSettings());
  });

  on("#fontSelect", "change", () => {
    applySettings(readSettings());
  });

  on("#saveSettings", "click", () => {
    const settings = readSettings();

    try {
      localStorage.setItem(
        "nexo-settings",
        JSON.stringify(settings)
      );

      applySettings(settings);

      const message = $("#settingsMessage");

      if (message) {
        message.textContent =
          "Aparência salva neste navegador.";
      }

      showToast("Personalização aplicada!");
    } catch {
      const message = $("#settingsMessage");

      if (message) {
        message.textContent =
          "Não foi possível salvar as configurações.";
      }
    }
  });

  async function restoreSession() {
    try {
      const result = await api("/api/me");

      if (result.authenticated && result.user) {
        currentUser = result.user;
        await enterApp();
      }
    } catch (error) {
      console.error(
        "Não foi possível restaurar a sessão:",
        error.message
      );
    }
  }

  setAuthMode("login");
  restoreSession();
});
