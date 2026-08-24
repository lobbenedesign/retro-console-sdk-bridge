#!/usr/bin/env bun
/**
 * 🎮 NINTENDO UNIVERSAL SDK STUDIO (v1.0.0)
 * Core compilation server, toolchain bridge, and retro console simulator.
 */

import { CompilerPipeline } from "./src/compiler_pipeline";
import { join } from "path";
import { existsSync, writeFileSync } from "fs";

const PORT = Number(process.env.PORT) || 3014;
const pipeline = new CompilerPipeline();

const HTML_DASHBOARD = `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Nintendo Universal SDK Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;700;900&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #07080e;
      --bg-card: #0e111d;
      --primary: #e60012; /* Nintendo Red */
      --accent: #00c6ff;
      --border: #1e2538;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --glow: rgba(230, 0, 18, 0.4);
    }
    body {
      background-color: var(--bg-base);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      overflow-x: hidden;
    }
    header {
      background: var(--bg-card);
      border-bottom: 2px solid var(--primary);
      padding: 20px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 20px var(--glow);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 24px;
      height: 24px;
      background: var(--primary);
      border-radius: 50%;
      box-shadow: 0 0 12px var(--primary);
      animation: pulse 2s infinite;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 1px;
      background: linear-gradient(135deg, #fff, var(--text-muted));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .container {
      display: grid;
      grid-template-columns: 320px 1fr 380px;
      gap: 24px;
      padding: 24px;
      flex-grow: 1;
    }
    .sidebar, .main-editor, .inspector {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    h2 {
      margin-top: 0;
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text);
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    .platform-selector {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .platform-btn {
      background: #141929;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 12px;
      border-radius: 8px;
      text-align: left;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .platform-btn:hover {
      border-color: var(--primary);
      color: #fff;
    }
    .platform-btn.active {
      background: linear-gradient(135deg, var(--primary), #b3000e);
      border-color: var(--primary);
      color: #fff;
      box-shadow: 0 4px 12px rgba(230,0,18,0.3);
    }
    .badge {
      font-size: 10px;
      background: rgba(255,255,255,0.1);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .editor-container {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    textarea {
      flex-grow: 1;
      background: #05060b;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: #38bdf8;
      font-family: 'Fira Code', monospace;
      padding: 16px;
      font-size: 13px;
      resize: none;
      outline: none;
      line-height: 1.5;
    }
    .actions {
      display: flex;
      gap: 12px;
    }
    button.btn-action {
      flex-grow: 1;
      padding: 14px;
      font-size: 14px;
      font-weight: 700;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-compile {
      background: var(--accent);
      color: #000;
    }
    .btn-compile:hover {
      opacity: 0.9;
      box-shadow: 0 0 15px rgba(0, 198, 255, 0.4);
    }
    .console-logs {
      background: #030407;
      border: 1px dashed var(--border);
      padding: 12px;
      border-radius: 8px;
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      color: #22c55e;
      height: 140px;
      overflow-y: auto;
      margin-top: 12px;
      white-space: pre-wrap;
    }
    .meta-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 13px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .meta-item span {
      color: var(--text-muted);
    }
    .meta-item strong {
      color: #fff;
    }
    .memory-map {
      background: #05060b;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      flex-grow: 1;
      overflow-y: auto;
    }
    .mem-row {
      display: flex;
      justify-content: space-between;
      color: #a855f7;
      margin-bottom: 4px;
    }
    .mem-row span.val {
      color: var(--text-muted);
    }
    @keyframes pulse {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.15); opacity: 0.8; }
      100% { transform: scale(1); opacity: 1; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-logo"></div>
      <h1>Nintendo Universal SDK Studio</h1>
    </div>
    <div class="badge">v1.0.0-PRO</div>
  </header>

  <div class="container">
    <div class="sidebar">
      <h2>Piattaforme Target</h2>
      <div class="platform-selector">
        <button class="platform-btn active" onclick="setPlatform('switch')">
          Nintendo Switch <span class="badge">ARM64</span>
        </button>
        <button class="platform-btn" onclick="setPlatform('wii')">
          Nintendo Wii <span class="badge">PowerPC</span>
        </button>
        <button class="platform-btn" onclick="setPlatform('gamecube')">
          Nintendo GameCube <span class="badge">PowerPC</span>
        </button>
        <button class="platform-btn" onclick="setPlatform('n64')">
          Nintendo 64 <span class="badge">MIPS</span>
        </button>
        <button class="platform-btn" onclick="setPlatform('snes')">
          Super Nintendo <span class="badge">W65816</span>
        </button>
      </div>
    </div>

    <div class="main-editor">
      <h2>Editor Sorgente (C/C++ HAL)</h2>
      <div class="editor-container">
        <textarea id="code-editor">// Codice sorgente con astrazione nintendo_hal.h
#include <nintendo_hal.h>

int main() {
    NintendoInitConsole();
    NintendoGamepad gp = {0};
    
    while(1) {
        NintendoUpdateGamepad(&gp);
        if (NintendoIsButtonPressed(&gp, 3)) break; // Start button
        NintendoRefreshScreen();
    }
    return 0;
}</textarea>
        <div class="actions">
          <button class="btn-action btn-compile" onclick="runCompile()">Compila & Pacchettizza</button>
        </div>
        <div class="console-logs" id="logs">Pronto per la compilazione...</div>
      </div>
    </div>

    <div class="inspector">
      <h2>Diagnostica & Mappa di Memoria</h2>
      <div id="diagnostics-panel">
        <div class="meta-item"><span>Target</span><strong id="meta-target">SWITCH</strong></div>
        <div class="meta-item"><span>Compilatore</span><strong id="meta-compiler">aarch64-none-elf-gcc</strong></div>
        <div class="meta-item"><span>Dimensione ROM</span><strong id="meta-size">0 KB</strong></div>
        <div class="meta-item"><span>Tipo Build</span><strong id="meta-type">NRO Executable</strong></div>
      </div>
      <h2 style="margin-top:20px;">Memory Layout (RAM Map)</h2>
      <div class="memory-map" id="mem-map">
        <!-- Dynamically populated memory map -->
      </div>
    </div>
  </div>

  <script>
    let activePlatform = 'switch';
    
    const snesCode = \`// SNES Mode 7 & PPU Code
#include <nintendo_hal.h>

int main() {
    NintendoInitConsole();
    NintendoGamepad gp = {0};
    while(1) {
        NintendoUpdateGamepad(&gp);
        if (NintendoIsButtonPressed(&gp, 3)) break;
        NintendoRefreshScreen();
    }
    return 0;
}\`;

    const switchCode = \`// Nintendo Switch ARM64 Game Loop
#include <nintendo_hal.h>

int main() {
    NintendoInitConsole();
    NintendoGamepad gp = {0};
    while(1) {
        NintendoUpdateGamepad(&gp);
        if (NintendoIsButtonPressed(&gp, 3)) break;
        NintendoRefreshScreen();
    }
    return 0;
}\`;

    const templates = {
      switch: switchCode,
      wii: switchCode.replace("Switch ARM64", "Wii PowerPC"),
      gamecube: switchCode.replace("Switch ARM64", "GameCube PowerPC"),
      n64: switchCode.replace("Switch ARM64", "N64 MIPS"),
      snes: snesCode
    };

    function setPlatform(platform) {
      activePlatform = platform;
      document.querySelectorAll('.platform-btn').forEach(btn => btn.classList.remove('active'));
      event.currentTarget.classList.add('active');
      document.getElementById('code-editor').value = templates[platform];
      updateMeta();
    }

    function updateMeta() {
      document.getElementById('meta-target').textContent = activePlatform.toUpperCase();
      let compiler = 'aarch64-none-elf-gcc';
      let type = 'NRO Container';
      if (activePlatform === 'wii' || activePlatform === 'gamecube') {
        compiler = 'powerpc-eabi-gcc';
        type = 'DOL Binary';
      } else if (activePlatform === 'n64') {
        compiler = 'mips64-elf-gcc';
        type = 'Z64 ROM';
      } else if (activePlatform === 'snes') {
        compiler = 'wla-dx assembler';
        type = 'SFC ROM';
      }
      document.getElementById('meta-compiler').textContent = compiler;
      document.getElementById('meta-type').textContent = type;
      generateMemoryMap();
    }

    function generateMemoryMap() {
      const map = document.getElementById('mem-map');
      map.innerHTML = '';
      let base = 0x08000000;
      if (activePlatform === 'snes') base = 0x7E0000;
      else if (activePlatform === 'n64') base = 0x80000000;
      
      const sections = ['TEXT (Code)', 'RODATA (Constants)', 'DATA (Variables)', 'BSS (Zero-Init)', 'STACK / HEAP'];
      sections.forEach((sec, idx) => {
        const row = document.createElement('div');
        row.className = 'mem-row';
        row.innerHTML = \`<span>\${sec}</span><span class="val">0x\${(base + idx * 0x1000).toString(16).toUpperCase()}</span>\`;
        map.appendChild(row);
      });
    }

    async function runCompile() {
      const code = document.getElementById('code-editor').value;
      const logs = document.getElementById('logs');
      logs.textContent = '⚡ Compilazione in corso...';
      
      try {
        const res = await fetch('/api/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: activePlatform, sourceCode: code })
        });
        const data = await res.json();
        logs.textContent = data.logs;
        document.getElementById('meta-size').textContent = (data.elfSize / 1024).toFixed(2) + ' KB';
      } catch (e) {
        logs.textContent = 'Error: ' + e.message;
      }
    }

    updateMeta();
  </script>
</body>
</html>
`;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (req.method === "OPTIONS") return new Response(null, { headers });

    // 1. Serve UI Dashboard
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_DASHBOARD, { headers: { "Content-Type": "text/html" } });
    }

    // 2. Build API
    if (url.pathname === "/api/build" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const result = await pipeline.compile({
          platform: body.platform,
          sourceCode: body.sourceCode
        });
        return new Response(JSON.stringify(result), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
});

console.log(`\n======================================================`);
console.log(`🎮 NINTENDO UNIVERSAL SDK running on http://localhost:${PORT}`);
console.log(`🚀 Unified target compiles: SNES, N64, GameCube, Wii, Switch`);
console.log(`======================================================\n`);
