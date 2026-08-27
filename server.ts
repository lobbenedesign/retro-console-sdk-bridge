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
import { isMio0, mio0Decompress, mio0CompressForTesting } from "./src/n64_mio0";
import { isYay0, yay0Decompress, yay0Compress } from "./src/n64_yay0";
import { computeN64Checksums, fixN64Checksums, type CicChip } from "./src/n64_crc";
import { parseF3dDisplayList, extractF3dMesh } from "./src/n64_f3d";
import { scanRomSections, detectSplat, runSplatSplit } from "./src/n64_split";
import { detectN64Recomp, generateRecompToml, runN64Recomp } from "./src/recomp";
import { disassembleMips } from "./src/mips_disasm";
import { parseSnesRomHeader } from "./src/snes_rom_header";
import { serializeF3dVertices, buildF3dDisplayList } from "./src/n64_f3d";
import { parseLevelScript, serializeLevelScript, EDITABLE_COMMAND_NAMES, type LevelCommand } from "./src/sm64_level_script";
import { parseN64RomHeader } from "./src/n64_rom_header";
import { decodeN64Texture, requiredByteLength, BITS_PER_PIXEL, type N64TextureFormat } from "./src/n64_texture";
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

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🔐 Fix checksum CRC header ROM N64 (CIC reale)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Il PIF verifica CRC1/CRC2 a offset 0x10/0x14: una ROM modificata senza ricalcolo NON boota.
        Rileva il chip CIC dall'IPL3 (tabella usata da splat) e ricalcola con gli algoritmi reali
        (famiglia 6102 da sm64tools, variante 6105 da n64checksum). Serve la ROM estesa (≥ 0x101000 byte).
      </p>
      <input type="file" id="crc-file" style="margin-bottom:8px;" />
      <div style="display:flex; gap:10px;">
        <button class="btn-action" style="background:#141929;color:#fff;border:1px solid var(--border);" onclick="crcComputeUI()">Verifica checksum</button>
        <button class="btn-action btn-compile" onclick="crcFixUI()">Ricalcola e scarica ROM fixata</button>
      </div>
      <div class="console-logs" id="crc-log" style="margin-top:10px; height:auto;">In attesa… (il fix richiede la dichiarazione completata)</div>
      <div id="crc-download"></div>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🔷 Splitter ROM: scanner blocchi MIO0/Yay0 + splat reale</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Lo scanner nativo trova i blocchi compressi reali (offset, dimensioni) senza indovinarli a mano.
        Con <code>splat</code> installato (<code>pip install splat</code>) lo split completo separa codice e asset
        come nei progetti di decompilazione reali — eseguito in dir temporanea cancellata subito dopo.
      </p>
      <input type="file" id="split-file" style="margin-bottom:8px;" />
      <div style="display:flex; gap:10px;">
        <button class="btn-action" style="background:#141929;color:#fff;border:1px solid var(--border);" onclick="splitScanUI()">Scansiona blocchi (nativo)</button>
        <button class="btn-action btn-compile" onclick="splatSplitUI()">Split reale con splat</button>
      </div>
      <div class="console-logs" id="split-log" style="margin-top:10px; height:auto; max-height:220px;">In attesa…</div>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🧊 Parser display list F3D → mesh 3D (opcode da n64decomp/sm64, CC0)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Fornisci la display list (8 byte/comando) e, facoltativamente, il blob vertici (16 byte/vertex):
        estrae comandi, vertici e triangoli, e disegna il wireframe reale su canvas.
      </p>
      <label class="meta-item" style="display:block;">File display list:</label>
      <input type="file" id="f3d-dl-file" style="margin-bottom:6px;" />
      <label class="meta-item" style="display:block;">File blob vertici (opzionale, 16 byte/vertex):</label>
      <input type="file" id="f3d-vtx-file" style="margin-bottom:8px;" />
      <button class="btn-action btn-compile" onclick="f3dParseUI()">Interpreta display list reale</button>
      <div class="console-logs" id="f3d-log" style="margin-top:10px; height:auto; max-height:180px;">In attesa…</div>
      <div id="f3d-cmd-table" style="margin-top:10px; max-height:260px; overflow-y:auto;"></div>
      <div id="f3d-vtx-editor" style="display:none; margin-top:12px;">
        <h2 style="font-size:13px;">✏️ Vertici modificabili (round-trip 3D)</h2>
        <div id="f3d-vtx-table" style="max-height:220px; overflow-y:auto;"></div>
        <button class="btn-action btn-compile" style="margin-top:8px;" onclick="f3dSerializeUI()">Riserializza vertici e scarica blob + display list</button>
        <div id="f3d-download"></div>
      </div>
      <canvas id="f3d-canvas" width="480" height="320" style="margin-top:10px; background:#05060b; border:1px solid var(--border); width:100%; max-width:480px;"></canvas>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🔍 Disassembler MIPS R4300i (subset reale del codice N64)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Disassembla realmente un blob di codice (es. una sezione trovata dallo scanner o da splat).
        Subset MIPS I/III documentato: SPECIAL/REGIMM, salti, load/store, aritmetica immediata.
        Istruzioni FPU/COP1 e 64-bit rare → UNKNOWN onesto con la word grezza.
      </p>
      <input type="file" id="mips-file" style="margin-bottom:6px;" />
      <label style="font-size:12px;">Indirizzo base (hex): <input type="text" id="mips-base" value="80246000" style="width:90px; background:#05060b; border:1px solid var(--border); color:#fff; border-radius:4px; padding:4px;" /></label>
      <button class="btn-action btn-compile" style="margin-top:8px;" onclick="mipsDisasmUI()">Disassembla realmente</button>
      <div class="console-logs" id="mips-log" style="margin-top:10px; height:auto;">In attesa…</div>
      <div id="mips-table" style="margin-top:10px; max-height:300px; overflow-y:auto;"></div>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🎮 Inspector header ROM SNES (LoROM / HiROM / ExHiROM)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Prova i tre offset header reali (0x7FC0/0xFFC0/0x40FFC0) e sceglie la mappatura con checksum
        coerente (complement + checksum = 0xFFFF). Titolo, chipset, ROM/SRAM size, regione, versione.
      </p>
      <input type="file" id="snes-file" style="margin-bottom:8px;" />
      <button class="btn-action btn-compile" onclick="snesHeaderUI()">Leggi header reale</button>
      <div class="console-logs" id="snes-log" style="margin-top:10px; height:auto;">In attesa…</div>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>♻️ N64Recomp — orchestrazione reale (ricompilazione statica MIPS→nativo)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Se N64Recomp è installato sulla macchina, questo pannello genera il <code>recomp.toml</code> reale
        (schema dell'esempio ufficiale Zelda64Recomp) e può eseguire la ricompilazione in dir temporanea.
        Richiede ROM non compressa + ELF con simboli (da splat/decomp) per risultati completi.
      </p>
      <div class="memory-map" id="recomp-status">Stato: caricamento…</div>
      <label class="meta-item" style="display:block; margin-top:10px;">Nome gioco:</label>
      <input type="text" id="recomp-game" placeholder="Super Mario 64" style="width:100%; padding:8px; margin-bottom:8px; background:#05060b; border:1px solid var(--border); border-radius:6px; color:#fff;" />
      <label class="meta-item" style="display:block;">Entrypoint (hex, es. 80246000 per SM64 US):</label>
      <input type="text" id="recomp-entry" placeholder="80246000" style="width:100%; padding:8px; margin-bottom:8px; background:#05060b; border:1px solid var(--border); border-radius:6px; color:#fff;" />
      <button class="btn-action" style="background:#141929;color:#fff;border:1px solid var(--border);" onclick="recompConfigUI()">Genera recomp.toml reale</button>
      <div class="console-logs" id="recomp-log" style="margin-top:10px; height:auto; max-height:200px;">In attesa…</div>
      <div id="recomp-download"></div>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🧾 Inspector header ROM N64 (formato hardware generico)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Legge i primi 64 byte di una ROM N64 secondo il formato hardware documentato pubblicamente
        (identico su qualsiasi cartuccia/homebrew N64, richiesto dal bootloader reale della console).
      </p>
      <input type="file" id="hdr-file" style="margin-bottom:8px;" />
      <button class="btn-action btn-compile" onclick="inspectRomHeader()">Leggi header reale</button>
      <div class="console-logs" id="hdr-log" style="margin-top:10px; height:auto; max-height:200px;">In attesa...</div>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>📦 Decompressore Yay0 (formato hardware generico, imparentato a MIO0)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Formato di compressione generico N64 usato da vari titoli dell'epoca (lunghezza match estesa
        rispetto a MIO0, fino a 273 byte). Fornisci un blob già estratto da TE.
      </p>
      <input type="file" id="yay0-file" style="margin-bottom:8px;" />
      <button class="btn-action btn-compile" onclick="decompressYay0UI()">Decomprimi reale</button>
      <div class="console-logs" id="yay0-log" style="margin-top:10px; height:auto;">In attesa...</div>
      <div id="yay0-download"></div>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🎨 Decoder texture N64 (formati hardware generici)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Formati RDP generici (RGBA16/32, IA16/8/4, I8/4, CI4/8), identici su qualsiasi ROM N64.
        Fornisci un blob di byte texture già estratto da TE (mai una ROM intera).
      </p>
      <input type="file" id="tex-file" style="margin-bottom:6px;" />
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <label style="font-size:12px;">Larghezza <input type="number" id="tex-w" value="16" style="width:60px; background:#05060b; border:1px solid var(--border); color:#fff; border-radius:4px; padding:4px;" /></label>
        <label style="font-size:12px;">Altezza <input type="number" id="tex-h" value="16" style="width:60px; background:#05060b; border:1px solid var(--border); color:#fff; border-radius:4px; padding:4px;" /></label>
        <label style="font-size:12px;">Formato
          <select id="tex-format" style="background:#05060b; border:1px solid var(--border); color:#fff; border-radius:4px; padding:4px;">
            <option>RGBA16</option><option>RGBA32</option><option>IA16</option><option>IA8</option>
            <option>IA4</option><option>I8</option><option>I4</option><option>CI4</option><option>CI8</option>
          </select>
        </label>
      </div>
      <div id="tex-palette-row" style="display:none; margin-bottom:8px;">
        <label class="meta-item" style="display:block;">File palette (CI4/CI8, formato RGBA16):</label>
        <input type="file" id="tex-palette-file" />
      </div>
      <button class="btn-action btn-compile" onclick="decodeTextureUI()">Decodifica e mostra</button>
      <div class="console-logs" id="tex-log" style="margin-top:10px; height:auto;">In attesa...</div>
      <canvas id="tex-canvas" style="margin-top:10px; image-rendering: pixelated; border:1px solid var(--border); max-width:256px;"></canvas>
    </div>

    <div class="sidebar" style="grid-column: 1 / -1; margin: 0 24px 24px;">
      <h2>🗺️ Editor level-script SM64 (sperimentale, basato su documentazione pubblica)</h2>
      <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin-top:-4px;">
        Formato basato sulla documentazione pubblica della community (Hack64 Wiki, progetto n64decomp/sm64).
        Incolla qui SOLO un segmento di byte già estratto da TE dalla tua ROM (facoltativamente compresso MIO0) —
        questo server non apre né analizza mai una ROM completa.
      </p>
      <label class="meta-item" style="display:block;">Byte del segmento (hex, es. "24 1F 00 09 ..." oppure file):</label>
      <input type="file" id="ls-file" style="margin-bottom:6px;" />
      <textarea id="ls-hex" rows="3" placeholder="Oppure incolla qui i byte in esadecimale, separati da spazi" style="width:100%; background:#05060b; border:1px solid var(--border); border-radius:6px; color:#fff; padding:8px; font-size:12px;"></textarea>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12.5px;">
        <input type="checkbox" id="ls-mio0" /> Decomprimi come MIO0 prima di interpretare i comandi
      </label>
      <button class="btn-action btn-compile" style="margin-top:10px;" onclick="parseLevelScriptUI()">Interpreta comandi</button>
      <div class="console-logs" id="ls-log" style="margin-top:10px;">In attesa...</div>
      <div id="ls-table" style="margin-top:10px;"></div>
      <button class="btn-action" style="display:none; margin-top:10px; background:#141929;color:#fff;border:1px solid var(--border);" id="ls-save-btn" onclick="saveLevelScriptUI()">Applica modifiche e scarica</button>
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

    // --- Decompressore Yay0 ---
    async function decompressYay0UI() {
      const log = document.getElementById('yay0-log');
      const dl = document.getElementById('yay0-download');
      dl.innerHTML = '';
      const fileInput = document.getElementById('yay0-file');
      if (!fileInput.files[0]) { log.style.color = '#f87171'; log.textContent = 'Seleziona un file.'; return; }
      log.style.color = '#9ca3af';
      log.textContent = '⚡ Decompressione reale in corso...';
      try {
        const bytes = await fileToBytes(fileInput.files[0]);
        const res = await fetch('/api/n64/yay0/decompress', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataBase64: bytesToB64(bytes) })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }

        log.style.color = '#22c55e';
        log.textContent = '✓ Yay0 decompresso realmente: ' + data.decompressedSize + ' byte reali.';
        const outBytes = base64ToBytes(data.decompressedBase64);
        const blob = new Blob([outBytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'yay0_decompressed.bin';
        a.textContent = '⬇ Scarica dati decompressi (' + data.decompressedSize + ' byte)';
        a.style.cssText = 'display:block;color:var(--accent);margin-top:6px;font-family:monospace;font-size:12px;';
        dl.appendChild(a);
      } catch (e) {
        log.style.color = '#f87171';
        log.textContent = 'Errore: ' + e.message;
      }
    }

    // --- Decoder texture N64 ---
    document.getElementById('tex-format')?.addEventListener('change', (e) => {
      const isIndexed = e.target.value === 'CI4' || e.target.value === 'CI8';
      document.getElementById('tex-palette-row').style.display = isIndexed ? 'block' : 'none';
    });

    async function fileToBytes(file) {
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    }
    function bytesToB64(bytes) {
      let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }

    async function decodeTextureUI() {
      const log = document.getElementById('tex-log');
      const fileInput = document.getElementById('tex-file');
      if (!fileInput.files[0]) { log.style.color = '#f87171'; log.textContent = 'Seleziona un file con i byte della texture.'; return; }

      const width = Number(document.getElementById('tex-w').value);
      const height = Number(document.getElementById('tex-h').value);
      const format = document.getElementById('tex-format').value;
      log.style.color = '#9ca3af';
      log.textContent = '⚡ Decodifica reale in corso...';

      try {
        const bytes = await fileToBytes(fileInput.files[0]);
        const body = { width, height, format, dataBase64: bytesToB64(bytes) };

        if (format === 'CI4' || format === 'CI8') {
          const palFile = document.getElementById('tex-palette-file').files[0];
          if (!palFile) { log.style.color = '#f87171'; log.textContent = 'Formato indicizzato: fornisci anche il file palette.'; return; }
          body.paletteBase64 = bytesToB64(await fileToBytes(palFile));
        }

        const res = await fetch('/api/n64/texture/decode', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }

        const canvas = document.getElementById('tex-canvas');
        canvas.width = data.width; canvas.height = data.height;
        const ctx = canvas.getContext('2d');
        const rgbaBytes = base64ToBytes(data.rgbaBase64);
        const imgData = new ImageData(new Uint8ClampedArray(rgbaBytes), data.width, data.height);
        ctx.putImageData(imgData, 0, 0);

        log.style.color = '#22c55e';
        log.textContent = '✓ Texture reale decodificata (' + format + ', ' + data.width + 'x' + data.height + ').';
      } catch (e) {
        log.style.color = '#f87171';
        log.textContent = 'Errore: ' + e.message;
      }
    }

    // --- Fix checksum CRC N64 ---
    async function crcComputeUI() {
      const log = document.getElementById('crc-log');
      const f = document.getElementById('crc-file').files[0];
      if (!f) { log.style.color = '#f87171'; log.textContent = 'Seleziona una ROM.'; return; }
      log.style.color = '#9ca3af'; log.textContent = '⚡ Calcolo checksum reale in corso…';
      try {
        const rom = await fileToBytes(f);
        const res = await fetch('/api/n64/crc/compute', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ romBase64: bytesToB64(rom) })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }
        log.style.color = data.valid ? '#22c55e' : '#facc15';
        log.textContent = 'CIC rilevato: ' + data.cic + '\\nCRC1 calcolato: ' + data.crc1 + ' (in ROM: ' + data.storedCrc1 + ')\\nCRC2 calcolato: ' + data.crc2 + ' (in ROM: ' + data.storedCrc2 + ')\\n' + (data.valid ? '✓ Checksum VALIDI: la ROM boota così com\\'è.' : '⚠ Checksum NON validi: la ROM modificata va fixata (usa il pulsante a fianco).');
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    async function crcFixUI() {
      const log = document.getElementById('crc-log');
      const dl = document.getElementById('crc-download');
      dl.innerHTML = '';
      const f = document.getElementById('crc-file').files[0];
      if (!f) { log.style.color = '#f87171'; log.textContent = 'Seleziona una ROM.'; return; }
      if (!declarationToken) { log.style.color = '#f87171'; log.textContent = '✗ Completa prima la dichiarazione nel pannello patcher (stesso gate).'; return; }
      log.style.color = '#9ca3af'; log.textContent = '⚡ Ricalcolo CRC reali e scrittura header…';
      try {
        const rom = await fileToBytes(f);
        const res = await fetch('/api/n64/crc/fix', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: declarationName, token: declarationToken, romBase64: bytesToB64(rom) })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }
        log.style.color = '#22c55e';
        log.textContent = (data.wasValid ? '✓ Erano già validi, riscritti comunque: ' : '✓ Corretti: ') + 'CRC1 ' + data.crc1 + ', CRC2 ' + data.crc2 + ' (CIC ' + data.cic + ').';
        const bytes = base64ToBytes(data.romBase64);
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = f.name.replace(/(\\.[^.]+)$/, '_crcfix$1');
        a.textContent = '⬇ Scarica ROM con checksum corretti (' + (data.size / 1024 / 1024).toFixed(1) + ' MB)';
        a.style.cssText = 'display:block;color:var(--accent);margin-top:8px;font-family:monospace;font-size:12px;';
        dl.appendChild(a);
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    // --- Splitter: scanner nativo + splat ---
    async function splitScanUI() {
      const log = document.getElementById('split-log');
      const f = document.getElementById('split-file').files[0];
      if (!f) { log.style.color = '#f87171'; log.textContent = 'Seleziona una ROM.'; return; }
      log.style.color = '#9ca3af'; log.textContent = '⚡ Scansione blocchi MIO0/Yay0 in corso…';
      try {
        const rom = await fileToBytes(f);
        const res = await fetch('/api/n64/split/scan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ romBase64: bytesToB64(rom) })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }
        log.style.color = '#22c55e';
        let html = '✓ ' + data.count + ' blocchi compressi trovati con header valido:' +
          '<table style="width:100%; font-size:11px; border-collapse:collapse; margin-top:6px;">' +
          '<tr style="color:var(--text-muted); text-align:left;"><th>Offset</th><th>Formato</th><th>Compresso</th><th>Decompresso</th></tr>';
        data.sections.forEach(s => {
          html += '<tr style="border-top:1px solid var(--border);"><td>' + s.offset + '</td><td>' + s.format + '</td><td>' + s.compressedSize + ' B</td><td>' + s.decompressedSize + ' B</td></tr>';
        });
        html += '</table>';
        log.innerHTML = html;
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    async function splatSplitUI() {
      const log = document.getElementById('split-log');
      const f = document.getElementById('split-file').files[0];
      if (!f) { log.style.color = '#f87171'; log.textContent = 'Seleziona una ROM.'; return; }
      if (!declarationToken) { log.style.color = '#f87171'; log.textContent = '✗ Completa prima la dichiarazione (stesso gate del patcher).'; return; }
      log.style.color = '#9ca3af'; log.textContent = '⚡ Split reale con splat in corso (può richiedere qualche minuto)…';
      try {
        const rom = await fileToBytes(f);
        const res = await fetch('/api/splat/split', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: declarationName, token: declarationToken, romBase64: bytesToB64(rom) })
        });
        const data = await res.json();
        if (data.error || !data.success) {
          log.style.color = '#f87171';
          log.textContent = '✗ ' + (data.error || data.logs).substring(0, 1500);
          return;
        }
        log.style.color = '#22c55e';
        log.textContent = '✓ splat ha prodotto ' + data.files.length + ' file reali (i primi 200, max 2MB l\\'uno).';
        data.files.slice(0, 40).forEach(file => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([base64ToBytes(file.base64)], { type: 'application/octet-stream' }));
          a.download = file.name.replace(/\\//g, '_');
          a.textContent = '⬇ ' + file.name + ' (' + file.size + ' B)';
          a.style.cssText = 'display:block;color:var(--accent);margin-top:4px;font-family:monospace;font-size:11px;';
          log.appendChild(a);
        });
        const cfg = document.createElement('a');
        cfg.href = URL.createObjectURL(new Blob([data.configYaml], { type: 'text/yaml' }));
        cfg.download = 'splat_config.yaml';
        cfg.textContent = '⬇ config.yaml generato da splat';
        cfg.style.cssText = 'display:block;color:var(--accent);margin-top:8px;font-family:monospace;font-size:11px;';
        log.appendChild(cfg);
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    // --- Parser F3D + wireframe ---
    async function f3dParseUI() {
      const log = document.getElementById('f3d-log');
      const cmdTable = document.getElementById('f3d-cmd-table');
      const dlFile = document.getElementById('f3d-dl-file').files[0];
      const vtxFile = document.getElementById('f3d-vtx-file').files[0];
      cmdTable.innerHTML = '';
      if (!dlFile) { log.style.color = '#f87171'; log.textContent = 'Seleziona il file display list.'; return; }
      log.style.color = '#9ca3af'; log.textContent = '⚡ Parsing display list reale in corso…';
      try {
        const body = { dlBase64: bytesToB64(await fileToBytes(dlFile)) };
        if (vtxFile) body.vtxBase64 = bytesToB64(await fileToBytes(vtxFile));
        const res = await fetch('/api/n64/f3d/parse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }

        log.style.color = '#22c55e';
        log.textContent = '✓ ' + data.commands.length + ' comandi interpretati.' +
          (data.endedAt === null ? ' ⚠ Nessun ENDDL trovato: lista troncata.' : ' (ENDDL a 0x' + data.endedAt.toString(16) + ')') +
          (data.warnings && data.warnings.length ? '\\n⚠ ' + data.warnings.length + ' avvisi (VTX/TRI fuori bounds).' : '');

        let html = '<table style="width:100%; font-size:11px; border-collapse:collapse;">' +
          '<tr style="color:var(--text-muted); text-align:left;"><th>Offset</th><th>Comando</th><th>Campi</th></tr>';
        data.commands.slice(0, 100).forEach(cmd => {
          const fields = Object.entries(cmd.fields).map(([k, v]) => k + '=' + v).join(' ');
          html += '<tr style="border-top:1px solid var(--border);"><td>0x' + cmd.offset.toString(16) + '</td><td>' + cmd.name + '</td><td style="color:var(--text-muted);">' + fields + '</td></tr>';
        });
        html += '</table>';
        cmdTable.innerHTML = html;

        if (data.mesh && data.mesh.triangles.length > 0) {
          drawF3dWireframe(data.mesh);
          renderF3dVertexEditor(data.mesh);
        } else if (data.mesh) { log.textContent += '\\nMesh senza triangoli (nessun TRI1 valido con i vertici forniti).'; }
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    function drawF3dWireframe(mesh) {
      const canvas = document.getElementById('f3d-canvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#05060b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (mesh.vertices.length === 0) return;

      // proiezione prospettica semplice, autocentrata (preview 3D reale lato client)
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      mesh.vertices.forEach(v => {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      });
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      const range = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
      const scale = (canvas.width * 0.35) / range;
      const project = v => {
        const zoom = 600 / (600 + (v.z - cz));
        return {
          x: canvas.width / 2 + (v.x - cx) * scale * zoom,
          y: canvas.height / 2 - (v.y - cy) * scale * zoom
        };
      };
      ctx.strokeStyle = '#00c6ff';
      ctx.lineWidth = 0.7;
      mesh.triangles.forEach(([a, b, c]) => {
        const va = project(mesh.vertices[a]), vb = project(mesh.vertices[b]), vc = project(mesh.vertices[c]);
        ctx.beginPath();
        ctx.moveTo(va.x, va.y); ctx.lineTo(vb.x, vb.y); ctx.lineTo(vc.x, vc.y); ctx.closePath();
        ctx.stroke();
      });
      ctx.fillStyle = '#9ca3af';
      ctx.font = '11px monospace';
      ctx.fillText(mesh.vertices.length + ' vertici, ' + mesh.triangles.length + ' triangoli (wireframe reale)', 8, canvas.height - 8);
    }

    // --- Disassembler MIPS ---
    async function mipsDisasmUI() {
      const log = document.getElementById('mips-log');
      const table = document.getElementById('mips-table');
      table.innerHTML = '';
      const f = document.getElementById('mips-file').files[0];
      if (!f) { log.style.color = '#f87171'; log.textContent = 'Seleziona un file con codice MIPS.'; return; }
      log.style.color = '#9ca3af'; log.textContent = '⚡ Disassemblaggio reale in corso…';
      try {
        const bytes = await fileToBytes(f);
        const base = parseInt(document.getElementById('mips-base').value.replace(/^0x/i, ''), 16) || 0x80246000;
        const res = await fetch('/api/n64/mips/disassemble', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataBase64: bytesToB64(bytes), baseAddress: base, max: 300 })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }
        log.style.color = data.unknownCount > 0 ? '#facc15' : '#22c55e';
        log.textContent = '✓ ' + data.count + ' istruzioni disassemblate (' + data.unknownCount + ' UNKNOWN onesti).';
        let html = '<table style="width:100%; font-size:11px; border-collapse:collapse;">' +
          '<tr style="color:var(--text-muted); text-align:left;"><th>Addr</th><th>Word</th><th>Istruzione</th></tr>';
        data.instructions.forEach(ins => {
          html += '<tr style="border-top:1px solid var(--border);"><td>0x' + ins.address.toString(16).toUpperCase() +
            '</td><td style="color:var(--text-muted);">' + ins.bytes + '</td><td style="color:' +
            (ins.text.startsWith('UNKNOWN') ? '#facc15' : '#38bdf8') + ';">' + ins.text + '</td></tr>';
        });
        table.innerHTML = html + '</table>';
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    // --- Header SNES ---
    async function snesHeaderUI() {
      const log = document.getElementById('snes-log');
      const f = document.getElementById('snes-file').files[0];
      if (!f) { log.style.color = '#f87171'; log.textContent = 'Seleziona una ROM SNES (.smc/.sfc).' ; return; }
      log.style.color = '#9ca3af'; log.textContent = '⚡ Lettura header reale in corso…';
      try {
        const rom = await fileToBytes(f);
        const res = await fetch('/api/snes/rom-header', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ romBase64: bytesToB64(rom) })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }
        log.style.color = data.checksumConsistent ? '#22c55e' : '#facc15';
        log.textContent =
          'Mappatura: ' + data.mapping + ' (header a ' + data.headerOffset + ')' +
          '\\nTitolo: ' + (data.title || '(vuoto)') +
          '\\nChipset: ' + data.chipset +
          '\\nROM: ' + (data.romSize / 1024) + ' KB · SRAM: ' + (data.sramSize / 1024) + ' KB' +
          '\\nRegione: ' + data.destination +
          '\\nVersione: ' + data.version +
          '\\nChecksum: ' + data.checksum + ' · Complement: ' + data.checksumComplement +
          '\\n' + (data.checksumConsistent ? '✓ Coerenti (complement+checksum=0xFFFF): mappatura affidabile.' : '⚠ Non coerenti: mappatura stimata, potrebbe essere sbagliata.');
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    // --- F3D: editor vertici + riserializzazione (round-trip 3D) ---
    let f3dMesh = null;
    function renderF3dVertexEditor(mesh) {
      f3dMesh = mesh;
      const wrap = document.getElementById('f3d-vtx-editor');
      const table = document.getElementById('f3d-vtx-table');
      wrap.style.display = 'block';
      let html = '<table style="width:100%; font-size:11px; border-collapse:collapse;">' +
        '<tr style="color:var(--text-muted); text-align:left;"><th>#</th><th>X</th><th>Y</th><th>Z</th><th>U</th><th>V</th></tr>';
      mesh.vertices.slice(0, 16).forEach((v, i) => {
        html += '<tr style="border-top:1px solid var(--border);"><td>' + i + '</td>' +
          ['x','y','z','u','v'].map(k =>
            '<td><input type="number" data-vtx="' + i + '" data-k="' + k + '" value="' + v[k] + '" style="width:56px; background:#05060b; border:1px solid var(--border); color:#fff; border-radius:3px; padding:2px;" onchange="f3dUpdateVtx(this)" /></td>'
          ).join('') + '</tr>';
      });
      table.innerHTML = html + '</table>';
    }
    function f3dUpdateVtx(input) {
      f3dMesh.vertices[Number(input.dataset.vtx)][input.dataset.k] = Number(input.value);
    }
    async function f3dSerializeUI() {
      const log = document.getElementById('f3d-log');
      const dl = document.getElementById('f3d-download');
      dl.innerHTML = '';
      if (!f3dMesh) return;
      log.style.color = '#9ca3af'; log.textContent = '⚡ Riserializzazione reale in corso…';
      try {
        const res = await fetch('/api/n64/f3d/serialize-mesh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vertices: f3dMesh.vertices, triangles: f3dMesh.triangles })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }
        log.style.color = '#22c55e';
        log.textContent = '✓ Riserializzati ' + data.vertexCount + ' vertici reali (' + (data.vertexCount * 16) + ' byte) e display list da ' + (data.dlSize || 0) + ' byte.';
        [['vtx_edited.bin', data.vtxBase64, '⬇ Scarica blob vertici modificato'],
         ...(data.dlBase64 ? [['dl_rebuilt.bin', data.dlBase64, '⬇ Scarica display list ricostruita']] : [])]
        .forEach(([name, b64, label]) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([base64ToBytes(b64)], { type: 'application/octet-stream' }));
          a.download = name;
          a.textContent = label;
          a.style.cssText = 'display:block;color:var(--accent);margin-top:6px;font-family:monospace;font-size:12px;';
          dl.appendChild(a);
        });
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    // --- N64Recomp ---
    async function loadRecompStatus() {
      const el = document.getElementById('recomp-status');
      try {
        const res = await fetch('/api/recomp/status');
        const data = await res.json();
        el.innerHTML = data.installed
          ? '<div class="mem-row"><span>N64Recomp</span><span class="val" style="color:#22c55e;">✓ ' + data.binaryPath + '</span></div>'
          : '<div class="mem-row"><span>N64Recomp</span><span class="val" style="color:#f87171;">✗ non installato</span></div><div style="font-size:11px; color:var(--text-muted); margin-top:6px;">' + data.installHint + '</div>';
      } catch (e) { el.textContent = 'Errore stato: ' + e.message; }
    }
    loadRecompStatus();

    async function recompConfigUI() {
      const log = document.getElementById('recomp-log');
      const dl = document.getElementById('recomp-download');
      dl.innerHTML = '';
      const gameName = document.getElementById('recomp-game').value || 'game';
      const entryHex = document.getElementById('recomp-entry').value.trim();
      const entrypoint = entryHex ? parseInt(entryHex.replace(/^0x/i, ''), 16) : undefined;
      log.style.color = '#9ca3af'; log.textContent = '⚡ Generazione recomp.toml reale…';
      try {
        const res = await fetch('/api/recomp/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameName, entrypoint })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }
        log.style.color = '#22c55e';
        log.textContent = '✓ recomp.toml generato (schema ufficiale Zelda64Recomp):\\n\\n' + data.recompToml;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data.recompToml], { type: 'text/plain' }));
        a.download = 'recomp.toml';
        a.textContent = '⬇ Scarica recomp.toml';
        a.style.cssText = 'display:block;color:var(--accent);margin-top:8px;font-family:monospace;font-size:12px;';
        dl.appendChild(a);
      } catch (e) { log.style.color = '#f87171'; log.textContent = 'Errore: ' + e.message; }
    }

    // --- Inspector header ROM N64 ---
    async function inspectRomHeader() {
      const log = document.getElementById('hdr-log');
      const fileInput = document.getElementById('hdr-file');
      if (!fileInput.files[0]) { log.style.color = '#f87171'; log.textContent = 'Seleziona un file ROM.'; return; }
      log.style.color = '#9ca3af';
      log.textContent = '⚡ Lettura header reale in corso...';
      try {
        const buf = await fileInput.files[0].slice(0, 0x40).arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const res = await fetch('/api/n64/rom-header', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bytesBase64: btoa(bin) })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }

        log.style.color = data.looksLikeValidN64Rom ? '#22c55e' : '#facc15';
        log.textContent =
          (data.looksLikeValidN64Rom ? '✓ Magic ROM N64 reale riconosciuto (80 37 12 40)' : '⚠ Magic non riconosciuto: potrebbe non essere una ROM N64 big-endian standard') +
          '\\n\\nTitolo immagine: ' + (data.imageName || '(vuoto)') +
          '\\nCartridge ID: ' + data.cartridgeId +
          '\\nRegione: ' + data.countryName + ' (0x' + data.countryCode.toString(16) + ')' +
          '\\nVersione: ' + data.version +
          '\\nBoot address: ' + data.bootAddress +
          '\\nCRC1 (memorizzato in header): ' + data.crc1 +
          '\\nCRC2 (memorizzato in header): ' + data.crc2 +
          '\\nFormato cartuccia (0x3B): ' + data.cartridgeFormat + " (N=cart standard, D=64DD, C=cart+exp, E=64DD exp, Z=Aleck64)";
      } catch (e) {
        log.style.color = '#f87171';
        log.textContent = 'Errore: ' + e.message;
      }
    }

    // --- Editor level-script SM64 ---
    let lsCommands = null;

    function bytesToBase64(bytes) {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    function base64ToBytes(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    function hexToBytes(hex) {
      const clean = hex.trim().replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
      const bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
      return bytes;
    }

    async function getInputBytes() {
      const fileInput = document.getElementById('ls-file');
      if (fileInput.files[0]) {
        const buf = await fileInput.files[0].arrayBuffer();
        return new Uint8Array(buf);
      }
      const hex = document.getElementById('ls-hex').value;
      if (hex.trim()) return hexToBytes(hex);
      return null;
    }

    async function parseLevelScriptUI() {
      const log = document.getElementById('ls-log');
      const tableDiv = document.getElementById('ls-table');
      const saveBtn = document.getElementById('ls-save-btn');
      tableDiv.innerHTML = '';
      saveBtn.style.display = 'none';

      let bytes = await getInputBytes();
      if (!bytes || bytes.length === 0) {
        log.style.color = '#f87171';
        log.textContent = 'Fornisci un file o dei byte esadecimali.';
        return;
      }

      try {
        if (document.getElementById('ls-mio0').checked) {
          log.textContent = '⚡ Decompressione MIO0 reale in corso...';
          const res = await fetch('/api/n64/mio0/decompress', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataBase64: bytesToBase64(bytes) })
          });
          const data = await res.json();
          if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }
          bytes = base64ToBytes(data.decompressedBase64);
          log.textContent = '✓ MIO0 decompresso: ' + data.decompressedSize + ' byte reali.';
        }

        const res = await fetch('/api/sm64/levelscript/parse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bytesBase64: bytesToBase64(bytes) })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }

        lsCommands = data.commands;
        log.style.color = '#22c55e';
        log.textContent = '✓ ' + data.commands.length + ' comandi reali interpretati.' +
          (data.truncatedAt !== null ? ' Interrotto onestamente all\\'offset ' + data.truncatedAt + ' (opcode non mappato in questo editor, nessun disallineamento silenzioso).' : '');

        let html = '<table style="width:100%; font-size:11.5px; border-collapse:collapse;">' +
          '<tr style="color:var(--text-muted); text-align:left;"><th>Offset</th><th>Comando</th><th>Campi</th></tr>';
        data.commands.forEach((cmd, idx) => {
          html += '<tr style="border-top:1px solid var(--border);"><td>0x' + cmd.offset.toString(16) + '</td><td>' + cmd.name + '</td><td>';
          const fieldNames = Object.keys(cmd.fields);
          if (fieldNames.length === 0) {
            html += '<span style="color:var(--text-muted);">(non editabile in questo tool)</span>';
          } else {
            fieldNames.forEach(fn => {
              html += fn + ': <input type="number" data-cmd="' + idx + '" data-field="' + fn + '" value="' + cmd.fields[fn] + '" style="width:70px; background:#05060b; border:1px solid var(--border); color:#fff; border-radius:4px; margin:2px;" onchange="updateLsField(this)" /> ';
            });
          }
          html += '</td></tr>';
        });
        html += '</table>';
        tableDiv.innerHTML = html;
        saveBtn.style.display = data.commands.some(c => Object.keys(c.fields).length > 0) ? 'block' : 'none';
      } catch (e) {
        log.style.color = '#f87171';
        log.textContent = 'Errore: ' + e.message;
      }
    }

    function updateLsField(input) {
      const cmdIdx = Number(input.dataset.cmd);
      const field = input.dataset.field;
      lsCommands[cmdIdx].fields[field] = Number(input.value);
    }

    async function saveLevelScriptUI() {
      const log = document.getElementById('ls-log');
      try {
        const res = await fetch('/api/sm64/levelscript/serialize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commands: lsCommands })
        });
        const data = await res.json();
        if (data.error) { log.style.color = '#f87171'; log.textContent = '✗ ' + data.error; return; }

        const bytes = base64ToBytes(data.bytesBase64);
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'levelscript_edited.bin';
        a.textContent = '⬇ Scarica segmento modificato (' + data.size + ' byte)';
        a.style.cssText = 'display:block;color:var(--accent);margin-top:8px;font-family:monospace;font-size:12px;';
        document.getElementById('ls-table').appendChild(a);
        log.style.color = '#22c55e';
        log.textContent = '✓ Comandi riserializzati realmente in ' + data.size + ' byte.';
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

    // 8. MIO0 — decompressione reale di un blocco fornito dal client
    // (formato di compressione N64 generico, non specifico di un gioco).
    if (url.pathname === "/api/n64/mio0/decompress" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        if (!isMio0(data)) return new Response(JSON.stringify({ error: "Il blocco fornito non ha il magic 'MIO0'." }), { status: 400, headers });
        const out = mio0Decompress(data);
        return new Response(JSON.stringify({ decompressedBase64: Buffer.from(out).toString("base64"), decompressedSize: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // 8b. Yay0 — decompressione reale (formato imparentato a MIO0, usato da
    // vari titoli N64 dell'epoca, formato hardware generico non specifico
    // di un gioco). Solo decompressione: nessun encoder reale disponibile
    // per la ricompressione in questa versione.
    if (url.pathname === "/api/n64/yay0/decompress" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        if (!isYay0(data)) return new Response(JSON.stringify({ error: "Il blocco fornito non ha il magic 'Yay0'." }), { status: 400, headers });
        const out = yay0Decompress(data);
        return new Response(JSON.stringify({ decompressedBase64: Buffer.from(out).toString("base64"), decompressedSize: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // 9. MIO0 — ricompressione reale (greedy, non size-ottimale ma corretta
    // e verificata via round-trip) dei byte modificati dal client.
    if (url.pathname === "/api/n64/mio0/compress" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        const out = mio0CompressForTesting(data);
        return new Response(JSON.stringify({ compressedBase64: Buffer.from(out).toString("base64"), compressedSize: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // 10. Level-script SM64 — parsing reale secondo il formato pubblicamente
    // documentato dalla community (vedi src/sm64_level_script.ts). Opera sui
    // byte forniti dal client, mai su una ROM aperta da questo server.
    if (url.pathname === "/api/sm64/levelscript/parse" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const bytes = new Uint8Array(Buffer.from(body.bytesBase64 || "", "base64"));
        const { commands, truncatedAt } = parseLevelScript(bytes);
        return new Response(JSON.stringify({ commands, truncatedAt, editableCommandNames: EDITABLE_COMMAND_NAMES }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // 11. Level-script SM64 — riserializzazione reale dei comandi (con
    // eventuali campi modificati dal client) in un nuovo buffer di byte.
    if (url.pathname === "/api/sm64/levelscript/serialize" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const commands: LevelCommand[] = body.commands || [];
        const out = serializeLevelScript(commands);
        return new Response(JSON.stringify({ bytesBase64: Buffer.from(out).toString("base64"), size: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // 12. Inspector header ROM N64 — formato hardware generico (funziona su
    // QUALSIASI ROM N64, non specifico di un gioco). Il client invia solo i
    // primi 64 byte (o l'intera ROM, ma solo l'header viene letto qui).
    if (url.pathname === "/api/n64/rom-header" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const bytes = new Uint8Array(Buffer.from(body.bytesBase64 || "", "base64"));
        const header = parseN64RomHeader(bytes);
        return new Response(JSON.stringify(header), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13b. Yay0 — ricompressione reale (greedy LZ77, valida bit-per-bit per
    // il decompressore sopra: chiude il round-trip modifica→repack).
    if (url.pathname === "/api/n64/yay0/compress" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        if (data.length === 0) return new Response(JSON.stringify({ error: "dataBase64 vuoto." }), { status: 400, headers });
        const out = yay0Compress(data);
        return new Response(JSON.stringify({ compressedBase64: Buffer.from(out).toString("base64"), compressedSize: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // 13c. Checksum CRC header ROM N64 — calcolo/verifica reale secondo il
    // chip CIC rilevato dall'IPL3 (algoritmi trascritti da sm64tools MIT e
    // n64checksum CC0). Serve per rendere bootabile una ROM modificata.
    if (url.pathname === "/api/n64/crc/compute" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const result = computeN64Checksums(rom, body.cic as CicChip | undefined);
        return new Response(JSON.stringify({
          cic: result.cic,
          crc1: "0x" + result.crc1.toString(16).toUpperCase(),
          crc2: "0x" + result.crc2.toString(16).toUpperCase(),
          storedCrc1: "0x" + result.storedCrc1.toString(16).toUpperCase(),
          storedCrc2: "0x" + result.storedCrc2.toString(16).toUpperCase(),
          valid: result.valid,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13d. Checksum CRC — fix reale: ricalcola e riscrive CRC1/CRC2
    // nell'header, ritornando la ROM corretta al client (mai salvata su disco).
    if (url.pathname === "/api/n64/crc/fix" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const { rom: fixed, result } = fixN64Checksums(rom, body.cic as CicChip | undefined);
        return new Response(JSON.stringify({
          cic: result.cic,
          crc1: "0x" + result.crc1.toString(16).toUpperCase(),
          crc2: "0x" + result.crc2.toString(16).toUpperCase(),
          wasValid: result.valid,
          romBase64: Buffer.from(fixed).toString("base64"),
          size: fixed.length,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13e. F3D — parsing reale di una display list Fast3D (formato delle
    // geometrie 3D, opcode da n64decomp/sm64 CC0) con estrazione mesh
    // quando il client fornisce anche il blob vertici.
    if (url.pathname === "/api/n64/f3d/parse" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const dl = new Uint8Array(Buffer.from(body.dlBase64 || "", "base64"));
        if (dl.length < 8) return new Response(JSON.stringify({ error: "dlBase64 troppo corto (una display list ha comandi da 8 byte)." }), { status: 400, headers });
        const { commands, endedAt } = parseF3dDisplayList(dl);
        const vtx = body.vtxBase64 ? new Uint8Array(Buffer.from(body.vtxBase64, "base64")) : null;
        const meshResult = vtx ? extractF3dMesh(dl, vtx) : null;
        return new Response(JSON.stringify({
          commands,
          endedAt,
          ...(meshResult ? { mesh: meshResult.mesh, warnings: meshResult.warnings } : {}),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13f. Scanner nativo blocchi MIO0/Yay0 di una ROM fornita dal client —
    // trova gli offset reali senza doverli indovinare a mano.
    if (url.pathname === "/api/n64/split/scan" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        if (rom.length < 0x400) return new Response(JSON.stringify({ error: "ROM troppo corta per lo scanner." }), { status: 400, headers });
        const sections = scanRomSections(rom);
        return new Response(JSON.stringify({
          sections: sections.map((s) => ({
            offset: "0x" + s.offset.toString(16).toUpperCase(),
            format: s.format,
            compressedSize: s.compressedSize,
            decompressedSize: s.decompressedSize,
          })),
          count: sections.length,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13g. splat — stato reale dell'installazione.
    if (url.pathname === "/api/splat/status" && req.method === "GET") {
      const s = detectSplat();
      return new Response(JSON.stringify(s), { headers });
    }

    // 13h. splat — split reale via subprocess (se installato), in dir
    // temporanea cancellata subito dopo. Nessuna ROM persistita.
    if (url.pathname === "/api/splat/split" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        if (rom.length < 0x400) return new Response(JSON.stringify({ error: "ROM troppo corta." }), { status: 400, headers });
        const result = runSplatSplit(rom);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 502, headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // 13i. N64Recomp — stato reale + generazione recomp.toml + run reale.
    if (url.pathname === "/api/recomp/status" && req.method === "GET") {
      return new Response(JSON.stringify(detectN64Recomp()), { headers });
    }
    if (url.pathname === "/api/recomp/config" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const toml = generateRecompToml({
          gameName: body.gameName || "game",
          entrypoint: body.entrypoint,
          elfFileName: body.elfFileName,
          symbolsFileName: body.symbolsFileName,
          stubs: body.stubs,
          ignored: body.ignored,
        });
        return new Response(JSON.stringify({ recompToml: toml }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }
    if (url.pathname === "/api/recomp/run" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const elf = body.elfBase64 ? new Uint8Array(Buffer.from(body.elfBase64, "base64")) : undefined;
        const toml = body.recompToml || generateRecompToml({ gameName: body.gameName || "game", entrypoint: body.entrypoint });
        const result = runN64Recomp(toml, rom, elf, body.symbolsToml);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 502, headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // 13l. Disassembler MIPS R4300i reale (subset documentato; istruzioni
    // non mappate → UNKNOWN onesto con word grezza).
    if (url.pathname === "/api/n64/mips/disassemble" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        if (data.length < 4) return new Response(JSON.stringify({ error: "Servono almeno 4 byte (una word MIPS)." }), { status: 400, headers });
        const base = Number(body.baseAddress) || 0x80246000;
        const max = Math.min(Number(body.max) || 500, 5000);
        const instructions = disassembleMips(data, base, max);
        return new Response(JSON.stringify({
          instructions,
          count: instructions.length,
          unknownCount: instructions.filter((i) => i.text.startsWith("UNKNOWN")).length,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13m. F3D — serializzazione mesh→byte (round-trip editor 3D): blob
    // vertici riserializzato e, se forniti i triangoli, display list ricostruita.
    if (url.pathname === "/api/n64/f3d/serialize-mesh" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const vertices = body.vertices || [];
        if (vertices.length < 1) return new Response(JSON.stringify({ error: "Serve almeno un vertice." }), { status: 400, headers });
        const vtxBlob = serializeF3dVertices(vertices);
        let dlBase64: string | undefined;
        if (body.triangles) {
          const dl = buildF3dDisplayList({ vertices, triangles: body.triangles, textureImages: [] }, Number(body.vtxAddress) || 0x04000000);
          dlBase64 = Buffer.from(dl).toString("base64");
          return new Response(JSON.stringify({
            vtxBase64: Buffer.from(vtxBlob).toString("base64"),
            vertexCount: vertices.length,
            dlBase64,
            dlSize: dl.length,
          }), { headers });
        }
        return new Response(JSON.stringify({
          vtxBase64: Buffer.from(vtxBlob).toString("base64"),
          vertexCount: vertices.length,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13n. Inspector header ROM SNES (formato hardware generico, prova le
    // tre mappature LoROM/HiROM/ExHiROM e valida col complement checksum).
    if (url.pathname === "/api/snes/rom-header" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const header = parseSnesRomHeader(rom);
        return new Response(JSON.stringify({
          ...header,
          headerOffset: "0x" + header.headerOffset.toString(16).toUpperCase(),
          checksum: "0x" + header.checksum.toString(16).toUpperCase(),
          checksumComplement: "0x" + header.checksumComplement.toString(16).toUpperCase(),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13. Decoder texture N64 reale — formati hardware generici (funzionano
    // su QUALSIASI ROM N64). Il client fornisce solo il blob di byte della
    // texture (mai una ROM intera) + dimensioni + formato (+ palette per CI4/CI8).
    if (url.pathname === "/api/n64/texture/decode" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const width = Number(body.width);
        const height = Number(body.height);
        const format = body.format as N64TextureFormat;
        if (!BITS_PER_PIXEL[format]) {
          return new Response(JSON.stringify({ error: `Formato non riconosciuto: ${format}` }), { status: 400, headers });
        }
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        const expected = requiredByteLength(width, height, format);
        if (data.length < expected) {
          return new Response(JSON.stringify({ error: `Byte insufficienti per ${width}x${height} in formato ${format}: servono almeno ${expected} byte, forniti ${data.length}.` }), { status: 400, headers });
        }
        const palette = body.paletteBase64 ? new Uint8Array(Buffer.from(body.paletteBase64, "base64")) : undefined;
        const tex = decodeN64Texture(data, width, height, format, palette);
        return new Response(JSON.stringify({ width: tex.width, height: tex.height, rgbaBase64: Buffer.from(tex.rgba).toString("base64") }), { headers });
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
