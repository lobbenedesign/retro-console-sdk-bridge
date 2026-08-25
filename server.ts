#!/usr/bin/env bun
/**
 * 🎮 RETRO CONSOLE SDK BRIDGE (v1.2.0)
 * Progetto indipendente e non ufficiale, non affiliato né approvato da Nintendo.
 * Wrapper HAL sopra toolchain open-source reali (devkitPro, WLA-DX) per
 * homebrew su console Nintendo Switch/Wii/GameCube/N64/SNES.
 * Core compilation server, toolchain bridge, and retro console simulator.
 */

import { CompilerPipeline } from "./src/compiler_pipeline";
import { applyPatch, detectPatchFormat } from "./src/rom_patcher";
import { REQUIRED_DECLARATION_TEXT, recordDeclaration, verifyToken } from "./src/rom_declaration";
import { join } from "path";
import { existsSync, writeFileSync } from "fs";

const PORT = Number(process.env.PORT) || 3014;
const pipeline = new CompilerPipeline();

const HTML_DASHBOARD = `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Retro Console SDK Bridge</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;700;900&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #07080e;
      --bg-card: #0e111d;
      --primary: #7c3aed; /* neutrale, non associato al branding Nintendo */
      --accent: #00c6ff;
      --border: #1e2538;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --glow: rgba(124, 58, 237, 0.4);
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
      background: linear-gradient(135deg, var(--primary), #5b21b6);
      border-color: var(--primary);
      color: #fff;
      box-shadow: 0 4px 12px rgba(124,58,237,0.3);
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
      <h1>Retro Console SDK Bridge</h1>
    </div>
    <div class="badge">v1.2.0 — non ufficiale, non affiliato a Nintendo</div>
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
          <button class="btn-action" style="background:#141929;color:#fff;border:1px solid var(--border);" onclick="runScaffold()">Genera Progetto Makefile Reale</button>
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
      <h2 style="margin-top:20px;">Toolchain reali su questa macchina</h2>
      <div class="memory-map" id="toolchain-status">
        <!-- popolato da /api/toolchains -->
      </div>
      <h2 style="margin-top:20px;">Memory Layout (RAM Map)</h2>
      <div class="memory-map" id="mem-map">
        <!-- Dynamically populated memory map -->
      </div>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🩹 Patcher di ROM reale (IPS / BPS)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Applica una patch (solo differenze byte-a-byte, mai contenuto protetto) a una ROM che fornisci tu dal tuo disco.
        Nessuna ROM viene scaricata, ospitata o distribuita da questo strumento — tutto avviene in locale.
      </p>

      <div id="declaration-gate">
        <h2 style="margin-top:16px;">1. Dichiarazione d'uso (richiesta)</h2>
        <p style="font-size:11.5px; color:#f87171; margin-bottom:8px;">
          Nota onesta: nessuno strumento locale può verificare realmente se possiedi una copia autentica del gioco.
          Questo passaggio registra una dichiarazione da te firmata (non una semplice checkbox), non una prova legale di possesso.
        </p>
        <div class="console-logs" id="declaration-text" style="color:#e5e7eb; height:auto; max-height:120px;"></div>
        <label class="meta-item" style="display:block; margin-top:10px;">Nome e cognome:</label>
        <input type="text" id="decl-name" placeholder="Mario Rossi" style="width:100%; padding:8px; margin-bottom:8px; background:#05060b; border:1px solid var(--border); border-radius:6px; color:#fff;" />
        <label class="meta-item" style="display:block;">Ridigita o incolla esattamente il testo sopra:</label>
        <textarea id="decl-statement" rows="3" style="width:100%; background:#05060b; border:1px solid var(--border); border-radius:6px; color:#fff; padding:8px; font-size:12px;"></textarea>
        <button class="btn-action btn-compile" style="margin-top:10px;" onclick="acceptDeclaration()">Registra dichiarazione</button>
        <div id="decl-status" style="margin-top:8px; font-size:12px;"></div>
      </div>

      <div id="patch-section" style="display:none; margin-top:20px;">
        <h2>2. File (solo locali, mai caricati altrove che su questo server)</h2>
        <label class="meta-item" style="display:block;">ROM base (tua, originale):</label>
        <input type="file" id="rom-file" style="margin-bottom:10px;" />
        <label class="meta-item" style="display:block;">File patch (.ips o .bps):</label>
        <input type="file" id="patch-file" style="margin-bottom:10px;" />
        <button class="btn-action btn-compile" onclick="applyRomPatch()">Applica patch reale</button>
        <div class="console-logs" id="patch-log" style="margin-top:10px;">In attesa...</div>
        <div id="patch-download"></div>
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
        logs.style.color = data.success ? '#22c55e' : '#f87171';
        document.getElementById('meta-size').textContent = data.success ? (data.elfSize / 1024).toFixed(2) + ' KB' : '— (nessun binario reale)';
      } catch (e) {
        logs.textContent = 'Error: ' + e.message;
      }
    }

    async function runScaffold() {
      const logs = document.getElementById('logs');
      logs.style.color = '#22c55e';
      logs.textContent = '⚡ Generazione scaffold in corso...';
      try {
        const res = await fetch('/api/scaffold?platform=' + encodeURIComponent(activePlatform));
        const data = await res.json();
        if (data.error) {
          logs.style.color = '#f87171';
          logs.textContent = '✗ ' + data.error;
          return;
        }
        const fileList = Object.keys(data.files).join(', ');
        logs.textContent = '✓ Scaffold reale generato: ' + fileList + '\\n\\n' + data.notes +
          '\\n\\nScaricare i file qui sotto e lanciare "make" con devkitPro reale installato.';
        // Offerta di download reale via Blob, un file alla volta.
        Object.entries(data.files).forEach(([name, content]) => {
          const blob = new Blob([content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = name.replace(/\\//g, '_');
          a.textContent = '⬇ ' + name;
          a.style.cssText = 'display:block;color:var(--accent);margin-top:6px;font-family:monospace;font-size:12px;';
          logs.appendChild(document.createElement('br'));
          logs.appendChild(a);
        });
      } catch (e) {
        logs.style.color = '#f87171';
        logs.textContent = 'Error: ' + e.message;
      }
    }

    async function loadToolchainStatus() {
      const panel = document.getElementById('toolchain-status');
      try {
        const res = await fetch('/api/toolchains');
        const data = await res.json();
        panel.innerHTML = '';
        Object.entries(data).forEach(([plat, info]) => {
          const row = document.createElement('div');
          row.className = 'mem-row';
          const ok = info.detected;
          row.innerHTML = '<span>' + plat.toUpperCase() + '</span><span class="val" style="color:' +
            (ok ? '#22c55e' : '#f87171') + '">' + (ok ? '✓ ' + info.path : '✗ non installato') + '</span>';
          panel.appendChild(row);
        });
      } catch (e) {
        panel.textContent = 'Errore nel leggere lo stato toolchain: ' + e.message;
      }
    }

    updateMeta();
    loadToolchainStatus();

    // --- Patcher di ROM reale ---
    let declarationToken = null;
    let declarationName = null;

    async function loadDeclarationText() {
      try {
        const res = await fetch('/api/patcher/declaration-text');
        const data = await res.json();
        document.getElementById('declaration-text').textContent = data.text;
      } catch (e) {
        document.getElementById('declaration-text').textContent = 'Errore nel caricare la dichiarazione: ' + e.message;
      }
    }
    loadDeclarationText();

    async function acceptDeclaration() {
      const fullName = document.getElementById('decl-name').value;
      const statement = document.getElementById('decl-statement').value;
      const statusEl = document.getElementById('decl-status');
      statusEl.style.color = '#9ca3af';
      statusEl.textContent = 'Registrazione in corso...';
      try {
        const res = await fetch('/api/patcher/acknowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName, statement })
        });
        const data = await res.json();
        if (data.error) {
          statusEl.style.color = '#f87171';
          statusEl.textContent = '✗ ' + data.error;
          return;
        }
        declarationToken = data.token;
        declarationName = fullName;
        statusEl.style.color = '#22c55e';
        statusEl.textContent = '✓ Dichiarazione registrata (id: ' + data.declarationId.slice(0, 8) + '…). Puoi ora procedere.';
        document.getElementById('patch-section').style.display = 'block';
      } catch (e) {
        statusEl.style.color = '#f87171';
        statusEl.textContent = 'Errore: ' + e.message;
      }
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function applyRomPatch() {
      const log = document.getElementById('patch-log');
      const downloadDiv = document.getElementById('patch-download');
      downloadDiv.innerHTML = '';
      const romInput = document.getElementById('rom-file');
      const patchInput = document.getElementById('patch-file');

      if (!romInput.files[0] || !patchInput.files[0]) {
        log.style.color = '#f87171';
        log.textContent = 'Seleziona sia la ROM base che il file patch.';
        return;
      }
      if (!declarationToken) {
        log.style.color = '#f87171';
        log.textContent = 'Completa prima la dichiarazione.';
        return;
      }

      log.style.color = '#9ca3af';
      log.textContent = '⚡ Applicazione patch reale in corso (byte-a-byte, in locale)...';

      try {
        const [romBase64, patchBase64] = await Promise.all([
          fileToBase64(romInput.files[0]),
          fileToBase64(patchInput.files[0])
        ]);

        const res = await fetch('/api/patcher/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: declarationName, token: declarationToken, romBase64, patchBase64 })
        });
        const data = await res.json();
        if (data.error) {
          log.style.color = '#f87171';
          log.textContent = '✗ ' + data.error;
          return;
        }

        let checksumInfo = 'CRC32 sorgente reale: ' + data.sourceCrc32 + ' · CRC32 risultato reale: ' + data.targetCrc32;
        if (data.format === 'BPS') {
          checksumInfo += '\\nCRC32 sorgente atteso dalla patch: ' + data.expectedSourceCrc32 +
            (data.sourceCrcMatched ? ' ✓ combacia' : ' ✗ NON combacia (la ROM fornita potrebbe non essere quella corretta per questa patch)');
        }

        log.style.color = data.sourceCrcMatched === false ? '#facc15' : '#22c55e';
        log.textContent = '✓ Patch ' + data.format + ' applicata realmente (' + data.patchesApplied + ' record). ' +
          data.inputSizeBytes + ' -> ' + data.outputSizeBytes + ' byte.\\n' + checksumInfo;

        const bin = atob(data.outputBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = romInput.files[0].name.replace(/(\\.[^.]+)$/, '_patched$1');
        a.textContent = '⬇ Scarica ROM patchata (' + (data.outputSizeBytes / 1024).toFixed(1) + ' KB)';
        a.style.cssText = 'display:block;color:var(--accent);margin-top:8px;font-family:monospace;font-size:12px;';
        downloadDiv.appendChild(a);
      } catch (e) {
        log.style.color = '#f87171';
        log.textContent = 'Errore: ' + e.message;
      }
    }
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

    // 3. Toolchain status API — mostra, piattaforma per piattaforma, quali
    // toolchain reali sono installati SU QUESTA macchina in questo momento.
    if (url.pathname === "/api/toolchains" && req.method === "GET") {
      return new Response(JSON.stringify(pipeline.detectToolchains()), { headers });
    }

    // 4. Scaffold API — genera un vero Makefile devkitPro + main.c per far
    // partire un progetto homebrew reale multi-file col sistema di build
    // standard, invece del solo compilatore one-shot di questo studio.
    if (url.pathname === "/api/scaffold" && req.method === "GET") {
      const platform = url.searchParams.get("platform") as any;
      const result = pipeline.scaffoldProject(platform);
      return new Response(JSON.stringify(result), { headers });
    }

    // 5. Testo reale della dichiarazione richiesta prima di usare il patcher ROM.
    if (url.pathname === "/api/patcher/declaration-text" && req.method === "GET") {
      return new Response(JSON.stringify({ text: REQUIRED_DECLARATION_TEXT }), { headers });
    }

    // 6. Registra realmente la dichiarazione (mai una semplice checkbox non
    // verificata): l'utente deve ridigitare/incollare il testo esatto. Logga
    // su disco (data/rom_patch_declarations.jsonl) e ritorna un token HMAC
    // reale verificabile. NOTA ONESTA: questo prova solo che l'utente ha
    // completato il passaggio di dichiarazione, non che possiede davvero il
    // gioco — nessuno strumento locale può verificarlo realmente.
    if (url.pathname === "/api/patcher/acknowledge" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const { token, declarationId } = recordDeclaration(body.fullName, body.statement);
        return new Response(JSON.stringify({ success: true, token, declarationId }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 7. Applica realmente una patch IPS/BPS a una ROM fornita dal client
    // (entrambe come base64 nel body, mai scaricate da questo server). Il
    // token di dichiarazione è richiesto e verificato realmente (HMAC), non
    // solo controllato "truthy". Nessuna ROM viene salvata su disco dal
    // server: i byte vengono processati in memoria e ritornati al client.
    if (url.pathname === "/api/patcher/apply" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const { fullName, token, romBase64, patchBase64 } = body;

        if (!verifyToken(token, fullName)) {
          return new Response(JSON.stringify({
            error: "Dichiarazione non valida o mancante. Completa prima la dichiarazione tramite /api/patcher/acknowledge."
          }), { status: 403, headers });
        }
        if (!romBase64 || !patchBase64) {
          return new Response(JSON.stringify({ error: "romBase64 e patchBase64 sono richiesti." }), { status: 400, headers });
        }

        const source = new Uint8Array(Buffer.from(romBase64, "base64"));
        const patch = new Uint8Array(Buffer.from(patchBase64, "base64"));
        const format = detectPatchFormat(patch);
        if (!format) {
          return new Response(JSON.stringify({ error: "Formato patch non riconosciuto (atteso IPS o BPS)." }), { status: 400, headers });
        }

        const result = applyPatch(source, patch);
        return new Response(JSON.stringify({
          ...result,
          outputBase64: Buffer.from(result.outputBytes).toString("base64"),
          outputBytes: undefined // non serializzare il typed array grezzo nel JSON
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
});

console.log(`\n======================================================`);
console.log(`🎮 Retro Console SDK Bridge (non ufficiale, non affiliato a Nintendo) — http://localhost:${PORT}`);
console.log(`🚀 Unified target compiles: SNES, N64, GameCube, Wii, Switch`);
console.log(`======================================================\n`);
