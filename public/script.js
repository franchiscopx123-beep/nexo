```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0b1120">
  <title>NEXO — Conversas</title>

  <style>
    * { box-sizing: border-box; }

    :root {
      color-scheme: dark;
      --bg: #0b1120;
      --panel: #111827;
      --border: #29364b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --blue: #3b82f6;
      --green: #22c55e;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, Helvetica, sans-serif;
      background: var(--bg);
      color: var(--text);
    }

    button, input { font: inherit; }
    button { cursor: pointer; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    [hidden], .hidden { display: none !important; }

    /* LOGIN E CADASTRO */
    #authView {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background:
        radial-gradient(circle at top, #1e3a5f 0, transparent 45%),
        var(--bg);
    }

    .auth-card {
      width: 100%;
      max-width: 420px;
      padding: 32px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--panel);
      box-shadow: 0 20px 60px #0005;
    }

    .brand {
      margin: 0 0 8px;
      text-align: center;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 5px;
      color: #60a5fa;
    }

    .subtitle {
      margin: 0 0 28px;
      text-align: center;
      color: var(--muted);
    }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
    }

    .tabs button {
      flex: 1;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: #cbd5e1;
      background: #1e293b;
    }

    .tabs button.active {
      color: white;
      background: #2563eb;
      border-color: #2563eb;
    }

    .field { margin-bottom: 16px; }

    .field label {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
      color: #cbd5e1;
    }

    .field input {
      width: 100%;
      min-height: 46px;
      padding: 12px;
      border: 1px solid #475569;
      border-radius: 10px;
      outline: none;
      color: white;
      background: #0f172a;
    }

    .field input:focus { border-color: #60a5fa; }

    .password-wrap { display: flex; gap: 8px; }
    .password-wrap input { min-width: 0; flex: 1; }

    .password-wrap button {
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: #cbd5e1;
      background: #1e293b;
    }

    .primary {
      width: 100%;
      min-height: 46px;
      padding: 12px 16px;
      border: 0;
      border-radius: 10px;
      background
