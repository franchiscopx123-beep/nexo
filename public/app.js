
"use strict";

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
    throw new Error(
      data.error || "Não foi possível completar a solicitação."
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

function validatePassword(password) {
  if (password.length < 6) {
    return "A senha deve ter pelo menos 6 caracteres.";
  }

  if (new TextEncoder().encode(password).length > 72) {
    return "A senha não pode ultrapassar 72 bytes.";
  }

  if (!/[A-Z]/.test(password)) {
    return "Inclua pelo menos uma letra maiúscula.";
  }

  if (!/[a-z]/.test(password)) {
    return "Inclua pelo menos uma letra minúscula.";
  }

  if (!/[0-9]/.test(password)) {
    return "Inclua pelo menos um número.";
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Inclua pelo menos um símbolo, como @, # ou !.";
  }

  return "";
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  const registering = authMode === "register";

  const loginTab = $("#loginTab");
  const registerTab = $("#registerTab");
  const username = $("#username");
  const usernameLabel = $("#usernameLabel");
  const identifier = $("#identifier");
  const password = $("#password");
  const passwordHint = $("#passwordHint");
  const submitButton = $("#authSubmit");

  loginTab?.classList.toggle("active", !registering);
  registerTab?.classList.toggle("active", registering);

  if (username) {
    username.classList.toggle("hidden", !registering);
    username.required = registering;
  }

  usernameLabel?.classList.toggle("hidden", !registering);

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
    password.minLength = registering ? 6 : 1;
    password.maxLength = 72;
  }

  if (passwordHint) {
    passwordHint.textContent = registering
      ? "Mínimo de 6 caracteres, com maiúscula, minúscula, número e símbolo."
      : "";
  }

  if (submitButton) {
    submitButton.textContent = registering
      ? "Criar minha conta"
      : "Entrar no NEXO";
    submitButton.disabled = false;
  }

  if (authError) authError.textContent = "";
}

function setupAuthTabs() {
  const loginTab = $("#loginTab");
  const registerTab = $("#registerTab");

  if (!loginTab || !registerTab) {
    console.error(
      "NEXO: não encontrei #loginTab ou #registerTab em public/index.html."
    );
    return;
  }

  loginTab.addEventListener("click", (event) => {
    event.preventDefault();
    setAuthMode("login");
  });

  registerTab.addEventListener("click", (event) => {
    event.preventDefault();
    setAuthMode("register");
  });
}

function setupAuthForm() {
  if (!authForm) {
    console.error("NEXO: não encontrei o formulário #authForm.");
    return;
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (authError) authError.textContent = "";

    const button = $("#authSubmit");
    const identifier = $("#identifier")?.value.trim() || "";
    const password = $("#password")?.value || "";
    const username = $("#username")?.value.trim() || "";

    if (authMode === "register") {
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
        if (authError) {
          authError.textContent =
            "O nome deve ter de 3 a 24 caracteres: letras, números ou _.";
        }
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
        if (authError) authError.textContent = "Digite um e-mail válido.";
        return;
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        if (authError) authError.textContent = passwordError;
        return;
      }
    }

    if (!identifier || !password) {
      if (authError) {
        authError.textContent = "Preencha o e-mail/usuário e a senha.";
      }
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "Aguarde...";
    }

    try {
      let result;

      if (authMode === "register") {
        result = await api("/api/register", {
          method: "POST",
          body: JSON.stringify({
            username,
            email: identifier,
            password
          })
        });
      } else {
        result = await api("/api/login", {
          method: "POST",
          body: JSON.stringify({
            identifier,
            password
          })
        });
      }

      currentUser = result.user;
      await enterApp();
    } catch (error) {
      if (authError) authError.textContent = error.message;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = authMode === "register"
          ? "Criar minha conta"
          : "Entrar no NEXO";
      }
    }
  });
}

async function enterApp() {
  if (!currentUser) return;

  authView?.classList.add("hidden");
  appView?.classList.remove("hidden");

  if ($("#currentUsername")) {
    $("#currentUsername").textContent = currentUser.username;
  }

  if ($("#userAvatar")) {
    $("#userAvatar").textContent =
      currentUser.username.charAt(0).toUpperCase();
  }

  applySavedSettings();

  try {
    await loadChannels();
    connectSocket();
  } catch (error) {
    console.error("Erro ao abrir o NEXO:", error.message);
    showToast("Não foi possível carregar os canais. Atualize a página.");
  }
}

async function loadChannels() {
  const data = await api("/api/channels");
  const list = $("#channelList");

  if (!list) return;

  list.replaceChildren();

  for (const item of data) {
    const channel = typeof item === "string"
      ? { id: item, name: item, icon: "#" }
      : item;

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
    button.addEventListener("click", () => selectChannel(channel.id));
    list.append(button);
  }

  updateChannelHeader();
}

function updateChannelHeader() {
  const button = document.querySelector(
    `.channel-btn[data-channel="${currentChannel}"]`
  );

  if ($("#channelName")) {
    $("#channelName").textContent = button
      ? button.querySelector("span:last-child").textContent
      : currentChannel;
  }

  if ($("#channelIcon")) $("#channelIcon").textContent = "#";

  if ($("#channelDescription")) {
    $("#channelDescription").textContent =
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
  if (typeof io !== "function") {
    showToast("Não foi possível carregar a conexão do chat.");
    return;
  }

  if (socket) socket.disconnect();
  socket = io();

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
    messagesEl?.replaceChildren();
    addWelcomeMessage();
    history.forEach(addMessage);
  });

  socket.on("chat message", addMessage);

  socket.on("chat error", (message) => {
    if (chatError) chatError.textContent = message;

    clearTimeout(toastMessageTimer);
    toastMessageTimer = setTimeout(() => {
      if (chatError) chatError.textContent = "";
    }, 3500);
  });
}

messageForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const message = messageInput?.value.trim() || "";

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

$("#emojiButton")?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!messageInput) return;

  messageInput.value += " 😊";
  messageInput.focus();
});

$("#logoutButton")?.addEventListener("click", async (event) => {
  event.preventDefault();

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

$("#settingsButton")?.addEventListener("click", openSettings);
$("#themeShortcut")?.addEventListener("click", openSettings);
$("#closeSettings")?.addEventListener("click", closeSettings);
$("#closeRightPanel")?.addEventListener("click", closeSettings);

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

  document.body.classList.remove(
    "dark", "midnight", "light", "serif", "mono"
  );

  document.body.classList.add(
    ["dark", "midnight", "light"].includes(settings.theme)
      ? settings.theme
      : "dark"
  );

  if (settings.font === "serif") {
    document.body.classList.add("serif");
  }

  if (settings.font === "mono") {
    document.body.classList.add("mono");
  }

  if ($("#accentColor")) {
    $("#accentColor").value = validColor(settings.accent);
  }

  if ($("#themeSelect")) {
    $("#themeSelect").value = settings.theme || "dark";
  }

  if ($("#fontSelect")) {
    $("#fontSelect").value = settings.font || "inter";
  }

  if ($("#fontSize")) {
    $("#fontSize").value = settings.fontSize || 16;
  }

  if ($("#fontSizeLabel")) {
    $("#fontSizeLabel").textContent =
      `${$("#fontSize")?.value || 16} px`;
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

$("#fontSize")?.addEventListener("input", () => {
  if ($("#fontSizeLabel")) {
    $("#fontSizeLabel").textContent = `${$("#fontSize").value} px`;
  }

  applySettings(readSettings());
});

$("#accentColor")?.addEventListener("input", () => {
  applySettings(readSettings());
});

$("#themeSelect")?.addEventListener("change", () => {
  applySettings(readSettings());
});

$("#fontSelect")?.addEventListener("change", () => {
  applySettings(readSettings());
});

$("#saveSettings")?.addEventListener("click", (event) => {
  event.preventDefault();

  try {
    const settings = readSettings();
    localStorage.setItem("nexo-settings", JSON.stringify(settings));
    applySettings(settings);

    if ($("#settingsMessage")) {
      $("#settingsMessage").textContent =
        "Aparência salva neste navegador.";
    }

    showToast("Personalização aplicada!");
  } catch {
    if ($("#settingsMessage")) {
      $("#settingsMessage").textContent =
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

function initialize() {
  if (!authForm || !$("#loginTab") || !$("#registerTab")) {
    console.error(
      "NEXO: confira se public/index.html contém authForm, loginTab e registerTab."
    );
  }

  setupAuthTabs();
  setupAuthForm();
  setAuthMode("login");
  restoreSession();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}
