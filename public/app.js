
"use strict";

const $ = (selector) => document.querySelector(selector);

const authView = $("#authView");
const appView = $("#appView");
const authForm = $("#authForm");
const authTitle = $("#authTitle");
const authDescription = $("#authDescription");
const usernameInput = $("#username");
const usernameLabel = $("#usernameLabel");
const identifierInput = $("#identifier");
const passwordInput = $("#password");
const authSubmit = $("#authSubmit");
const authMessage = $("#authMessage");
const passwordHint = $("#passwordHint");
const loginTab = $("#loginTab");
const registerTab = $("#registerTab");

const currentUsername = $("#currentUsername");
const userAvatar = $("#userAvatar");
const channelList = $("#channelList");
const channelName = $("#channelName");
const channelIcon = $("#channelIcon");
const channelDescription = $("#channelDescription");
const messages = $("#messages");
const messageForm = $("#messageForm");
const messageInput = $("#messageInput");
const connectionBanner = $("#connectionBanner");
const connectionDot = $("#connectionDot");
const settingsPanel = $("#settingsPanel");
const settingsMessage = $("#settingsMessage");

let authMode = "login";
let currentUser = null;
let currentChannel = "geral";
let socket = null;
let joinedChannel = null;
let messageCache = new Map();
let channels = [];
let isSending = false;

const channelInfo = {
  geral: {
    title: "geral",
    description: "Converse com toda a comunidade.",
    icon: "#"
  },
  jogos: {
    title: "jogos",
    description: "Jogos, partidas e tudo sobre games.",
    icon: "🎮"
  },
  tecnologia: {
    title: "tecnologia",
    description: "Novidades, ideias e tecnologia.",
    icon: "⌘"
  },
  conversa: {
    title: "conversa",
    description: "Um espaço para conversar à vontade.",
    icon: "☕"
  }
};

function setMessage(element, text, type = "") {
  if (!element) return;
  element.textContent = text || "";
  element.classList.remove("error", "success");
  if (type) element.classList.add(type);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "Não foi possível concluir a operação.");
  }

  return data;
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";

  loginTab.classList.toggle("active", !registering);
  registerTab.classList.toggle("active", registering);

  authTitle.textContent = registering ? "Crie sua conta" : "Bem-vindo de volta";
  authDescription.textContent = registering
    ? "Entre para fazer parte da comunidade."
    : "Entre para continuar suas conversas.";

  usernameInput.hidden = !registering;
  usernameLabel.hidden = !registering;
  usernameInput.required = registering;
  identifierInput.autocomplete = registering ? "email" : "username";
  identifierInput.placeholder = registering
    ? "Seu e-mail"
    : "Digite seu usuário ou e-mail";

  authSubmit.textContent = registering ? "Criar conta" : "Entrar";
  passwordInput.autocomplete = registering ? "new-password" : "current-password";
  passwordHint.hidden = !registering;
  setMessage(authMessage, "");
}

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));

function validatePassword(password) {
  if (password.length < 8) {
    return "A senha deve ter pelo menos 8 caracteres.";
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
    return "Inclua pelo menos um símbolo.";
  }
  return "";
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(authMessage, "");

  const identifier = identifierInput.value.trim();
  const password = passwordInput.value;

  if (!identifier || !password) {
    setMessage(authMessage, "Preencha os campos obrigatórios.", "error");
    return;
  }

  if (authMode === "register") {
    const username = usernameInput.value.trim();

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      setMessage(
        authMessage,
        "O usuário deve ter de 3 a 24 caracteres: letras, números ou _.",
        "error"
      );
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setMessage(authMessage, passwordError, "error");
      return;
    }
  }

  authSubmit.disabled = true;
  authSubmit.textContent = "Aguarde...";

  try {
    let result;

    if (authMode === "register") {
      result = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({
          username: usernameInput.value.trim(),
          email: identifier,
          password
        })
      });
    } else {
      result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password })
      });
    }

    await enterApp(result.user);
  } catch (error) {
    setMessage(authMessage, error.message, "error");
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === "register" ? "Criar conta" : "Entrar";
  }
});

async function restoreSession() {
  try {
    const data = await api("/api/me");
    if (data.authenticated && data.user) {
      await enterApp(data.user);
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

function showAuth() {
  authView.hidden = false;
  appView.hidden = true;
  settingsPanel.hidden = true;
}

async function enterApp(user) {
  if (!user) {
    showAuth();
    return;
  }

  currentUser = user;
  authView.hidden = true;
  appView.hidden = false;

  const name = user.username || user.name || user.email || "Usuário";
  currentUsername.textContent = name;
  userAvatar.textContent = name.charAt(0).toUpperCase();

  await loadChannels();
  connectSocket();
}

async function loadChannels() {
  try {
    const data = await api("/api/channels");
    channels = Array.isArray(data) ? data : (data.channels || []);

    if (!channels.length) channels = ["geral"];

    if (!channels.includes(currentChannel)) currentChannel = channels[0];

    renderChannels();
    updateChannelHeader();
  } catch (error) {
    channelList.replaceChildren();
    const item = document.createElement("p");
    item.className = "muted";
    item.textContent = error.message;
    channelList.append(item);
  }
}

function renderChannels() {
  channelList.replaceChildren();

  channels.forEach((channel) => {
    const info = channelInfo[channel] || {
      title: channel,
      description: "Converse neste canal.",
      icon: "#"
    };

    const button = document.createElement("button");
    button.type = "button";
    button.className = "channel-button";
    button.classList.toggle("active", channel === currentChannel);
    button.setAttribute("aria-current", channel === currentChannel ? "page" : "false");

    const icon = document.createElement("span");
    icon.className = "channel-hash";
    icon.textContent = info.icon;

    const label = document.createElement("span");
    label.className = "channel-label";
    label.textContent = info.title;

    button.append(icon, label);
    button.addEventListener("click", () => selectChannel(channel));
    channelList.append(button);
  });
}

function updateChannelHeader() {
  const info = channelInfo[currentChannel] || {
    title: currentChannel,
    description: "Converse neste canal.",
    icon: "#"
  };

  channelName.textContent = info.title;
  channelIcon.textContent = info.icon;
  channelDescription.textContent = info.description;
}

function selectChannel(channel) {
  if (!channels.includes(channel) || channel === currentChannel) return;

  currentChannel = channel;
  renderChannels();
  updateChannelHeader();
  renderCurrentMessages();

  if (socket && socket.connected) {
    joinedChannel = null;
    socket.emit("join channel", channel);
  }
}

function connectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  joinedChannel = null;
  socket = io({ withCredentials: true });

  socket.on("connect", () => {
    connectionBanner.textContent = "Conectado";
    connectionDot.style.background = "var(--success)";
    joinedChannel = null;
    socket.emit("join channel", currentChannel);
  });

  socket.on("disconnect", () => {
    connectionBanner.textContent = "Reconectando...";
    connectionDot.style.background = "var(--danger)";
    joinedChannel = null;
  });

  socket.on("connect_error", () => {
    connectionBanner.textContent = "Falha na conexão";
    connectionDot.style.background = "var(--danger)";
  });

  socket.on("channel joined", (data) => {
    const channel = typeof data === "string" ? data : data?.channel;
    if (channel) joinedChannel = channel;
  });

  socket.on("chat history", (history) => {
    if (!Array.isArray(history)) return;

    const channel = history[0]?.channel || joinedChannel || currentChannel;
    messageCache.set(channel, history.slice());
    if (channel === currentChannel) renderCurrentMessages();
  });

  socket.on("chat message", (message) => {
    if (!message || !message.channel) return;

    const existing = messageCache.get(message.channel) || [];
    if (message.id && existing.some((item) => item.id === message.id)) return;

    existing.push(message);
    messageCache.set(message.channel, existing.slice(-500));

    if (message.channel === currentChannel) {
      const welcome = messages.querySelector(".welcome-message");
      if (welcome) welcome.remove();
      renderMessage(message);
      messages.scrollTop = messages.scrollHeight;
    }
  });

  socket.on("error message", (data) => {
    const message = typeof data === "string" ? data : data?.error;
    if (message) connectionBanner.textContent = message;
  });
}

function renderCurrentMessages() {
  messages.replaceChildren();

  const history = messageCache.get(currentChannel) || [];
  if (!history.length) {
    const welcome = document.createElement("div");
    welcome.className = "welcome-message";

    const icon = document.createElement("div");
    icon.className = "welcome-icon";
    icon.textContent = "✦";

    const title = document.createElement("h2");
    title.textContent = `Bem-vindo ao canal ${currentChannel}`;

    const description = document.createElement("p");
    description.textContent = "Envie a primeira mensagem para começar a conversa.";

    welcome.append(icon, title, description);
    messages.append(welcome);
    return;
  }

  history.forEach(renderMessage);
  messages.scrollTop = messages.scrollHeight;
}

function renderMessage(message) {
  if (!message || message.channel !== currentChannel) return;

  const row = document.createElement("article");
  row.className = "message";

  const username = message.username || "Usuário";
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = username.charAt(0).toUpperCase();

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const name = document.createElement("strong");
  name.textContent = username;

  const time = document.createElement("time");
  if (message.created_at) {
    const date = new Date(message.created_at);
    if (!Number.isNaN(date.getTime())) {
      time.dateTime = date.toISOString();
      time.textContent = date.toLocaleString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short"
      });
    }
  }

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = message.message || "";

  meta.append(name, time);
  body.append(meta, text);
  row.append(avatar, body);
  messages.append(row);
}

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message || !socket || !socket.connected || isSending) return;

  isSending = true;
  socket.emit("send message", {
    channel: currentChannel,
    message
  }, (response) => {
    isSending = false;
    if (response?.error) {
      connectionBanner.textContent = response.error;
    }
  });

  messageInput.value = "";
  messageInput.focus();
  isSending = false;
});

$("#emojiButton").addEventListener("click", () => {
  const emojis = ["😀", "😂", "❤️", "👍", "🔥", "🎮", "✨", "👋"];
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];
  const start = messageInput.selectionStart ?? messageInput.value.length;
  const end = messageInput.selectionEnd ?? messageInput.value.length;
  messageInput.setRangeText(emoji, start, end, "end");
  messageInput.focus();
});

$("#logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // Mesmo se a resposta falhar, volta para a tela de login.
  }

  if (socket) socket.disconnect();
  socket = null;
  currentUser = null;
  messageCache.clear();
  showAuth();
  authForm.reset();
  setAuthMode("login");
});

$("#settingsButton").addEventListener("click", () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

$("#closeSettings").addEventListener("click", () => {
  settingsPanel.hidden = true;
});

$("#closeRightPanel").addEventListener("click", () => {
  settingsPanel.hidden = true;
});

function applySettings(settings) {
  const theme = settings.theme || "dark";
  const accent = settings.accent || "#8b5cf6";
  const fontSize = settings.fontSize || "medium";
  const font = settings.font || "inter";

  document.body.classList.toggle("theme-light", theme === "light");

  ["font-small", "font-medium", "font-large",
    "font-inter", "font-arial", "font-georgia", "font-mono"]
    .forEach((className) => document.body.classList.remove(className));

  document.body.classList.add(`font-${fontSize}`, `font-${font}`);
  document.documentElement.style.setProperty("--accent", accent);

  const darker = accent;
  document.documentElement.style.setProperty("--accent-hover", darker);

  $("#themeSelect").value = theme;
  $("#accentColor").value = accent;
  $("#fontSize").value = fontSize;
  $("#fontSelect").value = font;
}

function readSettings() {
  return {
    theme: $("#themeSelect").value,
    accent: $("#accentColor").value,
    fontSize: $("#fontSize").value,
    font: $("#fontSelect").value
  };
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("nexo-settings") || "{}");
    applySettings(saved);
  } catch {
    applySettings({});
  }
}

$("#saveSettings").addEventListener("click", () => {
  const settings = readSettings();

  try {
    localStorage.setItem("nexo-settings", JSON.stringify(settings));
    applySettings(settings);
    setMessage(settingsMessage, "Configurações salvas!", "success");
  } catch {
    setMessage(settingsMessage, "Não foi possível salvar as configurações.", "error");
  }
});

$("#themeShortcut").addEventListener("click", () => {
  const settings = readSettings();
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  $("#themeSelect").value = settings.theme;
  applySettings(settings);

  try {
    localStorage.setItem("nexo-settings", JSON.stringify(settings));
  } catch {
    // A alteração continua aplicada até a página ser recarregada.
  }
});

loadSettings();
restoreSession();
