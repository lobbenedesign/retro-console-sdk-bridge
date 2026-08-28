/**
 * 🖥️ Dashboard UI (v1.4) — shell applicativa con navigazione laterale.
 *
 * Ripensata dopo feedback reale d'uso: la vecchia UI era una pila verticale
 * di pannelli indipendenti che richiedevano ciascuno il proprio upload.
 * Qui la ROM si carica UNA volta (vista "ROM"), resta in memoria nel client
 * e ogni tool ci lavora sopra; i blob estratti (MIO0/Yay0 decompressi)
 * diventano il "blob corrente" consumato dalle viste a valle
 * (texture, level script, F3D, disassembler).
 *
 * Nessun framework: HTML/CSS/JS vanilla, stesso principio zero-dipendenze
 * del server. Tutte le operazioni passano dalle stesse API di prima
 * (nessun endpoint modificato, solo aggiunto /api/rom/convert).
 */

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>Retro Console SDK Bridge — Studio</title>
<style>
  :root {
    --bg: #07080e; --panel: #0e111d; --panel2: #141929; --line: #1e2538;
    --pri: #7c3aed; --acc: #00c6ff; --ok: #22c55e; --warn: #facc15; --err: #f87171;
    --tx: #f3f4f6; --mut: #9ca3af;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--tx); font-family:system-ui,-apple-system,'Segoe UI',sans-serif; font-size:14px; }
  /* ---------- shell ---------- */
  .topbar { display:flex; align-items:center; justify-content:space-between; gap:16px;
    background:var(--panel); border-bottom:1px solid var(--line); padding:10px 20px; position:sticky; top:0; z-index:10; }
  .brand { font-weight:800; letter-spacing:.5px; font-size:15px; }
  .brand small { color:var(--mut); font-weight:400; margin-left:8px; }
  .chips { display:flex; gap:8px; flex-wrap:wrap; }
  .chip { background:var(--panel2); border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:12px; color:var(--mut); max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chip.ok { color:var(--ok); border-color:#14532d; }
  .chip.warn { color:var(--warn); border-color:#713f12; }
  .shell { display:grid; grid-template-columns:210px 1fr; min-height:calc(100vh - 78px); }
  .sidenav { background:var(--panel); border-right:1px solid var(--line); padding:14px 8px; display:flex; flex-direction:column; gap:2px; position:sticky; top:53px; height:calc(100vh - 53px); overflow-y:auto; }
  .navbtn { display:flex; align-items:center; gap:10px; width:100%; text-align:left; background:none; border:none; border-radius:8px;
    color:var(--mut); padding:10px 12px; font-size:13.5px; cursor:pointer; font-weight:600; }
  .navbtn:hover { background:var(--panel2); color:var(--tx); }
  .navbtn.active { background:linear-gradient(90deg,var(--pri),#5b21b6); color:#fff; }
  .navsep { margin:10px 12px 4px; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#4b5563; }
  main { padding:20px 24px; max-width:1100px; }
  section.view { display:none; }
  section.view.active { display:block; }
  .statusbar { position:fixed; bottom:0; left:0; right:0; background:var(--panel); border-top:1px solid var(--line);
    padding:6px 20px; font-size:12px; color:var(--mut); font-family:ui-monospace,monospace; z-index:10; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  /* ---------- componenti ---------- */
  h1 { font-size:19px; margin:0 0 4px; }
  .sub { color:var(--mut); font-size:13px; margin:0 0 16px; line-height:1.5; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; margin-bottom:16px; }
  .card h2 { font-size:13px; text-transform:uppercase; letter-spacing:.8px; margin:0 0 12px; color:var(--tx);
    border-bottom:1px solid var(--line); padding-bottom:8px; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .field { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--mut); }
  input[type=text], input[type=number], select, textarea {
    background:var(--bg); border:1px solid var(--line); color:var(--tx); border-radius:6px; padding:7px 9px; font-size:13px; }
  input[type=file] { color:var(--mut); font-size:12.5px; }
  textarea { width:100%; font-family:ui-monospace,monospace; }
  .btn { border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; }
  .btn.pri { background:var(--acc); color:#000; } .btn.pri:hover { box-shadow:0 0 12px rgba(0,198,255,.35); }
  .btn.dark { background:var(--panel2); color:var(--tx); border:1px solid var(--line); }
  .btn.purple { background:linear-gradient(135deg,var(--pri),#5b21b6); color:#fff; }
  .btn.mini { padding:4px 10px; font-size:11.5px; border-radius:6px; }
  .btn:disabled { opacity:.4; cursor:not-allowed; }
  .log { background:#030407; border:1px dashed var(--line); padding:10px 12px; border-radius:8px;
    font-family:ui-monospace,monospace; font-size:11.5px; color:var(--mut); white-space:pre-wrap; max-height:260px; overflow-y:auto; }
  table.tbl { width:100%; border-collapse:collapse; font-size:12px; }
  .tbl th { text-align:left; color:var(--mut); font-weight:600; padding:4px 6px; }
  .tbl td { border-top:1px solid var(--line); padding:4px 6px; vertical-align:top; }
  .dropzone { border:2px dashed var(--line); border-radius:12px; padding:34px; text-align:center; color:var(--mut); cursor:pointer; transition:.2s; }
  .dropzone:hover, .dropzone.drag { border-color:var(--pri); color:var(--tx); background:rgba(124,58,237,.05); }
  .dropzone .big { font-size:34px; }
  .flow { display:flex; gap:6px; flex-wrap:wrap; margin:4px 0 14px; }
  .flow .step { background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:5px 10px; font-size:11.5px; color:var(--mut); }
  .flow .step.done { color:var(--ok); border-color:#14532d; }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; font-size:12.5px; }
  .kv span { color:var(--mut); }
  canvas { background:var(--bg); border:1px solid var(--line); border-radius:8px; image-rendering:pixelated; }
  a.dl { color:var(--acc); font-family:ui-monospace,monospace; font-size:12px; display:block; margin-top:6px; }
  .muted { color:var(--mut); font-size:12px; }
  .platgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; }
  .plat { background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:10px; cursor:pointer; text-align:left; color:var(--tx); font-size:12.5px; font-weight:600; }
  .plat.active { border-color:var(--pri); box-shadow:0 0 0 1px var(--pri); }
  .plat small { display:block; color:var(--mut); font-weight:400; margin-top:2px; }
  /* ---------- modale onboarding toolchain ---------- */
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.75); backdrop-filter:blur(3px);
    display:flex; align-items:center; justify-content:center; z-index:100; padding:20px; }
  .modal { background:var(--panel); border:1px solid var(--pri); border-radius:14px; max-width:680px; width:100%;
    max-height:88vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,.7); }
  .modal h1 { font-size:18px; }
  .tc-row { display:flex; flex-direction:column; gap:6px; background:var(--panel2); border:1px solid var(--line);
    border-radius:10px; padding:12px 14px; margin-top:10px; }
  .tc-row .cmd { display:flex; gap:8px; align-items:center; }
  .tc-row code { flex:1; background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:8px 10px;
    font-family:ui-monospace,monospace; font-size:12px; color:#38bdf8; word-break:break-all; }
  .ok-note { color:var(--ok); font-size:13px; }
  .warn-note { color:var(--warn); font-size:13px; }
</style>
</head>
<body>

<header class="topbar">
  <div class="brand">🎮 Retro Console SDK Bridge <small>studio · non ufficiale, non affiliato a Nintendo</small></div>
  <div class="chips">
    <div id="chip-rom" class="chip">🗂 Nessuna ROM caricata</div>
    <div id="chip-blob" class="chip" style="display:none"></div>
    <div id="chip-decl" class="chip warn">✍️ Dichiarazione mancante</div>
  </div>
</header>

<div class="shell">
<nav class="sidenav">
  <div class="navsep">Pipeline ROM</div>
  <button class="navbtn active" data-view="rom">🗂 ROM &amp; Identificazione</button>
  <button class="navbtn" data-view="split">📦 Split &amp; Compressione</button>
  <button class="navbtn" data-view="graphics">🎨 Texture &amp; 3D</button>
  <button class="navbtn" data-view="level">🗺 Level Script</button>
  <div class="navsep">Avanzate</div>
  <button class="navbtn" data-view="code">🧠 Disassembler</button>
  <button class="navbtn" data-view="patch">🩹 Patcher &amp; CRC</button>
  <button class="navbtn" data-view="recomp">♻️ N64Recomp</button>
  <div class="navsep">Creazione</div>
  <button class="navbtn" data-view="homebrew">🛠 Compilatore Homebrew</button>
  <div class="navsep">Sistema</div>
  <button class="navbtn" data-view="setup">⚙️ Setup &amp; Toolchain</button>
</nav>

<main>

<!-- ============ VISTA: ROM ============ -->
<section class="view active" data-view="rom">
  <h1>ROM &amp; Identificazione</h1>
  <p class="sub">Punto d'ingresso: carica una ROM (qualsiasi console) o un file <b>.zip</b>. Viene estratta e identificata
  realmente in memoria — nessun file salvato. Da qui tutti gli altri tool la riutilizzano senza ri-caricarla.</p>

  <div class="flow" id="flow">
    <span class="step" id="fs-load">1 · carica</span>
    <span class="step" id="fs-id">2 · identifica</span>
    <span class="step" id="fs-prep">3 · prepara z64</span>
    <span class="step" id="fs-edit">4 · modifica</span>
    <span class="step" id="fs-export">5 · esporta</span>
  </div>

  <div class="card">
    <h2>Carica ROM o archivio ZIP</h2>
    <div class="dropzone" id="dropzone" onclick="document.getElementById('rom-input').click()">
      <div class="big">📂</div>
      <div>Trascina qui la tua ROM (.z64 .v64 .n64 .smc .sfc .nes .gb .gba .nds .md .iso…) o un .zip<br>
      <span class="muted">oppure clicca per scegliere il file</span></div>
    </div>
    <input type="file" id="rom-input" accept=".zip,.z64,.v64,.n64,.smc,.sfc,.nes,.gb,.gbc,.gba,.nds,.md,.bin,.iso,.gcm" style="display:none" />
    <div class="log" id="rom-log" style="margin-top:12px">In attesa di un file…</div>
    <div id="rom-dl"></div>
  </div>

  <div class="card">
    <h2>Header ROM</h2>
    <p class="muted" style="margin:0 0 10px">Lettura automatica sulla ROM caricata (N64: primi 64 byte · SNES: header con checksum).</p>
    <div class="row">
      <button class="btn dark" onclick="inspectHeadersUI()">Leggi header N64</button>
      <button class="btn dark" onclick="inspectHeadersUI(true)">Leggi header SNES</button>
    </div>
    <div class="log" id="hdr-log" style="margin-top:10px">—</div>
  </div>
</section>

<!-- ============ VISTA: SPLIT ============ -->
<section class="view" data-view="split">
  <h1>Split &amp; Compressione</h1>
  <p class="sub">Trova i blocchi compressi nella ROM caricata, decomprimili nel <b>blob corrente</b>, modifica, ricomprimi.
  Con <code>splat</code> installato è disponibile lo split completo reale.</p>

  <div class="card">
    <h2>Scanner blocchi MIO0 / Yay0</h2>
    <p class="muted" style="margin:0 0 10px">Opera sulla ROM caricata nella vista ROM. Ogni blocco trovato può essere decompresso direttamente.</p>
    <div class="row">
      <button class="btn pri" onclick="scanUI()">Scansiona ROM</button>
      <button class="btn dark" onclick="splatSplitUI()">Split completo con splat</button>
    </div>
    <div class="log" id="scan-log" style="margin-top:10px">—</div>
    <div id="scan-table"></div>
  </div>

  <div class="card">
    <h2>Compressione manuale</h2>
    <p class="muted" style="margin:0 0 10px">Decomprimi/ricomprimi blob (il risultato di una decompressione diventa il blob corrente, visibile nel chip in alto).</p>
    <div class="row">
      <div class="field">File blob<input type="file" id="comp-file" /></div>
      <button class="btn dark" onclick="decompUI('mio0')">Decomprimi MIO0</button>
      <button class="btn dark" onclick="decompUI('yay0')">Decomprimi Yay0</button>
      <button class="btn dark" onclick="compUI('mio0')">Comprimi MIO0</button>
      <button class="btn dark" onclick="compUI('yay0')">Comprimi Yay0</button>
    </div>
    <div class="log" id="comp-log" style="margin-top:10px">—</div>
    <div id="comp-dl"></div>
  </div>
</section>

<!-- ============ VISTA: GRAFICA ============ -->
<section class="view" data-view="graphics">
  <h1>Texture &amp; 3D</h1>
  <p class="sub">Decodifica texture N64 (9 formati RDP) e display list F3D con estrazione mesh, wireframe e editing vertici.
  Il blob corrente (es. un blocco MIO0 decompresso) viene usato come sorgente quando presente.</p>

  <div class="card">
    <h2>Decoder texture N64</h2>
    <div class="row">
      <div class="field">File texture (se nessun blob)<input type="file" id="tex-file" /></div>
      <div class="field">Larghezza<input type="number" id="tex-w" value="32" style="width:70px" /></div>
      <div class="field">Altezza<input type="number" id="tex-h" value="32" style="width:70px" /></div>
      <div class="field">Formato<select id="tex-format">
        <option>RGBA16</option><option>RGBA32</option><option>IA16</option><option>IA8</option>
        <option>IA4</option><option>I8</option><option>I4</option><option>CI4</option><option>CI8</option>
      </select></div>
      <div class="field">Offset nel blob<input type="number" id="tex-off" value="0" style="width:80px" /></div>
    </div>
    <div class="row" id="tex-pal-row" style="display:none; margin-top:8px;">
      <div class="field">File palette (CI4/CI8, RGBA16)<input type="file" id="tex-pal" /></div>
    </div>
    <div class="row" style="margin-top:10px">
      <label class="muted"><input type="checkbox" id="tex-use-blob" checked /> usa blob corrente se presente</label>
      <button class="btn pri" onclick="decodeTexUI()">Decodifica</button>
    </div>
    <div class="log" id="tex-log" style="margin-top:10px">—</div><br>
    <canvas id="tex-canvas" width="32" height="32" style="max-width:320px"></canvas>
  </div>

  <div class="card">
    <h2>Display list F3D → mesh 3D</h2>
    <div class="row">
      <div class="field">File display list (se nessun blob)<input type="file" id="f3d-dl" /></div>
      <div class="field">File blob vertici (16 B/vertex)<input type="file" id="f3d-vtx" /></div>
    </div>
    <p class="muted" style="margin:8px 0 10px">Nota: la display list consuma il blob corrente solo se è una DL — carica la DL come file o decomprimila prima come blob.</p>
    <button class="btn pri" onclick="f3dParseUI()">Interpreta e disegna mesh</button>
    <div class="log" id="f3d-log" style="margin-top:10px">—</div>
    <div id="f3d-cmds" style="max-height:220px; overflow-y:auto; margin-top:8px"></div>
    <div id="f3d-vtx-edit" style="display:none; margin-top:12px">
      <h2 style="font-size:12px; text-transform:uppercase; color:var(--mut)">✏️ Vertici modificabili</h2>
      <div id="f3d-vtx-table" style="max-height:200px; overflow-y:auto"></div>
      <div class="row" style="margin-top:8px">
        <button class="btn purple" onclick="f3dSerializeUI()">Riserializza vertici → blob + display list</button>
      </div>
    </div>
    <div id="f3d-dl2"></div>
    <canvas id="f3d-canvas" width="640" height="400" style="margin-top:12px; width:100%; max-width:640px"></canvas>
  </div>
</section>

<!-- ============ VISTA: LEVEL SCRIPT ============ -->
<section class="view" data-view="level">
  <h1>Level Script SM64</h1>
  <p class="sub">Interpreta e modifica i comandi di script di livello (formato documentato dalla community).
  Sorgente: blob corrente, file, o hex incollato; decompressione MIO0 opzionale inline.</p>
  <div class="card">
    <div class="row">
      <div class="field">File segmento (se nessun blob/hex)<input type="file" id="ls-file" /></div>
      <label class="muted"><input type="checkbox" id="ls-use-blob" checked /> usa blob corrente</label>
      <label class="muted"><input type="checkbox" id="ls-mio0" /> decomprimi come MIO0 prima</label>
    </div>
    <textarea id="ls-hex" rows="2" placeholder="…oppure incolla hex: 24 1F 00 09 …" style="margin-top:8px"></textarea>
    <div class="row" style="margin-top:10px">
      <button class="btn pri" onclick="lsParseUI()">Interpreta comandi</button>
      <button class="btn purple" id="ls-save" style="display:none" onclick="lsSaveUI()">Applica modifiche e scarica</button>
    </div>
    <div class="log" id="ls-log" style="margin-top:10px">—</div>
    <div id="ls-table" style="max-height:400px; overflow-y:auto; margin-top:10px"></div>
  </div>
</section>

<!-- ============ VISTA: DISASSEMBLER ============ -->
<section class="view" data-view="code">
  <h1>Disassembler MIPS R4300i</h1>
  <p class="sub">Leggi il codice contenuto nella ROM o nel blob corrente. Subset MIPS I/III reale; istruzioni non mappate → UNKNOWN onesto.</p>
  <div class="card">
    <div class="row">
      <div class="field">File codice (se nessun blob)<input type="file" id="mips-file" /></div>
      <div class="field">Offset nel blob<input type="number" id="mips-off" value="0" style="width:90px" /></div>
      <div class="field">Lunghezza (byte)<input type="number" id="mips-len" value="1024" style="width:90px" /></div>
      <div class="field">Indirizzo base (hex)<input type="text" id="mips-base" value="80246000" style="width:100px" /></div>
      <button class="btn pri" onclick="mipsUI()">Disassembla</button>
    </div>
    <div class="log" id="mips-log" style="margin-top:10px">—</div>
    <div id="mips-table" style="max-height:420px; overflow-y:auto; margin-top:8px"></div>
  </div>
</section>

<!-- ============ VISTA: PATCHER & CRC ============ -->
<section class="view" data-view="patch">
  <h1>Patcher &amp; Checksum</h1>
  <p class="sub">Applica patch IPS/BPS reali alla tua ROM e ricalcola i checksum CRC del boot — l'ultimo passo per una ROM modificata che avvia davvero.</p>

  <div class="card" id="decl-card">
    <h2>1 · Dichiarazione d'uso (una volta sola)</h2>
    <p class="muted" style="margin:0 0 8px">Nessuno strumento locale può verificare il possesso di una copia autentica: questa è una dichiarazione firmata, non una prova legale. Vale per patcher, CRC fix, splat e recomp.</p>
    <div class="log" id="decl-text" style="max-height:110px"></div>
    <div class="row" style="margin-top:10px">
      <div class="field" style="flex:1">Nome e cognome<input type="text" id="decl-name" placeholder="Mario Rossi" /></div>
    </div>
    <div class="field" style="margin-top:6px">Ridigita/incolla esattamente il testo sopra<textarea id="decl-stmt" rows="2"></textarea></div>
    <button class="btn pri" style="margin-top:10px" onclick="declAcceptUI()">Registra dichiarazione</button>
    <span class="muted" id="decl-status" style="margin-left:10px"></span>
  </div>

  <div class="card">
    <h2>2 · Checksum CRC (N64)</h2>
    <p class="muted" style="margin:0 0 10px">Usa la ROM caricata (convertita z64) oppure un file. CIC rilevato dall'IPL3; algoritmi famiglia-6102 e 6105 reali.</p>
    <div class="row">
      <div class="field">File ROM (se nessuna caricata)<input type="file" id="crc-file" /></div>
      <button class="btn dark" onclick="crcComputeUI()">Verifica checksum</button>
      <button class="btn pri" onclick="crcFixUI()">Ricalcola e scarica ROM fixata</button>
    </div>
    <div class="log" id="crc-log" style="margin-top:10px">—</div>
    <div id="crc-dl"></div>
  </div>

  <div class="card">
    <h2>2b · Checksum Genesis / Mega Drive</h2>
    <p class="muted" style="margin:0 0 10px">Verifica e fix del checksum a 0x18E. Due formati REALI: algoritmo Sega originale (somma word da 0x200, fonte Sega Retro/plutiedev) e variante XOR di SGDK (dal sorgente sizebnd). Usa la ROM caricata o un file.</p>
    <div class="row">
      <div class="field">File ROM (se nessuna caricata)<input type="file" id="gen-file" /></div>
      <button class="btn dark" onclick="genHeaderUI()">Leggi header e verifica</button>
      <button class="btn pri" onclick="genFixUI(false)">Fix (formato Sega)</button>
      <button class="btn dark" onclick="genFixUI(true)">Fix (formato SGDK)</button>
    </div>
    <div class="log" id="gen-log" style="margin-top:10px">—</div>
    <div id="gen-dl"></div>
  </div>

  <div class="card">
    <h2>3 · Applica patch IPS / BPS</h2>
    <div class="row">
      <div class="field">ROM base (default: caricata)<input type="file" id="patch-rom" /></div>
      <div class="field">File patch .ips/.bps<input type="file" id="patch-file" /></div>
      <button class="btn pri" onclick="patchApplyUI()">Applica patch reale</button>
    </div>
    <div class="log" id="patch-log" style="margin-top:10px">—</div>
    <div id="patch-dl"></div>
  </div>
</section>

<!-- ============ VISTA: RECOMP ============ -->
<section class="view" data-view="recomp">
  <h1>N64Recomp — ricompilazione statica</h1>
  <p class="sub">Genera un <code>recomp.toml</code> reale (schema Zelda64Recomp) e, se il binario è installato, esegue la ricompilazione della ROM caricata in una directory temporanea cancellata subito dopo.</p>
  <div class="card">
    <div class="log" id="recomp-status">Stato: caricamento…</div>
    <div class="row" style="margin-top:12px">
      <div class="field">Nome gioco<input type="text" id="rc-game" placeholder="Super Mario 64" /></div>
      <div class="field">Entrypoint hex (SM64 US: 80246000)<input type="text" id="rc-entry" placeholder="80246000" /></div>
    </div>
    <div class="row" style="margin-top:8px">
      <div class="field">ELF con simboli (opzionale)<input type="file" id="rc-elf" /></div>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn dark" onclick="rcConfigUI()">Genera recomp.toml</button>
      <button class="btn pri" onclick="rcRunUI()">Esegui ricompilazione reale</button>
    </div>
    <div class="log" id="recomp-log" style="margin-top:10px">—</div>
    <div id="recomp-dl"></div>
  </div>
</section>

<!-- ============ VISTA: HOMEBREW ============ -->
<section class="view" data-view="homebrew">
  <h1>Compilatore Homebrew</h1>
  <p class="sub">Compila codice C reale contro i toolchain devkitPro installati (Switch/Wii/GameCube) e scarica progetti Makefile completi.</p>
  <div class="card">
    <h2>Piattaforma target</h2>
    <div class="platgrid" id="platgrid"></div>
  </div>
  <div class="card">
    <h2>Editor sorgente (C via nintendo_hal.h)</h2>
    <textarea id="code-editor" rows="14"></textarea>
    <div class="row" style="margin-top:10px">
      <button class="btn pri" onclick="compileUI()">Compila &amp; Pacchettizza</button>
      <button class="btn dark" onclick="scaffoldUI()">Genera progetto Makefile</button>
    </div>
    <div class="log" id="compile-log" style="margin-top:10px">Pronto.</div>
    <div id="compile-dl"></div>
  </div>
</section>

<!-- ============ VISTA: SETUP ============ -->
<section class="view" data-view="setup">
  <h1>Setup &amp; Toolchain</h1>
  <p class="sub">La verità su cosa è installato davvero su questa macchina. Nessun finto stato: strumento assente = istruzioni reali per installarlo.</p>
  <div class="card"><h2>Toolchain devkitPro</h2><div id="tc-status" class="log">caricamento…</div></div>
  <div class="card"><h2>splat (splitter reale)</h2><div id="splat-status" class="log">caricamento…</div></div>
  <div class="card"><h2>N64Recomp</h2><div id="nrecomp-status" class="log">caricamento…</div></div>
  <div class="card"><h2>Sega / Sony (SGDK · KallistiOS · pspdev)</h2><div id="extra-status" class="log">caricamento…</div></div>
</section>

</main>
</div>

<div class="statusbar" id="statusbar">Pronto.</div>

<!-- Modale onboarding: rileva i toolchain mancanti e guida l'installazione reale -->
<div class="modal-overlay" id="onboard-overlay" style="display:none">
  <div class="modal">
    <h1>⚙️ Configura i toolchain reali (una volta sola)</h1>
    <p class="sub" style="margin-bottom:6px">Questo studio usa <b>compilatori e SDK reali</b>, installati sul tuo computer:
      niente è simulato. Su questa macchina alcuni mancano ancora — ecco cosa puoi fare con o senza di essi.</p>
    <p class="ok-note">✅ Funziona SUBITO, senza installare nulla: identificazione ROM (anche ZIP), estrazione e
      decompressione MIO0/Yay0, level script, texture, mesh 3D F3D, disassembler, patcher IPS/BPS,
      fix checksum N64/Genesis, scaffolding progetti.</p>
    <p class="warn-note" style="margin-top:4px">⚠️ Serve il toolchain per: compilare homebrew per la piattaforma
      corrispondente, split completo con splat, ricompilazione N64Recomp.</p>
    <div id="onboard-missing"></div>
    <div class="row" style="margin-top:18px; justify-content:flex-end">
      <button class="btn dark" onclick="hideOnboard()">Continua senza installare (riappare al prossimo avvio)</button>
      <button class="btn purple" onclick="hideOnboard(true)">Ho installato tutto, non mostrarla più</button>
    </div>
    <p class="muted" style="margin:10px 0 0">Stato sempre visibile in ⚙️ Setup &amp; Toolchain. La modale riappare a ogni
      avvio finché manca qualcosa (o finché non scegli di non vederla più).</p>
  </div>
</div>

<script>
"use strict";
// ================= stato globale =================
const state = {
  rom: null, romName: "", romConsole: "",          // ROM (z64 preparata se N64)
  rawZip: null,                                     // zip originale se caricato
  blob: null, blobName: "",                         // blob corrente (segmento decompresso)
  declToken: null, declName: null,
  lsCommands: null, f3dMesh: null,
};
let activePlatform = "switch";

// ================= utilità =================
const $ = (id) => document.getElementById(id);
function setStatus(msg) { $("statusbar").textContent = msg; }
function log(id, msg, color) { const el = $(id); el.textContent = msg; el.style.color = color || "var(--mut)"; }
function fileToBytes(f) { return f.arrayBuffer().then(b => new Uint8Array(b)); }
function toB64(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
function fromB64(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  return res.json();
}
function download(bytes, name, label, target) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  a.download = name; a.textContent = "⬇ " + label; a.className = "dl";
  (target ? $(target) : document.body).appendChild(a); return a;
}
function kb(n) { return (n / 1024).toFixed(1) + " KB"; }
function mb(n) { return (n / 1024 / 1024).toFixed(1) + " MB"; }

// ================= navigazione =================
document.querySelectorAll(".navbtn").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".navbtn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  btn.classList.add("active");
  document.querySelector('.view[data-view="' + btn.dataset.view + '"]').classList.add("active");
}));

// ================= chips + flow =================
function refreshChips() {
  const cr = $("chip-rom");
  if (state.rom) { cr.className = "chip ok"; cr.textContent = "🗂 " + state.romName + " · " + state.romConsole + " · " + mb(state.rom.length); }
  else { cr.className = "chip"; cr.textContent = "🗂 Nessuna ROM caricata"; }
  const cb = $("chip-blob");
  if (state.blob) { cb.style.display = ""; cb.className = "chip ok"; cb.textContent = "📦 blob: " + state.blobName + " · " + kb(state.blob.length); }
  else cb.style.display = "none";
  const cd = $("chip-decl");
  if (state.declToken) { cd.className = "chip ok"; cd.textContent = "✍️ Dichiarazione: " + state.declName; }
  else { cd.className = "chip warn"; cd.textContent = "✍️ Dichiarazione mancante"; }
}
function setFlow(stepId, done) { $(stepId).classList.toggle("done", done); }
function setBlob(bytes, name) { state.blob = bytes; state.blobName = name; refreshChips(); setStatus("blob corrente: " + name + " (" + bytes.length + " byte)"); }

// ================= VISTA ROM =================
const dz = $("dropzone");
dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files[0]) loadRom(e.dataTransfer.files[0]); });
$("rom-input").addEventListener("change", e => { if (e.target.files[0]) loadRom(e.target.files[0]); });

async function loadRom(file) {
  log("rom-log", "⚡ Lettura e identificazione reale in corso…", "var(--warn)");
  $("rom-dl").innerHTML = "";
  try {
    const bytes = await fileToBytes(file);
    const data = await api("/api/rom/identify", { romBase64: toB64(bytes) });
    if (data.error) { log("rom-log", "✗ " + data.error, "var(--err)"); return; }
    setFlow("fs-load", true); setFlow("fs-id", true); setFlow("fs-prep", false); setFlow("fs-edit", false); setFlow("fs-export", false);

    let lines = [];
    if (data.isArchive) {
      lines.push("Archivio ZIP con " + data.entries.length + " voci estratte realmente:");
      data.entries.forEach(e => lines.push("  · " + e.name + " → " + e.console + " (" + e.format + ", " + e.confidence + ")"));
    } else {
      const e = data.entries[0];
      lines.push(e.console + " · " + e.format + " · " + e.detail);
    }

    // prendi la prima voce ROM identificata con sicurezza
    const first = data.entries.find(e => e.confidence === "magic" && e.console !== "ignorata");
    state.romConsole = first ? first.console : (data.entries[0].console || "?");
    state.rom = bytes; state.romName = file.name;
    log("rom-log", lines.join("\\n"), first ? "var(--ok)" : "var(--warn)");

    // se N64 non-z64: conversione automatica
    if (state.romConsole === "Nintendo 64" && first && first.format.indexOf("z64") === -1) {
      const conv = await api("/api/rom/convert", { romBase64: toB64(bytes) });
      if (!conv.error) {
        state.rom = fromB64(conv.romBase64);
        state.romName = file.name.replace(/\\.[^.]+$/, "") + ".z64";
        log("rom-log", lines.join("\\n") + "\\n\\n✓ Convertita automaticamente da " + conv.from + " a .z64 (" + mb(conv.size) + ")", "var(--ok)");
        download(state.rom, state.romName, "Scarica ROM convertita .z64", "rom-dl");
      }
    }
    if (state.romConsole === "Nintendo 64") setFlow("fs-prep", true);
    refreshChips();
    setStatus("ROM caricata: " + state.romName + " (" + state.romConsole + ")");
  } catch (e) { log("rom-log", "Errore: " + e.message, "var(--err)"); }
}

async function inspectHeadersUI(snes) {
  if (!state.rom) { log("hdr-log", "Prima carica una ROM nella vista ROM.", "var(--err)"); return; }
  log("hdr-log", "⚡ Lettura header reale…", "var(--warn)");
  try {
    if (snes) {
      const d = await api("/api/snes/rom-header", { romBase64: toB64(state.rom) });
      if (d.error) { log("hdr-log", "✗ " + d.error, "var(--err)"); return; }
      log("hdr-log", "Mappatura: " + d.mapping + " (header a " + d.headerOffset + ")\\nTitolo: " + d.title +
        "\\nChipset: " + d.chipset + "\\nROM: " + (d.romSize / 1024) + " KB · SRAM: " + (d.sramSize / 1024) +
        " KB\\nRegione: " + d.destination + "\\nChecksum: " + d.checksum + (d.checksumConsistent ? " ✓ coerente" : " ⚠ non coerente"),
        d.checksumConsistent ? "var(--ok)" : "var(--warn)");
    } else {
      const d = await api("/api/n64/rom-header", { bytesBase64: toB64(state.rom.slice(0, 0x40)) });
      if (d.error) { log("hdr-log", "✗ " + d.error, "var(--err)"); return; }
      log("hdr-log", (d.looksLikeValidN64Rom ? "✓ Magic ROM N64 riconosciuto" : "⚠ Magic non riconosciuto") +
        "\\nTitolo: " + (d.imageName || "(vuoto)") + "\\nCartridge ID: " + d.cartridgeId +
        "\\nRegione: " + d.countryName + "\\nVersione: " + d.version +
        "\\nCRC memorizzati: " + d.crc1 + " / " + d.crc2 + "\\nFormato cartuccia: " + d.cartridgeFormat,
        d.looksLikeValidN64Rom ? "var(--ok)" : "var(--warn)");
    }
  } catch (e) { log("hdr-log", "Errore: " + e.message, "var(--err)"); }
}

// ================= VISTA SPLIT =================
async function scanUI() {
  if (!state.rom) { log("scan-log", "Prima carica una ROM (vista ROM).", "var(--err)"); return; }
  log("scan-log", "⚡ Scansione blocchi MIO0/Yay0…", "var(--warn)");
  $("scan-table").innerHTML = "";
  try {
    const d = await api("/api/n64/split/scan", { romBase64: toB64(state.rom) });
    if (d.error) { log("scan-log", "✗ " + d.error, "var(--err)"); return; }
    log("scan-log", "✓ " + d.count + " blocchi con header valido trovati.", "var(--ok)");
    if (!d.count) return;
    let html = '<table class="tbl"><tr><th>Offset</th><th>Formato</th><th>Compresso</th><th>Decompresso</th><th></th></tr>';
    d.sections.forEach((s, i) => {
      html += '<tr><td>' + s.offset + '</td><td>' + s.format + '</td><td>' + kb(s.compressedSize) +
        '</td><td>' + kb(s.decompressedSize) + '</td><td><button class="btn pri mini" onclick="decompBlock(' + i + ')">Decomprimi → blob</button></td></tr>';
    });
    $("scan-table").innerHTML = html + "</table>";
    window._scanSections = d.sections;
  } catch (e) { log("scan-log", "Errore: " + e.message, "var(--err)"); }
}

async function decompBlock(i) {
  const s = window._scanSections[i];
  const off = parseInt(s.offset, 16);
  const bytes = state.rom.slice(off, off + s.compressedSize);
  const ep = s.format === "MIO0" ? "/api/n64/mio0/decompress" : "/api/n64/yay0/decompress";
  try {
    const d = await api(ep, { dataBase64: toB64(bytes) });
    if (d.error) { log("scan-log", "✗ " + d.error, "var(--err)"); return; }
    setBlob(fromB64(d.decompressedBase64), s.format + "@" + s.offset);
    log("scan-log", "✓ Blocco " + s.offset + " decompresso: " + d.decompressedSize + " byte → ora è il blob corrente (vedi chip in alto).\\nDisponibile per Texture/3D, Level Script e Disassembler.", "var(--ok)");
    setFlow("fs-edit", true);
  } catch (e) { log("scan-log", "Errore: " + e.message, "var(--err)"); }
}

async function splatSplitUI() {
  if (!state.rom) { log("scan-log", "Prima carica una ROM (vista ROM).", "var(--err)"); return; }
  if (!state.declToken) { log("scan-log", "✗ Serve la dichiarazione (vista Patcher & CRC).", "var(--err)"); return; }
  log("scan-log", "⚡ Split reale con splat in corso (può richiedere minuti)…", "var(--warn)");
  try {
    const d = await api("/api/splat/split", { fullName: state.declName, token: state.declToken, romBase64: toB64(state.rom) });
    if (!d.success) { log("scan-log", "✗ " + (d.error || d.logs).substring(0, 800), "var(--err)"); return; }
    log("scan-log", "✓ splat: " + d.files.length + " file reali prodotti.", "var(--ok)");
    d.files.slice(0, 30).forEach(f => download(fromB64(f.base64), f.name.replace(/\\//g, "_"), f.name + " (" + f.size + " B)", "scan-table"));
  } catch (e) { log("scan-log", "Errore: " + e.message, "var(--err)"); }
}

async function decompUI(fmt) {
  const f = $("comp-file").files[0];
  if (!f) { log("comp-log", "Seleziona un file blob.", "var(--err)"); return; }
  const bytes = await fileToBytes(f);
  const d = await api("/api/n64/" + fmt + "/decompress", { dataBase64: toB64(bytes) });
  if (d.error) { log("comp-log", "✗ " + d.error, "var(--err)"); return; }
  setBlob(fromB64(d.decompressedBase64), fmt + ":" + f.name);
  log("comp-log", "✓ Decompresso: " + d.decompressedSize + " byte → blob corrente.", "var(--ok)");
}
async function compUI(fmt) {
  const src = state.blob || ($("comp-file").files[0] ? await fileToBytes($("comp-file").files[0]) : null);
  if (!src) { log("comp-log", "Nessun blob corrente né file selezionato.", "var(--err)"); return; }
  const d = await api("/api/n64/" + fmt + "/compress", { dataBase64: toB64(src) });
  if (d.error) { log("comp-log", "✗ " + d.error, "var(--err)"); return; }
  log("comp-log", "✓ Compresso: " + src.length + " → " + d.compressedSize + " byte.", "var(--ok)");
  setFlow("fs-export", true);
  $("comp-dl").innerHTML = "";
  download(fromB64(d.compressedBase64), "compressed_" + fmt.toLowerCase() + ".bin", "Scarica blocco " + fmt + " (" + kb(d.compressedSize) + ")", "comp-dl");
}

// ================= VISTA GRAFICA =================
$("tex-format").addEventListener("change", e => { $("tex-pal-row").style.display = (e.target.value === "CI4" || e.target.value === "CI8") ? "flex" : "none"; });

async function decodeTexUI() {
  const fmt = $("tex-format").value, w = +$("tex-w").value, h = +$("tex-h").value, off = +$("tex-off").value;
  let data = null;
  if ($("tex-use-blob").checked && state.blob) data = state.blob.slice(off);
  else if ($("tex-file").files[0]) data = await fileToBytes($("tex-file").files[0]);
  if (!data) { log("tex-log", "Nessun blob corrente né file texture.", "var(--err)"); return; }
  const body = { width: w, height: h, format: fmt, dataBase64: toB64(data) };
  if (fmt === "CI4" || fmt === "CI8") {
    const pf = $("tex-pal").files[0];
    if (!pf) { log("tex-log", "Formato indicizzato: serve anche la palette.", "var(--err)"); return; }
    body.paletteBase64 = toB64(await fileToBytes(pf));
  }
  log("tex-log", "⚡ Decodifica reale " + fmt + " " + w + "x" + h + "…", "var(--warn)");
  const d = await api("/api/n64/texture/decode", body);
  if (d.error) { log("tex-log", "✗ " + d.error, "var(--err)"); return; }
  const cv = $("tex-canvas"); cv.width = d.width; cv.height = d.height;
  const ctx = cv.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(fromB64(d.rgbaBase64)), d.width, d.height), 0, 0);
  log("tex-log", "✓ Texture decodificata (" + fmt + ", " + d.width + "x" + d.height + ").", "var(--ok)");
}

async function f3dParseUI() {
  let dl = null;
  if ($("f3d-dl").files[0]) dl = await fileToBytes($("f3d-dl").files[0]);
  else if (state.blob) dl = state.blob;
  if (!dl) { log("f3d-log", "Carica una display list (file) o crea un blob corrente.", "var(--err)"); return; }
  const vtx = $("f3d-vtx").files[0] ? await fileToBytes($("f3d-vtx").files[0]) : null;
  const body = { dlBase64: toB64(dl) };
  if (vtx) body.vtxBase64 = toB64(vtx);
  log("f3d-log", "⚡ Parsing display list F3D…", "var(--warn)");
  const d = await api("/api/n64/f3d/parse", body);
  if (d.error) { log("f3d-log", "✗ " + d.error, "var(--err)"); return; }
  log("f3d-log", "✓ " + d.commands.length + " comandi interpretati." +
    (d.endedAt === null ? " ⚠ nessun ENDDL: lista troncata." : "") +
    (d.warnings && d.warnings.length ? " ⚠ " + d.warnings.length + " avvisi." : ""),
    d.endedAt === null ? "var(--warn)" : "var(--ok)");
  let html = '<table class="tbl"><tr><th>Offset</th><th>Comando</th><th>Campi</th></tr>';
  d.commands.slice(0, 80).forEach(c => {
    const fields = Object.keys(c.fields).map(k => k + "=" + c.fields[k]).join(" ");
    html += '<tr><td>0x' + c.offset.toString(16) + '</td><td>' + c.name + '</td><td class="muted">' + fields + '</td></tr>';
  });
  $("f3d-cmds").innerHTML = html + "</table>";
  if (d.mesh && d.mesh.triangles.length > 0) { drawWire(d.mesh); renderVtxEditor(d.mesh); setFlow("fs-edit", true); }
}

function drawWire(mesh) {
  const cv = $("f3d-canvas"), ctx = cv.getContext("2d");
  ctx.fillStyle = "#05060b"; ctx.fillRect(0, 0, cv.width, cv.height);
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
  mesh.vertices.forEach(v => { mnx = Math.min(mnx, v.x); mxx = Math.max(mxx, v.x); mny = Math.min(mny, v.y); mxy = Math.max(mxy, v.y); mnz = Math.min(mnz, v.z); mxz = Math.max(mxz, v.z); });
  const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
  const sc = (cv.width * 0.35) / Math.max(mxx - mnx, mxy - mny, mxz - mnz, 1);
  const P = v => { const z = 600 / (600 + (v.z - cz)); return { x: cv.width / 2 + (v.x - cx) * sc * z, y: cv.height / 2 - (v.y - cy) * sc * z }; };
  ctx.strokeStyle = "#00c6ff"; ctx.lineWidth = 0.8;
  mesh.triangles.forEach(t => {
    const a = P(mesh.vertices[t[0]]), b = P(mesh.vertices[t[1]]), c = P(mesh.vertices[t[2]]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.stroke();
  });
  ctx.fillStyle = "#9ca3af"; ctx.font = "12px monospace";
  ctx.fillText(mesh.vertices.length + " vertici · " + mesh.triangles.length + " triangoli (wireframe reale)", 8, cv.height - 8);
}

function renderVtxEditor(mesh) {
  state.f3dMesh = mesh;
  $("f3d-vtx-edit").style.display = "block";
  let html = '<table class="tbl"><tr><th>#</th><th>X</th><th>Y</th><th>Z</th><th>U</th><th>V</th></tr>';
  mesh.vertices.slice(0, 16).forEach((v, i) => {
    html += "<tr><td>" + i + "</td>" + ["x", "y", "z", "u", "v"].map(k =>
      '<td><input type="number" data-vi="' + i + '" data-k="' + k + '" value="' + v[k] + '" style="width:60px" onchange="vtxUpd(this)" /></td>').join("") + "</tr>";
  });
  $("f3d-vtx-table").innerHTML = html + "</table>";
}
function vtxUpd(inp) { state.f3dMesh.vertices[+inp.dataset.vi][inp.dataset.k] = +inp.value; }

async function f3dSerializeUI() {
  if (!state.f3dMesh) return;
  log("f3d-log", "⚡ Riserializzazione…", "var(--warn)");
  const d = await api("/api/n64/f3d/serialize-mesh", { vertices: state.f3dMesh.vertices, triangles: state.f3dMesh.triangles });
  if (d.error) { log("f3d-log", "✗ " + d.error, "var(--err)"); return; }
  log("f3d-log", "✓ " + d.vertexCount + " vertici riserializzati + display list da " + (d.dlSize || 0) + " byte.", "var(--ok)");
  $("f3d-dl2").innerHTML = "";
  download(fromB64(d.vtxBase64), "vtx_edited.bin", "Blob vertici modificato (" + d.vertexCount * 16 + " B)", "f3d-dl2");
  if (d.dlBase64) download(fromB64(d.dlBase64), "dl_rebuilt.bin", "Display list ricostruita (" + d.dlSize + " B)", "f3d-dl2");
  setFlow("fs-export", true);
}

// ================= VISTA LEVEL SCRIPT =================
async function lsGetSource() {
  if ($("ls-use-blob").checked && state.blob) return state.blob;
  if ($("ls-file").files[0]) return fileToBytes($("ls-file").files[0]);
  const hex = $("ls-hex").value.trim();
  if (hex) { const c = hex.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, ""); const u = new Uint8Array(c.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(c.substr(i * 2, 2), 16); return u; }
  return null;
}
async function lsParseUI() {
  $("ls-table").innerHTML = ""; $("ls-save").style.display = "none";
  let bytes = await lsGetSource();
  if (!bytes) { log("ls-log", "Nessuna sorgente (blob/file/hex).", "var(--err)"); return; }
  log("ls-log", "⚡ Interpretazione comandi…", "var(--warn)");
  if ($("ls-mio0").checked) {
    const d = await api("/api/n64/mio0/decompress", { dataBase64: toB64(bytes) });
    if (d.error) { log("ls-log", "✗ " + d.error, "var(--err)"); return; }
    bytes = fromB64(d.decompressedBase64);
  }
  const d = await api("/api/sm64/levelscript/parse", { bytesBase64: toB64(bytes) });
  if (d.error) { log("ls-log", "✗ " + d.error, "var(--err)"); return; }
  state.lsCommands = d.commands;
  log("ls-log", "✓ " + d.commands.length + " comandi interpretati." + (d.truncatedAt !== null ? " Interrotto a " + d.truncatedAt + " (opcode non mappato)." : ""), "var(--ok)");
  let html = '<table class="tbl"><tr><th>Offset</th><th>Comando</th><th>Campi</th></tr>';
  d.commands.forEach((c, i) => {
    const fks = Object.keys(c.fields);
    const fields = fks.length === 0 ? '<span class="muted">(non editabile)</span>' :
      fks.map(fn => fn + ': <input type="number" data-ci="' + i + '" data-f="' + fn + '" value="' + c.fields[fn] + '" style="width:64px" onchange="lsUpd(this)" />').join(" ");
    html += '<tr><td>0x' + c.offset.toString(16) + '</td><td>' + c.name + '</td><td>' + fields + '</td></tr>';
  });
  $("ls-table").innerHTML = html + "</table>";
  $("ls-save").style.display = d.commands.some(c => Object.keys(c.fields).length) ? "inline-block" : "none";
}
function lsUpd(inp) { state.lsCommands[+inp.dataset.ci].fields[inp.dataset.f] = +inp.value; }
async function lsSaveUI() {
  const d = await api("/api/sm64/levelscript/serialize", { commands: state.lsCommands });
  if (d.error) { log("ls-log", "✗ " + d.error, "var(--err)"); return; }
  log("ls-log", "✓ Riserializzati " + d.size + " byte.", "var(--ok)");
  setBlob(fromB64(d.bytesBase64), "levelscript_edited");
  setFlow("fs-export", true);
  log("ls-log", "✓ Riserializzati " + d.size + " byte → ora è il blob corrente (ricomprimibile nella vista Split).", "var(--ok)");
}

// ================= VISTA DISASSEMBLER =================
async function mipsUI() {
  let bytes = null;
  const off = +$("mips-off").value, len = +$("mips-len").value;
  if (state.blob) bytes = state.blob.slice(off, off + len);
  else if (state.rom) bytes = state.rom.slice(off, off + len);
  else if ($("mips-file").files[0]) bytes = await fileToBytes($("mips-file").files[0]);
  if (!bytes) { log("mips-log", "Nessuna ROM/blob/file.", "var(--err)"); return; }
  const base = parseInt($("mips-base").value.replace(/^0x/i, ""), 16) || 0x80246000;
  log("mips-log", "⚡ Disassemblaggio reale…", "var(--warn)");
  const d = await api("/api/n64/mips/disassemble", { dataBase64: toB64(bytes), baseAddress: base, max: 400 });
  if (d.error) { log("mips-log", "✗ " + d.error, "var(--err)"); return; }
  log("mips-log", "✓ " + d.count + " istruzioni (" + d.unknownCount + " UNKNOWN onesti)." +
    (state.blob ? "" : " · sorgente: ROM caricata @ " + off), d.unknownCount ? "var(--warn)" : "var(--ok)");
  let html = '<table class="tbl"><tr><th>Addr</th><th>Word</th><th>Istruzione</th></tr>';
  d.instructions.forEach(ins => {
    html += '<tr><td>0x' + ins.address.toString(16).toUpperCase() + '</td><td class="muted">' + ins.bytes +
      '</td><td style="color:' + (ins.text.indexOf("UNKNOWN") === 0 ? "var(--warn)" : "#38bdf8") + '">' + ins.text + '</td></tr>';
  });
  $("mips-table").innerHTML = html + "</table>";
}

// ================= VISTA PATCHER & CRC =================
async function declLoad() { const d = await (await fetch("/api/patcher/declaration-text")).json(); $("decl-text").textContent = d.text; }
declLoad();
async function declAcceptUI() {
  const name = $("decl-name").value, stmt = $("decl-stmt").value;
  const d = await api("/api/patcher/acknowledge", { fullName: name, statement: stmt });
  const st = $("decl-status");
  if (d.error) { st.textContent = "✗ " + d.error; st.style.color = "var(--err)"; return; }
  state.declToken = d.token; state.declName = name;
  st.textContent = "✓ registrata (id " + d.declarationId.slice(0, 8) + "…)"; st.style.color = "var(--ok)";
  refreshChips(); setStatus("dichiarazione registrata: " + name);
}

async function crcRom() { return $("crc-file").files[0] ? fileToBytes($("crc-file").files[0]) : state.rom; }
async function crcComputeUI() {
  const rom = await crcRom();
  if (!rom) { log("crc-log", "Carica una ROM (vista ROM) o seleziona un file.", "var(--err)"); return; }
  log("crc-log", "⚡ Calcolo checksum reali…", "var(--warn)");
  const d = await api("/api/n64/crc/compute", { romBase64: toB64(rom) });
  if (d.error) { log("crc-log", "✗ " + d.error, "var(--err)"); return; }
  log("crc-log", "CIC: " + d.cic + "\\nCRC1 calcolato: " + d.crc1 + " · in ROM: " + d.storedCrc1 +
    "\\nCRC2 calcolato: " + d.crc2 + " · in ROM: " + d.storedCrc2 +
    "\\n" + (d.valid ? "✓ VALIDI: la ROM avvia così com'è." : "⚠ NON validi: la ROM va fixata (pulsante a fianco)."),
    d.valid ? "var(--ok)" : "var(--warn)");
}
async function crcFixUI() {
  const rom = await crcRom();
  if (!rom) { log("crc-log", "Carica una ROM.", "var(--err)"); return; }
  if (!state.declToken) { log("crc-log", "✗ Serve la dichiarazione (punto 1 sopra).", "var(--err)"); return; }
  log("crc-log", "⚡ Ricalcolo e scrittura CRC…", "var(--warn)");
  const d = await api("/api/n64/crc/fix", { fullName: state.declName, token: state.declToken, romBase64: toB64(rom) });
  if (d.error) { log("crc-log", "✗ " + d.error, "var(--err)"); return; }
  log("crc-log", "✓ CRC riscritti: " + d.crc1 + " / " + d.crc2 + " (CIC " + d.cic + ").", "var(--ok)");
  $("crc-dl").innerHTML = "";
  download(fromB64(d.romBase64), "rom_crcfix.z64", "Scarica ROM con checksum corretti (" + mb(d.size) + ")", "crc-dl");
  setFlow("fs-export", true);
}

// --- Checksum Genesis ---
async function genRom() { return $("gen-file").files[0] ? fileToBytes($("gen-file").files[0]) : state.rom; }
async function genHeaderUI() {
  const rom = await genRom();
  if (!rom) { log("gen-log", "Carica una ROM (vista ROM) o seleziona un file.", "var(--err)"); return; }
  log("gen-log", "⚡ Lettura header Mega Drive…", "var(--warn)");
  const d = await api("/api/genesis/rom-header", { romBase64: toB64(rom) });
  if (d.error) { log("gen-log", "✗ " + d.error, "var(--err)"); return; }
  log("gen-log",
    (d.looksLikeGenesisRom ? "✓ Header SEGA riconosciuto" : "⚠ Il nome console non inizia con SEGA (potrebbe non essere una ROM MD)") +
    "\\nTitolo (intl): " + (d.overseasTitle || "(vuoto)") +
    "\\nSeriale: " + d.serial + " · Regioni: " + (d.regions.join(", ") || d.regionCodes) +
    "\\nROM dichiarata: 0x" + d.romStart.toString(16) + "-0x" + d.romEnd.toString(16) +
    "\\nDispositivi: " + (d.devices.join("; ") || "(nessuno mappato)") +
    "\\nChecksum memorizzato: " + d.storedChecksum +
    "\\nCalcolato Sega: " + d.computedChecksum + " · Calcolato SGDK (XOR): " + d.computedChecksumSgdk +
    "\\n" + (d.checksumValid ? "✓ Valido (formato " + d.checksumFormat + ")" : "⚠ NON valido: usa un pulsante Fix"),
    d.checksumValid ? "var(--ok)" : "var(--warn)");
}
async function genFixUI(sgdk) {
  const rom = await genRom();
  if (!rom) { log("gen-log", "Carica una ROM.", "var(--err)"); return; }
  if (!state.declToken) { log("gen-log", "✗ Serve la dichiarazione (punto 1 sopra).", "var(--err)"); return; }
  log("gen-log", "⚡ Ricalcolo checksum…", "var(--warn)");
  const d = await api("/api/genesis/checksum/fix", { fullName: state.declName, token: state.declToken, romBase64: toB64(rom), sgdk });
  if (d.error) { log("gen-log", "✗ " + d.error, "var(--err)"); return; }
  log("gen-log", "✓ Checksum riscritto: " + d.checksum + " (formato " + d.format + ").", "var(--ok)");
  $("gen-dl").innerHTML = "";
  download(fromB64(d.romBase64), "rom_genfix.md", "Scarica ROM con checksum corretto (" + kb(d.size) + ")", "gen-dl");
}

async function patchApplyUI() {
  const pf = $("patch-file").files[0];
  if (!pf) { log("patch-log", "Seleziona il file patch.", "var(--err)"); return; }
  if (!state.declToken) { log("patch-log", "✗ Serve la dichiarazione (punto 1 sopra).", "var(--err)"); return; }
  const rom = $("patch-rom").files[0] ? await fileToBytes($("patch-rom").files[0]) : state.rom;
  if (!rom) { log("patch-log", "Nessuna ROM (vista ROM o file).", "var(--err)"); return; }
  log("patch-log", "⚡ Applicazione patch reale…", "var(--warn)");
  const d = await api("/api/patcher/apply", {
    fullName: state.declName, token: state.declToken,
    romBase64: toB64(rom), patchBase64: toB64(await fileToBytes(pf)),
  });
  if (d.error) { log("patch-log", "✗ " + d.error, "var(--err)"); return; }
  log("patch-log", "✓ Patch " + d.format + " applicata (" + d.patchesApplied + " record, " +
    d.inputSizeBytes + " → " + d.outputSizeBytes + " byte)." +
    (d.sourceCrcMatched === false ? " ⚠ CRC sorgente NON combacia: ROM sbagliata per questa patch?" : ""), "var(--ok)");
  $("patch-dl").innerHTML = "";
  download(fromB64(d.outputBase64), "rom_patched.bin", "Scarica ROM patchata (" + kb(d.outputSizeBytes) + ")", "patch-dl");
}

// ================= VISTA RECOMP =================
async function loadRecompStatus() {
  const d = await (await fetch("/api/recomp/status")).json();
  $("recomp-status").textContent = d.installed ? "N64Recomp: ✓ installato (" + d.binaryPath + ")" : "N64Recomp: ✗ non installato — " + d.installHint;
}
async function rcConfigUI() {
  const entry = parseInt($("rc-entry").value.replace(/^0x/i, ""), 16);
  const d = await api("/api/recomp/config", { gameName: $("rc-game").value || "game", entrypoint: entry });
  if (d.error) { log("recomp-log", "✗ " + d.error, "var(--err)"); return; }
  log("recomp-log", "recomp.toml generato:\\n\\n" + d.recompToml, "var(--ok)");
  $("recomp-dl").innerHTML = "";
  download(new TextEncoder().encode(d.recompToml), "recomp.toml", "Scarica recomp.toml", "recomp-dl");
}
async function rcRunUI() {
  if (!state.rom) { log("recomp-log", "Prima carica una ROM (vista ROM).", "var(--err)"); return; }
  if (!state.declToken) { log("recomp-log", "✗ Serve la dichiarazione (vista Patcher & CRC).", "var(--err)"); return; }
  log("recomp-log", "⚡ Ricompilazione reale in corso (può richiedere minuti)…", "var(--warn)");
  const body = { fullName: state.declName, token: state.declToken, romBase64: toB64(state.rom), gameName: $("rc-game").value || "game",
    entrypoint: parseInt($("rc-entry").value.replace(/^0x/i, ""), 16) };
  if ($("rc-elf").files[0]) body.elfBase64 = toB64(await fileToBytes($("rc-elf").files[0]));
  const d = await api("/api/recomp/run", body);
  if (!d.success) { log("recomp-log", "✗ " + (d.error || d.logs).substring(0, 1000), "var(--err)"); return; }
  log("recomp-log", "✓ Ricompilazione completata: " + d.files.length + " file.", "var(--ok)");
  d.files.slice(0, 20).forEach(f => download(fromB64(f.base64), f.name.replace(/\\//g, "_"), f.name, "recomp-dl"));
}
loadRecompStatus();

// ================= VISTA HOMEBREW =================
const PLATS = [
  ["switch", "Nintendo Switch", "ARM64 · libnx · .nro"],
  ["wii", "Nintendo Wii", "PowerPC · libogc · .dol"],
  ["gamecube", "Nintendo GameCube", "PowerPC · libogc · .dol"],
  ["n64", "Nintendo 64", "MIPS · libdragon · .z64"],
  ["snes", "Super Nintendo", "65816 · pvsneslib"],
  ["genesis", "Sega Genesis / Mega Drive", "68000 · SGDK · solo scaffold"],
  ["dreamcast", "Sega Dreamcast", "SH-4 · KallistiOS · solo scaffold"],
  ["psp", "Sony PSP", "MIPS32 · PSPSDK · solo scaffold"],
];
const SCAFFOLD_ONLY = ["genesis", "dreamcast", "psp"];
const DEFAULT_CODE = "// Codice sorgente con astrazione nintendo_hal.h
#include <nintendo_hal.h>

int main() {
    NintendoInitConsole();
    NintendoGamepad gp = {0};
    while (1) {
        NintendoUpdateGamepad(&gp);
        if (NintendoIsButtonPressed(&gp, 3)) break; // Start
        NintendoRefreshScreen();
    }
    return 0;
}";
function renderPlats() {
  $("platgrid").innerHTML = PLATS.map(p =>
    '<button class="plat' + (p[0] === activePlatform ? " active" : "") + '" data-p="' + p[0] + '">' + p[1] + "<small>" + p[2] + "</small></button>").join("");
  document.querySelectorAll(".plat").forEach(b => b.addEventListener("click", () => { activePlatform = b.dataset.p; renderPlats(); }));
}
renderPlats();
$("code-editor").value = DEFAULT_CODE;
async function compileUI() {
  if (SCAFFOLD_ONLY.indexOf(activePlatform) >= 0) {
    log("compile-log", "ℹ️ Per " + activePlatform + " questo studio genera SOLO lo scaffold reale (SGDK / KallistiOS / PSPSDK): " +
      "la compilazione richiede il toolchain specifico installato, che qui non c'è e non fingiamo. " +
      "Usa il pulsante 'Genera progetto Makefile'.", "var(--warn)");
    return;
  }
  log("compile-log", "⚡ Compilazione reale in corso…", "var(--warn)");
  const d = await api("/api/build", { platform: activePlatform, sourceCode: $("code-editor").value });
  log("compile-log", d.logs, d.success ? "var(--ok)" : "var(--err)");
  if (d.artifactBase64) download(fromB64(d.artifactBase64), "output_" + activePlatform, "Scarica binario compilato", "compile-dl");
}
async function scaffoldUI() {
  log("compile-log", "⚡ Generazione scaffold…", "var(--warn)");
  const d = await (await fetch("/api/scaffold?platform=" + activePlatform)).json();
  if (d.error) { log("compile-log", "✗ " + d.error, "var(--err)"); return; }
  log("compile-log", "✓ Scaffold reale: " + Object.keys(d.files).join(", ") + "\\n" + d.notes, "var(--ok)");
  $("compile-dl").innerHTML = "";
  Object.entries(d.files).forEach(([n, c]) => download(new TextEncoder().encode(String(c)), n.replace(/\\//g, "_"), n, "compile-dl"));
}

// ================= VISTA SETUP =================
async function loadSetup() {
  const tc = await (await fetch("/api/toolchains")).json();
  $("tc-status").textContent = Object.entries(tc).map(([p, i]) =>
    (i.detected ? "✓ " : "✗ ") + p.toUpperCase() + ": " + (i.detected ? i.path : "non installato")).join("\\n");
  const sp = await (await fetch("/api/splat/status")).json();
  $("splat-status").textContent = sp.installed ? "✓ splat " + sp.version + " (" + sp.pythonPath + ")" : "✗ non installato — " + sp.installHint;
  const rc = await (await fetch("/api/recomp/status")).json();
  $("nrecomp-status").textContent = rc.installed ? "✓ " + rc.binaryPath : "✗ non installato — " + rc.installHint;
  const ex = await (await fetch("/api/toolchains/extra")).json();
  $("extra-status").textContent =
    (ex.genesis.detected ? "✓ " : "✗ ") + "Genesis/MD — SGDK: " + (ex.genesis.detected ? ex.genesis.path : "non installato. " + ex.genesis.installHint) + "\\n" +
    (ex.dreamcast.detected ? "✓ " : "✗ ") + "Dreamcast — KallistiOS: " + (ex.dreamcast.detected ? ex.dreamcast.path : "non installato. " + ex.dreamcast.installHint) + "\\n" +
    (ex.psp.detected ? "✓ " : "✗ ") + "PSP — pspdev: " + (ex.psp.detected ? ex.psp.path : "non installato. " + ex.psp.installHint) +
    "\\n\\nNota onesta: per queste tre piattaforme lo studio genera solo scaffold reali; la compilazione richiede i rispettivi toolchain.";
}
loadSetup();

refreshChips();
setStatus("Pronto. Inizia caricando una ROM o uno ZIP dalla vista ROM.");

// ================= modale onboarding toolchain =================
// Comandi di installazione REALI (fonti: README dei rispettivi progetti).
const INSTALL_CMDS = {
  snes:      ["brew install wla-dx", "wla-65816"],
  n64:       ["git clone https://github.com/DragonMinded/libdragon && cd libdragon && ./build", "mips64-elf-gcc"],
  genesis:   ["brew install sgdk  # oppure: scarica la release da github.com/Stephane-D/SGDK ed esporta GDK=/percorso", "SGDK"],
  dreamcast: ["# build pesante (ore): segui github.com/KallistiOS/KallistiOS (dcchain)", "KallistiOS"],
  psp:       ["# segui github.com/pspdev/pspdev (toolchain PSPSDK reale)", "psp-config"],
  splat:     ["pip install splat", "splat"],
  n64recomp: ["git clone --recurse-submodules https://github.com/N64Recomp/N64Recomp && cmake -B build -S N64Recomp && cmake --build build", "N64Recomp"],
};
const TOOL_LABELS = {
  snes: "SNES — compilazione homebrew (WLA-DX)", n64: "N64 — compilazione homebrew (libdragon)",
  genesis: "Sega Mega Drive — compilazione (SGDK)", dreamcast: "Dreamcast — compilazione (KallistiOS)",
  psp: "PSP — compilazione (pspdev)", splat: "Split ROM completo (splat)", n64recomp: "Ricompilazione statica (N64Recomp)",
};

async function checkOnboarding() {
  // una volta per sessione: se l'utente l'ha chiusa con "non mostrarla più"
  // (localStorage) o tutto è installato, non appare
  if (localStorage.getItem("rcsb-onboard-dismiss") === "all") return;

  const missing = [];
  try {
    const tc = await (await fetch("/api/toolchains")).json();
    for (const [p, i] of Object.entries(tc)) if (!i.detected) missing.push(p);
    const ex = await (await fetch("/api/toolchains/extra")).json();
    for (const [p, i] of Object.entries(ex)) if (!i.detected) missing.push(p);
    const sp = await (await fetch("/api/splat/status")).json();
    if (!sp.installed) missing.push("splat");
    const rc = await (await fetch("/api/recomp/status")).json();
    if (!rc.installed) missing.push("n64recomp");
  } catch (e) { return; }

  if (missing.length === 0) return; // tutto installato: nessuna modale

  const box = $("onboard-missing");
  box.innerHTML = "<h2 style='font-size:12px; text-transform:uppercase; letter-spacing:.8px; margin:16px 0 4px; color:var(--warn)'>Manca" + (missing.length > 1 ? "no" : "") + " su questa macchina (" + missing.length + ")</h2>";
  missing.forEach((m, idx) => {
    const row = document.createElement("div");
    row.className = "tc-row";
    const cmd = INSTALL_CMDS[m] ? INSTALL_CMDS[m][0] : "(vedi vista Setup)";
    row.innerHTML = "<strong style='font-size:13px'>" + (TOOL_LABELS[m] || m) + "</strong>" +
      '<div class="cmd"><code>' + cmd.replace(/</g, "&lt;") + '</code>' +
      '<button class="btn dark mini" onclick="copyCmd(this)">Copia</button></div>';
    box.appendChild(row);
  });
  $("onboard-overlay").style.display = "flex";
  setStatus("onboarding: " + missing.length + " toolchain mancanti (vedi modale / vista Setup)");
}

function copyCmd(btn) {
  navigator.clipboard.writeText(btn.previousElementSibling.textContent)
    .then(() => { btn.textContent = "✓ Copiato"; setTimeout(() => (btn.textContent = "Copia"), 1500); })
    .catch(() => { btn.textContent = "Copia manuale"; });
}
function hideOnboard(neverShow) {
  if (neverShow) localStorage.setItem("rcsb-onboard-dismiss", "all");
  $("onboard-overlay").style.display = "none";
}
checkOnboarding();
</script>
</body>
</html>`;
