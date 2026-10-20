
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
let reconnecting = false;

const channelDescriptions = {
  geral: "Um espaço para conversar e compartilhar ideias.",
  jogos: "Converse sobre jogos e suas novidades.",
  tecnologia: "Ideias, tecnologia e inovação.",
  conversa: "Um lugar para conversas descontraídas."
};

const defaultSettings = {
  theme: "dark",
  fontSize: "16",
  sound: false
};

let settings = loadSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("nexo-settings") || "{}");
    return { ...defaultSettings, ...saved };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  try {
    localStorage.setItem("nexo-settings", JSON.stringify(settings));
  } catch {
    showToast("Não foi possível salvar as configurações.");
  }
}

async function api(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error(
      "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente."
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : {};

  if (!response.ok) {
    throw new Error(
      data.error ||
      `Erro ${response.status}: não foi possível completar a solicitação.`
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

  toast.textContent = String(message);
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function showAuthError(message) {
  if (authError) authError.textContent = message;
}

function showChatError(message) {
  if (chatError) chatError.textContent = message;
  else if (message) showToast(message);
}

function setConnectionStatus(connected) {
  if (!connectionBanner) return;

  connectionBanner.classList.toggle("hidden", connected);
  connectionBanner.textContent = connected
    ? ""
    : "Reconectando ao servidor...";
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

  loginTab?.setAttribute("aria-selected", String(!registering));
  registerTab?.setAttribute("aria-selected", String(registering));

  if (username) {
    username.classList.toggle("hidden", !registering);
    username.required = registering;
    username.autocomplete = "username";
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

  showAuthError("");
}

function setupAuthTabs() {
  $("#loginTab")?.addEventListener("click", (event) => {
    event.preventDefault();
    setAuthMode("login");
  });

  $("#registerTab")?.addEventListener("click", (event) => {
    event.preventDefault();
    setAuthMode("register");
  });
}

function showApplication(user) {
  currentUser = user;

  authView?.classList.add("hidden");
  appView?.classList.remove("hidden");

  const displayName =
    user.username ||
    user.name ||
    user.email ||
    "Usuário";

  const nameElement = $("#currentUsername");
  const avatarElement = $("#userAvatar");
  const emailElement = $("#currentUserEmail");

  if (nameElement) nameElement.textContent = displayName;
  if (emailElement) emailElement.textContent = user.email || "";

  if (avatarElement) {
    avatarElement.textContent = displayName.charAt(0).toUpperCase();
  }

  applySettings();
  connectSocket();
  loadChannels();
}

function showAuthentication() {
  currentUser = null;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  appView?.classList.add("hidden");
  authView?.classList.remove("hidden");

  if (authForm) authForm.reset();

  setAuthMode("login");
}

function setupAuthForm() {
  if (!authForm) {
    console.error("NEXO: não encontrei o formulário #authForm.");
    return;
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthError("");

    const button = $("#authSubmit");
    const identifier = $("#identifier")?.value.trim() || "";
    const password = $("#password")?.value || "";
    const username = $("#username")?.value.trim() || "";

    if (authMode === "register") {
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
        showAuthError(
          "O nome deve ter de 3 a 24 caracteres: letras, números ou _."
        );
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
        showAuthError("Digite um e-mail válido.");
        return;
      }

      const passwordError = validatePassword(password);

      if (passwordError) {
        showAuthError(passwordError);
        return;
      }
    }

    if (!identifier || !password) {
      showAuthError("Preencha o e-mail/usuário e a senha.");
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
            email: identifier,
            username: identifier,
            password
          })
        });
      }

      const user = result.user || result;

      if (!user || (!user.username && !user.email && !user.id)) {
        const me = await api("/api/me");
        showApplication(me.user || me);
      } else {
        showApplication(user);
      }

      showToast(
        authMode === "register"
          ? "Conta criada com sucesso!"
          : "Login realizado com sucesso!"
      );
    } catch (error) {
      showAuthError(error.message || "Não foi possível entrar.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent =
          authMode === "register"
            ? "Criar minha conta"
            : "Entrar no NEXO";
      }
    }
  });
}

function connectSocket() {
  if (typeof window.io !== "function") {
    setConnectionStatus(false);
    showChatError(
      "Socket.IO não foi carregado. Verifique se o servidor disponibiliza /socket.io/socket.io.js."
    );
    return;
  }

  if (socket) socket.disconnect();

  socket = window.io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  socket.on("connect", () => {
    reconnecting = false;
    setConnectionStatus(true);
    socket.emit("join channel", currentChannel);
  });

  socket.on("disconnect", () => {
    reconnecting = true;
    setConnectionStatus(false);
  });

  socket.on("connect_error", () => {
    setConnectionStatus(false);
  });

  socket.on("chat history", (history) => {
    renderMessages(Array.isArray(history) ? history : []);
  });

  socket.on("chat message", (message) => {
    if (!message || typeof message !== "object") return;
    appendMessage(message);
  });

  socket.on("chat error", (error) => {
    const message =
      typeof error === "string"
        ? error
        : error?.message || "Não foi possível enviar a mensagem.";

    showChatError(message);
  });
}

async function loadChannels() {
  try {
    const result = await api("/api/channels");
    const channels = Array.isArray(result)
      ? result
      : Array.isArray(result.channels)
        ? result.channels
        : [];

    if (channels.length) {
      renderChannels(channels);
    } else {
      renderChannels(
        Object.keys(channelDescriptions).map((name) => ({
          name,
          description: channelDescriptions[name]
        }))
      );
    }
  } catch (error) {
    console.warn("NEXO: não foi possível carregar os canais.", error);
    renderChannels(
      Object.keys(channelDescriptions).map((name) => ({
        name,
        description: channelDescriptions[name]
      }))
    );
  }
}

function normalizeChannel(channel) {
  if (typeof channel === "string") {
    return {
      name: channel.replace(/^#/, ""),
      description: channelDescriptions[channel] || ""
    };
  }

  const name = channel?.name || channel?.slug || channel?.id || "geral";

  return {
    name: String(name).replace(/^#/, ""),
    description:
      channel?.description ||
      channelDescriptions[String(name).replace(/^#/, "")] ||
      ""
  };
}

function renderChannels(channels) {
  const container =
    $("#channelList") ||
    $("#channels") ||
    $(".channel-list");

  if (!container) return;

  container.replaceChildren();

  channels.forEach((rawChannel) => {
    const channel = normalizeChannel(rawChannel);
    const button = document.createElement("button");

    button.type = "button";
    button.className = "channel-btn";
    button.classList.toggle(
      "active",
      channel.name === currentChannel
    );
    button.title = channel.description || `Canal ${channel.name}`;

    const icon = document.createElement("span");
    icon.className = "channel-icon channel-hash";
    icon.textContent = "#";
    icon.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "channel-name";
    name.textContent = channel.name;

    button.append(icon, name);

    button.addEventListener("click", () => {
      joinChannel(channel.name);
    });

    container.appendChild(button);
  });
}

function joinChannel(channelName) {
  const safeName = String(channelName || "")
    .replace(/^#/, "")
    .trim();

  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(safeName)) {
    showToast("Nome de canal inválido.");
    return;
  }

  currentChannel = safeName;

  const title = $("#channelTitle");
  const description = $("#channelDescription");

  if (title) title.textContent = `# ${safeName}`;
  if (description) {
    description.textContent =
      channelDescriptions[safeName] || "Conversa do canal.";
  }

  document
    .querySelectorAll(".channel-btn")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.querySelector(".channel-name")?.textContent === safeName
      );
    });

  if (messagesEl) messagesEl.replaceChildren();
  showChatError("");

  if (socket?.connected) {
    socket.emit("join channel", safeName);
  }
}

function renderMessages(messages) {
  if (!messagesEl) return;

  messagesEl.replaceChildren();

  messages.forEach((message) => appendMessage(message, false));

  scrollToBottom();
}

function appendMessage(message, shouldScroll = true) {
  if (!messagesEl) return;

  const wrapper = document.createElement("article");
  wrapper.className = "message";

  const author = document.createElement("div");
  author.className = "message-author";

  const authorName = document.createElement("span");
  authorName.className = "message-username";
  authorName.textContent =
    message.username ||
    message.user?.username ||
    message.author ||
    "Usuário";

  const time = document.createElement("time");
  time.className = "message-time";

  const rawDate = message.createdAt || message.timestamp || message.date;
  const date = rawDate ? new Date(rawDate) : new Date();

  if (!Number.isNaN(date.getTime())) {
    time.dateTime = date.toISOString();
    time.textContent = date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  author.append(authorName, time);

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = String(message.content ?? message.text ?? "");

  wrapper.append(author, content);
  messagesEl.appendChild(wrapper);

  if (shouldScroll) scrollToBottom();
}

function scrollToBottom() {
  if (!messagesEl) return;

  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function setupMessageForm() {
  if (!messageForm) return;

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const content = messageInput?.value.trim() || "";

    if (!content) return;

    if (content.length > 2000) {
      showChatError("A mensagem não pode ultrapassar 2.000 caracteres.");
      return;
    }

    if (!socket?.connected) {
      showChatError("Você está desconectado. Aguarde a reconexão.");
      return;
    }

    socket.emit("send message", {
      channel: currentChannel,
      content
    });

    messageInput.value = "";
    messageInput.focus();
    showChatError("");
  });
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    console.warn("NEXO: erro ao encerrar sessão.", error);
  } finally {
    showAuthentication();
    showToast("Você saiu da sua conta.");
  }
}

function setupLogout() {
  const logoutButton =
    $("#logoutButton") ||
    $("#logoutBtn") ||
    $("#logout");

  logoutButton?.addEventListener("click", logout);
}

function applySettings() {
  const root = document.documentElement;

  root.dataset.theme = settings.theme;
  document.body?.classList.toggle("light", settings.theme === "light");
  document.body?.classList.toggle("midnight", settings.theme === "midnight");

  root.style.setProperty(
    "--font-size",
    `${Number(settings.fontSize) || 16}px`
  );

  const themeSelect = $("#themeSelect");
  const fontSizeSelect = $("#fontSizeSelect");
  const soundToggle = $("#soundToggle");

  if (themeSelect) themeSelect.value = settings.theme;
  if (fontSizeSelect) fontSizeSelect.value = String(settings.fontSize);
  if (soundToggle) soundToggle.checked = Boolean(settings.sound);
}

function setupSettings() {
  $("#themeSelect")?.addEventListener("change", (event) => {
    const allowed = ["dark", "light", "midnight"];
    const theme = event.target.value;

    settings.theme = allowed.includes(theme) ? theme : "dark";
    saveSettings();
    applySettings();
  });

  $("#fontSizeSelect")?.addEventListener("change", (event) => {
    const size = Number(event.target.value);

    settings.fontSize = [14, 16, 18, 20].includes(size) ? size : 16;
    saveSettings();
    applySettings();
  });

  $("#soundToggle")?.addEventListener("change", (event) => {
    settings.sound = Boolean(event.target.checked);
    saveSettings();
  });

  const settingsButton =
    $("#settingsButton") ||
    $("#settingsBtn");

  const settingsPanel =
    $("#settingsPanel") ||
    $("#settingsModal");

  settingsButton?.addEventListener("click", () => {
    if (!settingsPanel) {
      showToast("Painel de configurações não encontrado.");
      return;
    }

    settingsPanel.classList.toggle("hidden");
    settingsPanel.setAttribute(
      "aria-hidden",
      String(settingsPanel.classList.contains("hidden"))
    );
  });

  $("#closeSettings")?.addEventListener("click", () => {
    settingsPanel?.classList.add("hidden");
    settingsPanel?.setAttribute("aria-hidden", "true");
  });

  applySettings();
}

function setupMessageInput() {
  if (!messageInput) return;

  messageInput.addEventListener("input", () => {
    if (messageInput.value.length > 2000) {
      messageInput.value = messageInput.value.slice(0, 2000);
    }
  });

  messageInput.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      messageForm?.requestSubmit();
    }
  });
}

async function restoreSession() {
  try {
    const result = await api("/api/me");
    const user = result.user || result;

    if (user && (user.username || user.email || user.id)) {
      showApplication(user);
    } else {
      showAuthentication();
    }
  } catch {
    showAuthentication();
  }
}

function setupNavigation() {
  const toggleButton =
    $("#sidebarToggle") ||
    $("#menuButton");

  const sidebar = $("#sidebar");

  toggleButton?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
  });

  document.addEventListener("click", (event) => {
    if (
      sidebar?.classList.contains("open") &&
      !sidebar.contains(event.target) &&
      !toggleButton?.contains(event.target)
    ) {
      sidebar.classList.remove("open");
    }
  });
}

function initialize() {
  setupAuthTabs();
  setupAuthForm();
  setupMessageForm();
  setupMessageInput();
  setupLogout();
  setupSettings();
  setupNavigation();
  setAuthMode("login");
  restoreSession();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}
