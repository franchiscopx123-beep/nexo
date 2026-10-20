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
        if (authError) {
          authError.textContent = "Digite um e-mail válido.";
        }
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
        authError.textContent =
          "Preencha o e-mail/usuário e a senha.";
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
            username
