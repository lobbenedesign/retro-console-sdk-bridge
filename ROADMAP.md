# Roadmap Modding N64/SM64 — Ricerca risorse

> Verificato il 2026-08-26. Fonte iniziale: lista fornita dall'utente (generata da IA, verificata qui link per link tramite ricerca web reale — WebSearch/WebFetch, nessuna ROM aperta o processata).

## Documentazione tecnica formati

- **https://en.wikipedia.org/wiki/ROM_image** — Pagina generica su cosa sia un ROM image, dump, header/headerless. Utile come introduzione ma nessun dettaglio tecnico N64-specifico. Utilizzabile: sì, solo come riferimento didattico generale nei commenti/README del progetto.

- **https://n64brew.dev/wiki/ROM_Header** — Verificato e indicizzato correttamente (link della lista era già corretto). Documenta: i primi 0x40 byte sono l'"internal header" (il PIFROM dell'N64 legge solo fino a 0x18), tra 0x40 e 0x1000 c'è il bootstrap code (IPL3, quasi identico tra i giochi). Esiste anche un formato non ufficiale "Advanced Homebrew ROM Header" introdotto dalla flashcard EverDrive64 e adottato dalla community homebrew per dichiarare save-type e configurazione controller/pak nei campi header inutilizzati. Nota: il dominio spesso risponde 403 a fetch diretti da tool automatici, ma è indicizzato bene su motori di ricerca — usare WebSearch, non WebFetch diretto. Utilizzabile: sì, è la fonte primaria più affidabile per estendere il nostro parser header ROM N64 generico, incluso il supporto opzionale ai campi homebrew (savetype/controller) oltre ai campi standard già coperti.

- **https://n64brew.dev/wiki/Game_Pak** e **https://n64brew.dev/wiki/Controller_PAK/Filesystem** — Pagine correlate (Game Pak = la cartuccia fisica, Controller Pak = memory card). Utili se in futuro si vuole documentare anche il filesystem del Controller Pak (non necessario per il modulo attuale). Utilizzabile: solo come riferimento futuro, non prioritario.

- **problemkaputt.de/gbatek.htm — CORREZIONE IMPORTANTE**: GBATEK di Martin Korth copre **solo GBA, NDS, DSi e 3DS**. Non esiste e non è mai esistita una sezione N64 in GBATEK — verificato tramite l'indice ufficiale (gbatek-contents.htm) e ricerca mirata, nessun risultato per contenuti N64. La lista fornita dall'utente era imprecisa nel suggerire GBATEK come fonte per N64. Per la parte GBA del nostro eventuale supporto multi-console, GBATEK resta comunque la fonte tecnica più autorevole (header cartuccia GBA/NDS, memoria mappata, ecc.). Utilizzabile: sì, ma solo per GBA/NDS, non per N64.

- **https://github.com/decompals/n64-decomp-wiki — CORREZIONE**: questo repository/URL non risulta esistere sotto l'organizzazione `decompals` (verificato via ricerca diretta e su github.com/orgs/decompals/repositories, nessun risultato). La documentazione equivalente (formati compressione, ASM, convenzioni) è distribuita nei singoli repo di decompilazione (es. `n64decomp/sm64`, `zeldaret/oot`) sotto `docs/` e nei rispettivi wiki, oppure centralizzata su n64brew.dev/wiki. Utilizzabile: no — il link è da correggere, sostituire con i `docs/` dei singoli progetti di decompilazione o con n64brew.dev/wiki.

## Progetti di decompilazione (fonte di documentazione formato, MAI di asset)

Tutti i progetti sotto richiedono che l'utente fornisca **la propria** ROM originale legalmente posseduta per estrarre asset in locale (`baserom.<versione>.z64`) — il codice sorgente decompilato non contiene asset proprietari. Questo è coerente col nostro vincolo: possiamo studiare il *codice* di estrazione/parsing (che opera su byte forniti a runtime dal client) senza mai includere o processare noi stessi una ROM.

- **https://github.com/n64decomp/sm64** — Repo corretto (la lista suggeriva anche `github.com/mkst/sm64`, che invece è un fork/contributor personale, non il repo ufficiale — CORREZIONE). Decompilazione completa di Super Mario 64 per le versioni JP/US/EU/SH/CN. Licenza: il codice ricostruito è pubblicato con licenza permissiva dagli autori (verificare il file LICENSE del repo per la versione corrente); gli asset non sono inclusi. Utile per capire la struttura reale dei level-script/behavior data che il nostro editor Hack64-style già modella.

- **https://github.com/zeldaret/oot** — Repo attivo e corretto. Il vecchio `n64decomp/oot` è deprecato e rimanda esplicitamente a questo. Decompilazione di Ocarina of Time. Utilizzabile come riferimento di struttura dati generica N64 (non prioritario per SM64).

- **https://github.com/zeldaret/mm** — Repo attivo e corretto (il vecchio `n64decomp/majora` è deprecato e rimanda qui). Include una cartella `docs/tutorial/` con guide didattiche su decomp e object/actor. Utile come esempio di documentazione ben strutturata da imitare per il nostro progetto.

- **https://github.com/n64decomp/mk64** — Repo corretto per Mario Kart 64 (build USA + EUR 1.0/1.1). Non serve direttamente al modulo SM64, ma conferma il pattern comune ai decomp N64.

- **Paper Mario 64 — CORREZIONE**: la lista citava genericamente "PaperMario64/papermario64", nome non corretto. Il progetto reale è **https://github.com/pmret/papermario** (organizzazione "Paper Mario Reverse-Engineering Team", pmret), versione US completa al 100%.

- **Banjo-Kazooie — CORREZIONE**: la lista citava `decompals/banjo-kazooie`, ma il repo reale è **https://github.com/n64decomp/banjo-kazooie** (mirror del repo primario su GitLab, `gitlab.com/banjo.decomp/banjo-kazooie`). `decompals` è l'organizzazione che ospita *strumenti* di decompilazione condivisi (linker script generator, librerie), non i singoli giochi.

- **Perfect Dark — CORREZIONE**: stesso pattern, repo reale **https://github.com/n64decomp/perfect_dark** (mirror di `gitlab.com/ryandwyer/perfect-dark`), non `decompals/perfect-dark`. Le versioni ntsc-1.0 e ntsc-final risultano completamente decompilate.

- **Super Mario World (SNES) — CORREZIONE**: `Ersanio/smw-decomp` non risulta esistere. Alternative reali trovate: **https://github.com/snesrev/smw** (decomp/reimplementazione), disassembly storico **https://github.com/galaxyhaxz/smw-src**, e SMWDisX (`Dotsarecool/SMWDisX`, disassembly commentato). Nessuna di queste è di Ersanio (community figure nota per tool SMW ma non risulta autore di questo specifico repo).

- **A Link to the Past (SNES) — CORREZIONE**: `alttpo/alttpo` esiste ma è un progetto di *netplay/randomizer online* (ALttP Online), non una decompilazione. La vera decompilazione/reimplementazione è **https://github.com/snesrev/zelda3** (~70-80k righe C, reimplementa l'intero gioco). Per disassembly puro: `camthesaxman/zeldaalttp`.

- **https://github.com/pret/pokered** — Confermato corretto. Disassembly di Pokémon Red/Blue, organizzazione `pret` mantiene anche pokecrystal, pokeemerald, pokefirered ecc. Non rilevante per N64 ma utile come pattern di riferimento community.

- **decompals/sms e decompals/smg — CORREZIONE doppia**: nessuno dei due esiste sotto `decompals`. La decompilazione di Super Mario Sunshine (GameCube) è **https://github.com/doldecomp/sms** (organizzazione `doldecomp` = "GameCube/Wii Decompilation", non `decompals`). Super Mario Galaxy ha due progetti paralleli: **https://github.com/SMGCommunity/Petari** (SMG1) e **https://github.com/SMGCommunity/Garigari** (SMG2), oltre a **https://github.com/doldecomp/smg**. `decompals` resta un'organizzazione di *tooling* condiviso (es. `slinky`, `crunch64` — implementazione Rust di formati di compressione N64 comuni, potenzialmente interessante in futuro per MIO0/Yay0).

## Tool esistenti di riferimento

### Editor esadecimali generici
- **HxD** — https://mh-nexus.de/en/hxd/ — Confermato, freeware Windows, editor esadecimale/disco/memoria di Maël Hörz. Nessuna funzione N64-specifica ma utile come editor generico consigliabile agli utenti finali.
- **010 Editor** — https://www.sweetscape.com/ — Confermato, commerciale (Windows/Linux/macOS), supporta "Binary Templates" scriptabili per parsing strutturato di formati binari (utile per prototipare rapidamente un template MIO0/ROM header prima di portarlo nel nostro codice Dart).

### Tool N64 specifici
- **sm64tools** — https://github.com/queueRAM/sm64tools — Confermato, licenza MIT. Contiene `n64split` (disassembler/estrattore asset), `sm64extend`/`sm64compress` (gestione blocchi MIO0 e checksum), `n64graphics` (conversione PNG↔texture N64 RGBA/IA). Il README non documenta in dettaglio il layout header MIO0 in prosa, ma il codice sorgente (`n64graphics.c`) è leggibile e utilizzabile come riferimento per validare la nostra implementazione del codec MIO0 già scritta — senza copiare codice, solo per cross-check comportamentale.
- **Texture64** — https://github.com/queueRAM/Texture64 — Confermato, tool C#/.NET reale di ripping ed editing texture N64. Vedi sezione dedicata sotto per i bit-layout estratti da `Texture64/N64Graphics.cs`.
- **Fast64** — https://github.com/Fast-64/fast64 — Confermato, addon Blender per esportare display list F3D e asset verso i progetti decomp SM64/OoT; esiste anche un fork/downstream `HarbourMasters/fast64`. Fuori scope diretto (è un tool di authoring 3D, non un parser/editor testuale), ma utile riferimento se in futuro si aggiunge supporto a modelli/texture.
- **n64tex (mikeryan) — CORREZIONE**: non risulta esistere come repository. L'utente `mikeryan` su GitHub ha invece `n64dev` (raccolta storica di documentazione/tool N64 open source, inclusa una sotto-cartella `util/n64tools`) e `UltraCIC`. Il nome "n64tex" sembra una confusione/invenzione: il tool texture di riferimento reale è Texture64 (sopra), non un progetto di mikeryan.
- **n64crc (parasyte) — CORREZIONE**: non risulta esistere come repository di `parasyte`. `parasyte` ha invece `n64rd` (Remote Debugger) e altre librerie N64. Il riferimento storico per il checksum N64 è la pagina `n64dev.org/n64crc.html` (documentazione, non repo) e implementazioni moderne come `github.com/Dragorn421/n64checksum` (trovata durante la ricerca, non nella lista originale, ma verificata e reale: implementa l'algoritmo di checksum del ROM header N64 con note di ricerca).
- **Mupen64Plus** — https://github.com/mupen64plus (org) / mupen64plus.org — Confermato, emulatore N64 open source multipiattaforma. Non un tool di editing ma utile per testing manuale di ROM modificate dall'utente.
- **Project64 — CORREZIONE**: `pj64-ng.com` NON è il sito ufficiale (non esiste/non è associato al progetto). Il sito ufficiale reale è **https://project64.org/** (in passato ospitato anche su pj64-emu.com). Project64 è closed-source/freeware, non open source come Mupen64Plus.
- **decompals** (organizzazione GitHub) — https://github.com/decompals — Confermata come organizzazione reale di infrastruttura/tooling condiviso tra i progetti decomp N64/GC/Wii (es. `slinky` per linker script, `crunch64` per formati di compressione), non contiene i singoli giochi.

### Tool altre console
- **Lunar Magic** — https://fusoya.eludevisibility.org/lm/ — Confermato, editor livelli per Super Mario World (SNES) di FuSoYa, freeware Windows, ultima versione 3.6x. Fuori scope N64 ma riferimento storico per level-editor retro.
- **Tiled** — https://www.mapeditor.org/ (repo: https://github.com/mapeditor/tiled) — Confermato, editor mappe tile-based generico, formato TMX aperto, estendibile via plugin/JavaScript. Potenzialmente riusabile in futuro come ispirazione UX per un editor di livelli generico, non per parsing N64 diretto.
- **GBTD — CORREZIONE**: non esiste un repository "ShyGuyX/GBTD" su GitHub. GBTD (Game Boy Tile Designer) è un tool storico freeware di Harry Mulder, documentato su https://www.devrs.com/gb/hmgd/gbtd.html; non risulta un port ufficiale open source con quel nome utente. Fuori scope (Game Boy, non N64/SNES/GC/Wii come da focus del progetto).
- **AdvanceMap** — Confermato come tool reale (Windows) per editing mappe nei giochi Pokémon GBA, distribuito storicamente su romhacking.net (https://www.romhacking.net/utilities/908). Fuori scope diretto del modulo N64/SM64 attuale.
- **Dolphin Emulator** — https://github.com/dolphin-emu/dolphin / dolphin-emu.org — Confermato, emulatore GameCube/Wii open source. Wiki dedicata ai formati file non pienamente esplorabile via ricerca automatica in questa sessione (contenuti dietro rendering JS/wiki interna); i formati principali noti restano GCM/ISO, WBFS, RVZ (compressione consigliata), WAD, DOL/ELF, TGC — utile riferimento se il progetto estenderà il supporto a GC/Wii.

### Altri tool generici (compressione/patching)
- **xDelta3** — https://github.com/jmacd/xdelta — Confermato. Libreria/tool C per compressione differenziale binaria (VCDIFF/RFC 3284). Esiste anche un branch GPL separato `jmacd/xdelta-gpl`. Utile riferimento concettuale per un futuro "diff patcher" che operi solo su byte forniti dal client (mai su ROM ospitate da noi).
- **Formati IPS/UPS** — Confermato che romhacking.net offre "Rom Patcher JS" (supporta IPS, BPS, UPS, APS, RUP, PPF, xdelta) e utility storiche come Lunar IPS/Tsukuyomi UPS. UPS è nato come successore di IPS per aggiungere validazione tramite checksum del file originale. Utilizzabile: sì in linea di principio come formato di distribuzione patch (il patch stesso non contiene la ROM, solo un diff) — ma resta un'area grigia rispetto al nostro vincolo se il "file originale" implicito è una ROM commerciale; da trattare con cautela e solo come formato-contenitore generico, mai generando/ospitando patch legate a una ROM specifica.

## Community

- **romhacking.net** — Confermato esistente e attivo, il principale portale di utility/documenti/traduzioni per ROM hacking. Utile per link a tool e documentazione storica.
- **n64brew.dev/forum** — Non verificato direttamente in questa sessione (solo la wiki è stata controllata), ma il dominio n64brew.dev è confermato attivo e centrale per la community homebrew N64 moderna.
- **decomp.me** — Confermato, https://decomp.me/ (repo https://github.com/decompme/decomp.me), piattaforma collaborativa per il matching decompilation (scrivere codice sorgente che compili identico all'assembly originale). Ha un Discord associato (non verificato il link diretto, citato nella FAQ del sito). Utile come riferimento metodologico, non serve integrazione diretta.
- **gbatemp.net** — Confermato, grande community generalista su emulazione/homebrew/modding.
- **forum.xentax.com (XeNTaX)** — Confermato attivo, forum storico di riferimento per reverse engineering di formati file (es. sezione "Graphic file formats").
- **zenhax.com (ZenHAX)** — Confermato, forum imparentato/derivato dalla community XeNTaX, focalizzato su game hacking/reversing.

## Formati texture N64 (per estendere il progetto)

Estratti da **github.com/queueRAM/Texture64/blob/master/Texture64/N64Graphics.cs** (fetch diretto riuscito, codice C# reale e leggibile):

| Formato | Bit/pixel | Estrazione canali |
|---|---|---|
| **RGBA16** | 16 (2 byte) | R = `(c0 & 0xF8) >> 3` (5 bit, scalati a 8 bit); G = `((c0 & 0x07) << 2) \| ((c1 & 0xC0) >> 6)` (5 bit); B = `(c1 & 0x3E) >> 1` (5 bit); A = `c1 & 0x1` (1 bit → 0 o 255) |
| **RGBA32** | 32 (4 byte) | R, G, B, A ciascuno un byte pieno, in sequenza, nessuna decodifica bit-level |
| **IA16** | 16 (2 byte) | Intensità = byte 0 (usato per R=G=B); Alpha = byte 1, entrambi a piena risoluzione 8 bit |
| **IA8** | 8 (1 byte) | Intensità = nibble alto × 0x11; Alpha = nibble basso × 0x11 (espansione 4→8 bit per replicazione) |
| **IA4** | 4 (2 pixel/byte) | 3 bit intensità (scalati con `SCALE_3_8`) + 1 bit alpha (0x00/0xFF) |
| **I8** | 8 (1 byte) | Intensità = byte pieno, R=G=B=intensità, alpha dipende da un parametro di modalità (`N64IMode`) |
| **I4** | 4 (2 pixel/byte) | Intensità a 4 bit × 0x11, R=G=B=intensità, alpha configurabile |
| **CI4** | 4 (2 pixel/byte, indicizzato) | Indice a 4 bit → palette di 16 entry, ogni entry 2 byte in formato RGBA16; offset palette = `2 × indice` |
| **CI8** | 8 (1 byte, indicizzato) | Indice a 8 bit → palette di 256 entry, ogni entry 2 byte RGBA16; offset palette = `2 × indice` |

**Ordine nibble per formati 4-bit (IA4/I4/CI4):** selezione del nibble tramite `select = pixOffset & 0x1`; lo shift applicato è `(1 - nibble) * 4` — cioè il pixel a offset pari usa il nibble alto del byte, quello dispari il nibble basso (ordine big-endian a livello di nibble, coerente con l'endianness big-endian nativa dell'N64).

Questo è materiale direttamente riusabile: la logica di estrazione canali sopra è sufficientemente semplice (poche righe di bit-shifting per formato) da poter essere **reimplementata da zero in Dart** nel nostro progetto senza mai copiare il codice C# originale, rispettando sia il vincolo "mai processare ROM reali" (opera solo su byte texture forniti a runtime dal client, non su un file ROM intero) sia l'attribuzione concettuale alla documentazione pubblica del formato N64 (che è dominio pubblico/reverse-engineered, non codice proprietario Nintendo).

## Cosa integrare nel nostro progetto (retro-console-sdk-bridge), in ordine di priorità

1. **Texture viewer/decoder N64 generico** — implementare in Dart i decoder per RGBA16, RGBA32, IA16, IA8, IA4, I8, I4, CI4, CI8 usando le formule sopra (bit-shift puri, nessuna dipendenza da asset). Input: bytes forniti a runtime dal client (utente carica la propria texture estratta), output: bitmap RGBA per preview. Rispetta pienamente il vincolo — non serve mai una ROM intera, solo un blob di byte texture.
2. **Estendere il parser header ROM N64** con supporto opzionale ai campi "Advanced Homebrew ROM Header" (savetype, controller config) documentati da n64brew.dev/wiki/ROM_Header, così da riconoscere anche header di ROM homebrew moderne oltre a quelle commerciali standard.
3. **Cross-check del codec MIO0** contro il comportamento di `sm64tools`/`n64graphics.c` (solo lettura del codice pubblico per validare la logica, senza copiarlo) per assicurare compatibilità byte-per-byte con l'implementazione esistente nel nostro progetto.
4. **Valutare in futuro un modulo Yay0/crunch64-style** (formati di compressione N64 imparentati a MIO0) ispirandosi a `decompals/crunch64` (implementazione Rust) se il progetto vorrà supportare più giochi oltre SM64.
5. **Non prioritario**: supporto GameCube/Wii (doldecomp, Dolphin file formats) o SNES/GBA (snesrev/zelda3, pret/pokered, AdvanceMap) — utili solo se il progetto deciderà di espandersi oltre N64/SM64; al momento sono riferimenti di contesto, non lavoro da fare subito.

## Correzioni ai link originali (dove la lista fornita era imprecisa/sbagliata)

1. **GBATEK non copre N64** — la sezione "N64" citata nella lista non esiste; GBATEK tratta solo GBA/NDS/DSi/3DS.
2. **`github.com/decompals/n64-decomp-wiki` non esiste** — nessun repository con questo nome trovato sotto l'organizzazione `decompals`.
3. **Super Mario 64 decomp**: repo ufficiale è `n64decomp/sm64`, non `mkst/sm64` (mkst è un contributor/autore di fork correlati, non il repo principale).
4. **Banjo-Kazooie**: repo reale è `n64decomp/banjo-kazooie` (mirror di GitLab), non `decompals/banjo-kazooie` — `decompals` ospita solo tooling condiviso, non i singoli giochi.
5. **Perfect Dark**: repo reale è `n64decomp/perfect_dark` (mirror di GitLab), non `decompals/perfect-dark`, stesso errore di attribuzione all'organizzazione sbagliata.
6. **Paper Mario 64**: nome corretto del repo è `pmret/papermario`, non "PaperMario64/papermario64" (organizzazione inventata).
7. **Super Mario World decomp**: `Ersanio/smw-decomp` non esiste; alternative reali sono `snesrev/smw` e `galaxyhaxz/smw-src`.
8. **A Link to the Past decomp**: `alttpo/alttpo` è un progetto di netplay online, non una decompilazione; la vera reimplementazione è `snesrev/zelda3`.
9. **Sonic/SMS e Super Mario Galaxy decomp**: non esistono sotto `decompals`; Super Mario Sunshine è in `doldecomp/sms`, Super Mario Galaxy in `SMGCommunity/Petari` (SMG1) e `SMGCommunity/Garigari` (SMG2) / `doldecomp/smg`.
10. **Project64**: il sito ufficiale è `project64.org`, non `pj64-ng.com` (dominio inesistente/non associato).
11. **n64tex (mikeryan)**: repository inesistente; l'autore ha invece `n64dev` (raccolta storica) — "n64tex" sembra un nome inventato o confuso con Texture64.
12. **n64crc (parasyte)**: repository inesistente sotto questo utente; il riferimento storico reale per il checksum N64 è la pagina n64dev.org, non un repo GitHub di parasyte.
13. **GBTD (ShyGuyX)**: repository inesistente; GBTD è un tool storico di Harry Mulder senza port ufficiale con questo nome utente.

## Nota fuori scope

Durante la verifica della struttura del progetto (solo `ls` della directory, nessuna apertura file) è stato notato un file `Super Mario 64.zip` (~6 MB) nella root del repository `retro-console-sdk-bridge`. Non è stato aperto né ispezionato per rispettare il vincolo del task ("nessuna apertura di file ROM"), ma si segnala perché il nome del file è potenzialmente in conflitto con la policy dichiarata dal progetto stesso ("mai processare/ospitare/distribuire una ROM reale"). Si raccomanda una verifica manuale da parte dell'utente sul contenuto reale di questo file e, se necessario, la sua rimozione dal repository e/o dal tracking git.
