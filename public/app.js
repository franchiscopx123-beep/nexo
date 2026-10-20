```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#101522">
  <title>NEXO — Conecte-se</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="auth-container" id="authView">
    <section class="auth-card">
      <header class="auth-header">
        <h1>NEXO</h1>
        <p>Conecte-se com o seu mundo.</p>
      </header>

      <div class="auth-tabs">
        <button type="button" id="loginTab" class="active">
          Entrar
        </button>
        <button type="button" id="registerTab">
          Cadastrar
        </button>
      </div>

      <form id="authForm">
        <div id="nameGroup" hidden>
          <label for="name">Nome</label>
          <input
            id="name"
            name="name"
            type="text"
            placeholder="Seu nome"
            autocomplete="name"
          >
        </div>

        <div id="emailGroup">
          <label for="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="seu@email.com"
            autocomplete="email"
            required
          >
        </div>

        <div id="passwordGroup">
          <label for="password">Senha</label>
          <div class="password-wrapper">
            <input
              id="password"
              name="password"
              type="password"
              placeholder="Digite sua senha"
              autocomplete="current-password"
              required
            >
            <button
              type="button"
              id="togglePassword"
              class="password-toggle"
              aria-label="Mostrar senha"
              aria-pressed="false"
            >Mostrar</button>
          </div>
        </div>

        <div id="confirmPasswordGroup" hidden>
          <label for="confirmPassword">Confirmar senha</label>
          <div class="password-wrapper">
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              placeholder="Digite a senha novamente"
              autocomplete="new-password"
            >
            <button
              type="button"
              id="toggleConfirmPassword"
              class="password-toggle"
              aria-label="Mostrar confirmação de senha"
              aria-pressed="false"
            >Mostrar</button>
          </div>
          <p
            id="confirmPasswordMessage"
            class="form-message"
            aria-live="polite"
          ></p>
        </div>

        <p id="authMessage" class="form-message" aria-live="polite"></p>

        <button type="submit" id="authSubmit">
          Entrar
        </button>
      </form>
    </section>
  </main>

  <main id="appView" hidden>
    <aside id="sidebar">
      <h2>NEXO</h2>
      <button type="button" id="newChatButton">Nova conversa</button>
      <div id="channelsList"></div>
    </aside>

    <section id="chatView">
      <header id="chatHeader">
        <h2 id="chatTitle">NEXO</h2>
      </header>

      <div id="messages"></div>

      <form id="messageForm">
        <textarea
          id="messageInput"
          name="message"
          placeholder="Digite sua mensagem..."
          rows="1"
        ></textarea>
        <button type="submit
