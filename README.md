# 🎮 Retro Console SDK Bridge

Studio web locale per compilare codice C contro l'astrazione hardware
`include/nintendo_hal.h`, che avvolge gli SDK homebrew **reali e open-source**
per console Nintendo: [libnx](https://github.com/switchbrew/libnx) (Switch),
[libogc](https://github.com/devkitPro/libogc) (Wii/GameCube),
[libdragon](https://github.com/DragonMinded/libdragon) (N64) e
[pvsneslib](https://github.com/alekmaul/pvsneslib) (SNES), tutti installabili
gratuitamente via [devkitPro](https://github.com/devkitPro/pacman).

Progetto indipendente, non ufficiale, non affiliato né approvato da Nintendo.

## Nota onesta sullo stato v1.1 → v1.2

La v1.0 fingeva sempre un compile "riuscito": se il toolchain reale non era
installato, generava un file di 16KB quasi vuoto con solo un header magico,
accompagnato da log fabbricati che non corrispondevano a nessuna vera
compilazione. La v1.1 ha corretto questo: rilevamento reale del toolchain,
compilazione reale col compilatore reale se presente, mai un fallback
fittizio. A quel punto però il link reale per Switch falliva sempre con un
errore del linker (`read-only segment has dynamic relocations`), riportato
onestamente (`packaged:false`) invece di essere nascosto.

**La v1.2 ha investigato e risolto per davvero questo problema di link**, e
aggiunge due funzionalità concrete in più. Ecco cosa è stato fatto,
verificato con compilazioni e link reali sul toolchain devkitPro
effettivamente installato su questa macchina (non solo lettura di codice).

### 1. Fix reale del link Switch (`read-only segment has dynamic relocations`)

**Ricerca**: confrontato il nostro comando di link con il Makefile ufficiale
devkitPro (`$DEVKITPRO/examples/switch/templates/application/Makefile`,
presente su questa macchina dove devkitPro è installato) e con
`switch_rules`/`base_rules` reali. I flag di compilazione erano corretti
(`-march=armv8-a... -fPIE`), eppure il link falliva comunque.

**Causa reale identificata**: è una regressione nota di `ld` (binutils) più
recenti, che applicano il vincolo "niente rilocazioni di testo in segmenti
read-only" (`-z text`, implicito nello `switch.specs` di devkitPro) in modo
più rigido di quanto il toolchain devkitPro storicamente si aspettasse. Lo
stesso errore, con lo stesso identico messaggio, è documentato per altri
progetti (vedi [devkitpro.org/viewtopic.php?t=9110](https://devkitpro.org/viewtopic.php?t=9110),
oltre a bug analoghi su bugzilla Mozilla/RedHat per lo stesso messaggio ld su
altre toolchain). Non era quindi un errore nei nostri flag.

**Fix applicato e verificato**: aggiunta `-Wl,-z,notext` al comando di link
Switch in `src/compiler_pipeline.ts`. Verificato per davvero:
- compilazione reale del sorgente fornito con `aarch64-none-elf-gcc`
- link reale contro `libnx` (`switch.specs`) → **ora riesce**
- packaging reale con `elf2nro` reale → produce un `.nro` con l'header
  magico corretto `HOMEBREW` + `NRO0` (verificato leggendo i byte grezzi
  del file prodotto dalla vera API `/api/build`, non solo l'exit code)

**Bug collaterale trovato e corretto**: `elf2nro`/`elf2dol` vivono sotto
`$DEVKITPRO/tools/bin`, che non è quasi mai sul `PATH` di default — il
codice precedente li cercava solo con `which`, quindi segnalava
erroneamente "tool non installato" anche quando in realtà lo era (verificato
su questa macchina: `which elf2nro` falliva pur essendo il binario presente
su disco). Ora `findPackagingTool()` controlla prima il percorso standard
devkitPro, poi il `PATH`.

### 2. Stato toolchain reale per piattaforma (`GET /api/toolchains`)

Nuovo endpoint e pannello in UI che mostrano, piattaforma per piattaforma,
se il compilatore reale è installato ORA su questa macchina, con il percorso
reale. Verificato dal vivo: Switch e Wii/GameCube risultano installati (con
percorso reale sotto `/opt/devkitpro`), N64 e SNES no.

### 3. Scaffold di progetto reale (`GET /api/scaffold?platform=...`)

Uno studio browser-based compila un solo file sorgente alla volta: comodo
per prototipare, ma un vero progetto homebrew multi-file richiede il vero
sistema di build a Makefile di devkitPro (dipendenze incrementali, risorse,
icone, `.nacp`, ecc). Questo studio non finge di sostituirlo.

Il nuovo comando "Genera Progetto Makefile Reale" genera e fa scaricare un
`Makefile` + `source/main.c` **reali**, identici (a parte il nome target) ai
template ufficiali presenti su questa macchina in
`$DEVKITPRO/examples/<piattaforma>/templates/application`, per Switch, Wii e
GameCube. Per N64 e SNES, che non hanno un template devkitPro (usano
rispettivamente libdragon e pvsneslib con i propri sistemi di build),
l'endpoint risponde onestamente con un errore che indirizza al vero
strumento di scaffolding di quelle SDK, invece di inventare un Makefile.

**Verificato per davvero**: lo scaffold Switch generato è stato scritto su
disco e compilato con `make` reale (devkitA64 + libnx installati), producendo
un `.nro` reale e valido — confermato che il vero Makefile ufficiale, con il
vero `main.c` d'esempio, linka senza bisogno del fix `-z,notext` (il problema
di relocation si presenta con il codice generato dall'astrazione
`nintendo_hal.h` di questo studio, non con il toolchain devkitPro in sé — per
questo il fix è stato applicato al percorso di compilazione di questo
studio, senza toccare `nintendo_hal.h`, che restava già corretto).

## Cosa funziona oggi, verificato dal vivo su questa macchina

| Piattaforma | Compilazione reale | Link reale | Packaging finale reale |
|---|---|---|---|
| Switch (devkitA64) | ✓ | ✓ (fix `-Wl,-z,notext`) | ✓ `.nro` reale con header `NRO0` valido |
| Wii/GameCube (devkitPPC) | ✓ | non ancora automatizzato nella pipeline one-shot | ✗ (ma lo scaffold Makefile reale sì, via `make`) |
| N64 | non installato su questa macchina | — | — |
| SNES (WLA-DX) | non installato su questa macchina | — | — |

### 4. Patcher di ROM reale (IPS/BPS) con dichiarazione d'uso onesta

Aggiunta la possibilità di applicare una patch di modding/traduzione fan
(formati **IPS** e **BPS**, gli standard reali usati dalla community di ROM
hacking — vedi [Floating IPS](https://github.com/Alcaro/Flips) e la
specifica "beat" di byuu) a una ROM fornita dall'utente dal proprio disco.
**Nessuna ROM viene mai scaricata, ospitata o distribuita da questo
strumento**: patch e ROM base sono entrambe fornite localmente dal client, i
byte risultanti vengono restituiti al client e mai salvati permanentemente
lato server.

**Nota onesta sulla "certificazione"**: non esiste alcun modo tecnico per uno
strumento locale di verificare se un utente possiede davvero una copia
autentica del gioco — nessuna API, nessun database, nessun controllo
possibile. Definirlo "certificato" sarebbe fabbricare una garanzia
inesistente, lo stesso tipo di claim già rimosso da altri progetti di questo
autore. Quello che è stato implementato realmente è un **gate di
dichiarazione**: l'utente deve ridigitare o incollare per intero (non
spuntare una semplice checkbox) un testo di dichiarazione di responsabilità,
che viene registrato su disco (`data/rom_patch_declarations.jsonl`, mai
committato — vedi `.gitignore`) con nome, timestamp reale e testo esatto, e
firmato con un token HMAC-SHA256 reale e verificabile richiesto per ogni
applicazione di patch. Prova solo che il passaggio è stato completato, non
la proprietà legale del gioco.

**Formati implementati e verificati**:
- **IPS**: header `PATCH`, record `offset(3B)+size(2B)+dati`, record RLE
  (`size=0` → run-length+valore), record di troncamento finale opzionale.
  Testato con patch reali costruite a mano: sostituzione byte puntuale e RLE,
  entrambe verificate byte-per-byte sull'output.
- **BPS**: header `BPS1`, interi a lunghezza variabile, 4 modalità di azione
  (SourceRead/TargetRead/SourceCopy/TargetCopy) e **verifica CRC32 reale**
  dei checksum sorgente/destinazione dichiarati nella patch contro quelli
  calcolati sui byte reali — se la ROM fornita non è quella corretta per la
  patch, `sourceCrcMatched:false` lo segnala esplicitamente invece di
  produrre silenziosamente un output corrotto. Testato con un encoder BPS
  scritto per il solo scopo di verifica round-trip (spec-compliant), inclusi
  i casi SourceRead/TargetRead/TargetCopy(RLE) e il rilevamento di ROM
  sorgente sbagliata.
- CRC32 calcolato con un'implementazione reale del polinomio IEEE 802.3
  standard (tabella a 256 entry), non un placeholder.

**API**: `GET /api/patcher/declaration-text`, `POST /api/patcher/acknowledge`
(`{fullName, statement}` → token reale), `POST /api/patcher/apply`
(`{fullName, token, romBase64, patchBase64}` → richiede un token valido,
altrimenti `403` esplicito).

**Bug reale trovato e corretto durante la verifica**: il token generato
concatenava `declarationId.acceptedAt.signature` con `.` come separatore, ma
`acceptedAt` è un timestamp ISO che contiene già un punto (`...836Z`),
rompendo lo split lato verifica. Corretto usando `|` come separatore, e
riverificato l'intero flusso end-to-end via richieste HTTP reali dopo il fix.

### 5. Inspector header ROM N64 + editor level-script SM64 (sperimentale)

Due strumenti aggiuntivi, basati **solo su documentazione pubblica** della
community di reverse engineering, mai su analisi diretta di una ROM
specifica da parte di questo assistente durante lo sviluppo:

- **Inspector header ROM N64** (`src/n64_rom_header.ts`) — formato hardware
  **generico**, identico su qualunque ROM N64 (non specifico di un gioco):
  titolo, cartridge ID, regione, versione, boot address, CRC memorizzati.
  Offset incrociati da due fonti pubbliche indipendenti (ultra64.ca memory
  map + N64Brew Wiki). Testato con header sintetici costruiti a mano.
- **Decompressore/compressore MIO0** (`src/n64_mio0.ts`) — formato di
  compressione LZ77-style **generico** N64 (non specifico di SM64, usato da
  vari titoli dell'epoca). Testato con un vero round-trip
  compressione→decompressione su dati sintetici.
- **Editor level-script SM64** (`src/sm64_level_script.ts`, sperimentale) —
  parser/editor dei comandi di script di livello secondo il formato
  **pubblicamente documentato** dalla community (Hack64 Wiki, progetto di
  decompilazione open source n64decomp/sm64). Permette di modificare
  posizione/rotazione di oggetti piazzati (`PLACE_OBJECT`) e il punto di
  spawn di Mario (`SET_MARIO_START_POS`) su un segmento di byte che
  **l'utente estrae ed fornisce da sé** dalla propria ROM — questo server
  non apre, analizza o processa mai una ROM completa, solo il segmento di
  byte esplicitamente incollato/caricato dal client. Comandi con opcode non
  mappato in questo editor interrompono onestamente il parsing invece di
  disallinearsi silenziosamente. Testato con sequenze di comandi costruite a
  mano secondo la specifica pubblica (place-object, mario-spawn,
  end-of-script), incluso il rilevamento di opcode sconosciuti.

## Avvio

```bash
bun install
bun start
```

Apri `http://localhost:3014`. Se un toolchain non è installato, ogni
tentativo di compilazione per quella piattaforma risponde onestamente con le
istruzioni di installazione reali invece di un falso successo.

## API

- `POST /api/build` — `{ platform, sourceCode }` → compila/linka/pacchettizza
  con il toolchain reale, se presente.
- `GET /api/toolchains` — stato reale di rilevamento per tutte e 5 le
  piattaforme.
- `GET /api/scaffold?platform=switch|wii|gamecube|n64|snes` — Makefile +
  sorgente reali per iniziare un progetto vero col sistema di build standard
  (o un errore onesto per N64/SNES, che non hanno template devkitPro).
- `GET /api/patcher/declaration-text` — testo reale della dichiarazione richiesta.
- `POST /api/patcher/acknowledge` — `{ fullName, statement }` → registra la
  dichiarazione e ritorna un token HMAC reale.
- `POST /api/patcher/apply` — `{ fullName, token, romBase64, patchBase64 }` →
  applica realmente una patch IPS/BPS, richiede un token valido.
- `POST /api/n64/rom-header` — `{ bytesBase64 }` (primi 64 byte) → header
  ROM N64 reale interpretato.
- `POST /api/n64/mio0/decompress` / `POST /api/n64/mio0/compress` —
  `{ dataBase64 }` → (de)compressione MIO0 reale.
- `POST /api/sm64/levelscript/parse` — `{ bytesBase64 }` → comandi
  level-script reali interpretati.
- `POST /api/sm64/levelscript/serialize` — `{ commands }` → byte reali
  riserializzati dopo eventuali modifiche ai campi.

## Licenza
MIT.
