
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

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível completar a solicitação.");
  }

  return data;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";

  $("#loginTab").classList.toggle("active", !registering);
  $("#registerTab").classList.toggle("active", registering);

  $("#username").classList.toggle("hidden", !registering);
  $("#usernameLabel").classList.toggle("hidden", !registering);
  $("#username").required = registering;

  $("#identifier").placeholder = registering
    ? "voce@exemplo.com"
    : "E-mail ou usuário";

  $("#identifier").autocomplete = registering ? "email" : "username";
  $("#password").autocomplete = registering ? "new-password" : "current-password";
  $("#authSubmit").textContent = registering ? "Criar minha conta" : "Entrar no NEXO";
  authError.textContent = "";
}

$("#loginTab").addEventListener("click", () => setAuthMode("login"));
$("#registerTab").addEventListener("click", () => setAuthMode("register"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";

  const button = $("#authSubmit");
  button.disabled = true;

  try {
    let result;

    if (authMode === "register") {
      result = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({
          username: $("#username").value.trim(),
          email: $("#identifier").value.trim(),
          password: $("#password").value
        })
      });
    } else {
      result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: $("#identifier").value.trim(),
          password: $("#password").value
        })
      });
    }

    currentUser = result.user;
    await enterApp();
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function enterApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");

  $("#currentUsername").textContent = currentUser.username;
  $("#userAvatar").textContent = currentUser.username
    .charAt(0).toUpperCase();

  applySavedSettings();
  await loadChannels();
  connectSocket();
}

async function loadChannels() {
  const channels = await api("/api/channels");
  const list = $("#channelList");
  list.replaceChildren();

  for (const channel of channels) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "channel-btn";
    button.dataset.channel = channel.id;

    const icon = document.createElement("span");
    icon.className = "channel-hash";
    icon.textContent = channel.icon;

    const name = document.createElement("span");
    name.textContent = channel.name;

    button.append(icon, name);
    button.addEventListener("click", () => selectChannel(channel.id));
    list.append(button);
  }

  updateChannelHeader();
}

function updateChannelHeader() {
  const button = document.querySelector(
    `.channel-btn[data-channel="${currentChannel}"]`
  );

  $("#channelName").textContent = button
    ? button.querySelector("span:last-child").textContent
    : currentChannel;

  $("#channelIcon").textContent = "#";
  $("#channelDescription").textContent =
    channelDescriptions[currentChannel] || "Converse com sua comunidade.";

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
  messagesEl.replaceChildren();
  addWelcomeMessage();

  if (socket?.connected) {
    socket.emit("join channel", channel);
  }
}

function addWelcomeMessage() {
  const welcome = document.createElement("div");
  welcome.className = "welcome-card";

  const symbol = document.createElement("div");
  symbol.className = "welcome-symbol";
  symbol.textContent = "✦";

  const heading = document.createElement("h2");
  heading.textContent = `Bem-vindo ao #${currentChannel}`;

  const description = document.createElement("p");
  description.textContent = "Comece uma nova conversa com a comunidade.";

  welcome.append(symbol, heading, description);
  messagesEl.append(welcome);
}

function addMessage(message) {
  if (message.channel !== currentChannel) return;

  const welcome = messagesEl.querySelector(".welcome-card");
  if (welcome) welcome.remove();

  const article = document.createElement("article");
  article.className = "message";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = String(message.username || "?")
    .charAt(0).toUpperCase();

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const username = document.createElement("strong");
  username.textContent = message.username || "Usuário";

  const time = document.createElement("time");
  const date = new Date(message.created_at);
  time.dateTime = Number.isNaN(date.getTime()) ? "" : date.toISOString();
  time.textContent = Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      });

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = message.message;

  meta.append(username, time);
  body.append(meta, text);
  article.append(avatar, body);
  messagesEl.append(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function connectSocket() {
  if (socket) socket.disconnect();

  socket = io();

  socket.on("connect", () => {
    connectionBanner.classList.add("hidden");
    socket.emit("join channel", currentChannel);
  });

  socket.on("disconnect", () => {
    connectionBanner.classList.remove("hidden");
  });

  socket.on("connect_error", (error) => {
    connectionBanner.classList.remove("hidden");
    console.error("Falha na conexão do chat:", error.message);
  });

  socket.on("chat history", (history) => {
    messagesEl.replaceChildren();
    addWelcomeMessage();

    for (const message of history) addMessage(message);
  });

  socket.on("chat message", (message) => {
    addMessage(message);
  });

  socket.on("chat error", (message) => {
    chatError.textContent = message;
    clearTimeout(toastMessageTimer);

    toastMessageTimer = setTimeout(() => {
      chatError.textContent = "";
    }, 3500);
  });
}

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const message = messageInput.value.trim();

  if (!message || !socket?.connected) {
    if (!socket?.connected) showToast("Reconectando ao chat...");
    return;
  }

  socket.emit("send message", {
    channel: currentChannel,
    message
  });

  messageInput.value = "";
  messageInput.focus();
});

$("#emojiButton").addEventListener("click", () => {
  messageInput.value += " 😊";
  messageInput.focus();
});

$("#logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    if (socket) socket.disconnect();
    currentUser = null;
    appView.classList.add("hidden");
    authView.classList.remove("hidden");
    authForm.reset();
    setAuthMode("login");
    showToast("Você saiu da sua conta.");
  } catch (error) {
    showToast(error.message);
  }
});

function openSettings() {
  $("#settingsPanel").classList.remove("hidden");
}

function closeSettings() {
  $("#settingsPanel").classList.add("hidden");
}

$("#settingsButton").addEventListener("click", openSettings);
$("#themeShortcut").addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", closeSettings);
$("#closeRightPanel").addEventListener("click", closeSettings);

function validColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#8b5cf6";
}

function applySettings(settings) {
  document.documentElement.style.setProperty(
    "--accent",
    validColor(settings.accent)
  );

  document.documentElement.style.setProperty(
    "--font-size",
    `${Math.max(14, Math.min(20, Number(settings.fontSize) || 16)}px`
  );

  document.body.classList.remove("dark", "midnight", "light", "serif", "mono");
  document.body.classList.add(
    ["dark", "midnight", "light"].includes(settings.theme)
      ? settings.theme
      : "dark"
  );

  if (settings.font === "serif") document.body.classList.add("serif");
  if (settings.font === "mono") document.body.classList.add("mono");

  $("#accentColor").value = validColor(settings.accent);
  $("#themeSelect").value = settings.theme || "dark";
  $("#fontSelect").value = settings.font || "inter";
  $("#fontSize").value = settings.fontSize || 16;
  $("#fontSizeLabel").textContent = `${$("#fontSize").value} px`;
}

function readSettings() {
  return {
    accent: $("#accentColor").value,
    theme: $("#themeSelect").value,
    font: $("#fontSelect").value,
    fontSize: Number($("#fontSize").value)
  };
}

function applySavedSettings() {
  let settings = {};

  try {
    settings = JSON.parse(localStorage.getItem("nexo-settings") || "{}");
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

$("#fontSize").addEventListener("input", () => {
  $("#fontSizeLabel").textContent = `${$("#fontSize").value} px`;
  applySettings(readSettings());
});

$("#accentColor").addEventListener("input", () => {
  applySettings(readSettings());
});

$("#themeSelect").addEventListener("change", () => {
  applySettings(readSettings());
});

$("#fontSelect").addEventListener("change", () => {
  applySettings(readSettings());
});

$("#saveSettings").addEventListener("click", () => {
  const settings = readSettings();

  try {
    localStorage.setItem("nexo-settings", JSON.stringify(settings));
    applySettings(settings);
    $("#settingsMessage").textContent = "Aparência salva neste navegador.";
    showToast("Personalização aplicada!");
  } catch {
    $("#settingsMessage").textContent =
      "Não foi possível salvar as configurações.";
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
    console.error("Não foi possível restaurar a sessão:", error.message);
  }
}

restoreSession();
