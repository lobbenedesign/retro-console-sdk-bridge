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
import { parseSnesRomHeader, writeSnesRomHeader } from "./src/snes_rom_header";
import { serializeF3dVertices, buildF3dDisplayList } from "./src/n64_f3d";
import { identifyRomFile, identifyConsole } from "./src/rom_identify";
import { unzip } from "./src/zip_reader";
import { DASHBOARD_HTML } from "./src/dashboard_html";
import { parseGenesisRomHeader, fixGenesisChecksum, writeGenesisRomHeader } from "./src/genesis_rom_header";
import { detectExtraToolchains, scaffoldExtra } from "./src/segasony_scaffold";
import { openSectorReader, isCso } from "./src/psp_cso";
import { listIsoFiles, extractIsoFile } from "./src/psp_iso";
import { decodeGim } from "./src/psp_gim";
import { parseGbaRomHeader, fixGbaComplement } from "./src/gba_rom_header";
import { kosinskiDecompress, kosinskiCompress } from "./src/md_kosinski";
import { nemesisDecompress, nemesisCompressOptimal } from "./src/md_nemesis";
import { encodeN64Texture } from "./src/n64_texture_encode";
import { listGdiFiles, extractGdiFile } from "./src/dc_gdi";
import { rebuildPspImage, rebuildDcGdi } from "./src/image_rebuild";
import { encodeGim, type GimFormat } from "./src/psp_gim_encode";
import { parseLevelScript, serializeLevelScript, EDITABLE_COMMAND_NAMES, type LevelCommand } from "./src/sm64_level_script";
import { parseN64RomHeader, writeN64RomHeader } from "./src/n64_rom_header";
import { decodeN64Texture, requiredByteLength, BITS_PER_PIXEL, type N64TextureFormat } from "./src/n64_texture";
import { ChdFile, isChd } from "./src/chd";
import { join } from "path";
import { existsSync, writeFileSync } from "fs";

const PORT = Number(process.env.PORT) || 3014;
const pipeline = new CompilerPipeline();

// Estrae solo i file sorgente/header rilevanti (.c/.cpp/.cc/.s/.h/.hpp) da
// uno ZIP multi-file caricato dal client, riusando lo stesso unzip reale già
// usato per identificare ROM in archivio — nessun secondo parser inventato.
function sourceFilesFromZip(zipBytes: Uint8Array): Record<string, string> {
  const entries = unzip(zipBytes);
  const out: Record<string, string> = {};
  const decoder = new TextDecoder();
  for (const e of entries) {
    if (e.name.endsWith("/")) continue; // voce directory, nessun dato da compilare
    if (!/\.(c|cpp|cc|s|h|hpp)$/i.test(e.name)) continue;
    out[e.name] = decoder.decode(e.data);
  }
  return out;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    // Endpoint WebSocket per il progresso di build in tempo reale (vedi
    // sotto, sezione `websocket:`): niente più schermo nero fino al log
    // finale in blocco unico, ogni fase reale (compile/link/package) di
    // ogni file arriva al client non appena accade davvero. Nota: Bun ha un
    // WebSocket server NATIVO (Bun.serve({websocket})), quindi qui non
    // serve affatto la dipendenza npm "ws" installata (quella è un client
    // WebSocket per Node, non un server — su Bun è ridondante). Rimossa da
    // package.json invece di tenerla installata e mai importata.
    if (url.pathname === "/ws/build") {
      const requestOrigin = req.headers.get("Origin");
      const selfOriginWs = `${url.protocol}//${url.host}`;
      if (requestOrigin && requestOrigin !== selfOriginWs) {
        return new Response("Origin non consentita.", { status: 403 });
      }
      if (srv.upgrade(req)) return undefined as unknown as Response;
      return new Response("Upgrade WebSocket fallito.", { status: 400 });
    }

    // CORS ristretto alla stessa origine del dashboard, non un wildcard "*".
    // Il dashboard è servito da questo stesso server (GET /), quindi le sue
    // richieste sono same-origin e non hanno mai bisogno di header CORS. Un
    // wildcard qui significava che QUALSIASI sito web aperto in un'altra
    // scheda del browser, mentre questo server gira in locale, poteva
    // chiamare /api/build (compilazione reale di C fornito dal chiamante
    // tramite un vero compilatore) o gli endpoint del patcher ROM in
    // background, a insaputa dell'utente — un attacco CSRF/DNS-rebinding
    // contro un tool locale, non ipotetico dato che qui si esegue un vero
    // toolchain di compilazione. Ristretto all'origine reale del server.
    const selfOrigin = `${url.protocol}//${url.host}`;
    const requestOrigin = req.headers.get("Origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (requestOrigin && requestOrigin === selfOrigin) {
      headers["Access-Control-Allow-Origin"] = requestOrigin;
    }

    if (req.method === "OPTIONS") return new Response(null, { headers });

    // 1. Serve UI Dashboard
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(DASHBOARD_HTML, { headers: { "Content-Type": "text/html" } });
    }

    // 2. Build API — accetta tre modalità reali: singolo file inline
    // (sourceCode, sempre esistita), multi-file esplicito (sourceFiles:
    // {nomefile: contenuto}), o uno ZIP di sorgenti (zipBase64, sbustato
    // realmente con lo stesso lettore ZIP già usato per identificare le
    // ROM — nessun secondo parser inventato per questo caso d'uso).
    if (url.pathname === "/api/build" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const sourceFiles = body.zipBase64
          ? sourceFilesFromZip(new Uint8Array(Buffer.from(body.zipBase64, "base64")))
          : body.sourceFiles;
        const result = await pipeline.compile({
          platform: body.platform,
          sourceCode: body.sourceCode,
          sourceFiles
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
    // Piattaforme extra (genesis/dreamcast/psp): scaffold reale dei rispettivi
    // SDK (SGDK/KOS/PSPSDK) — senza compilazione, dichiarato onestamente.
    if (url.pathname === "/api/scaffold" && req.method === "GET") {
      const platform = url.searchParams.get("platform") as any;
      if (platform === "genesis" || platform === "dreamcast" || platform === "psp") {
        return new Response(JSON.stringify(scaffoldExtra(platform)), { headers });
      }
      const result = pipeline.scaffoldProject(platform);
      return new Response(JSON.stringify(result), { headers });
    }

    // 4b. Toolchain status per le piattaforme extra (SGDK/KOS/pspdev):
    // rilevamento reale, "non installato" onesto con istruzioni vere.
    if (url.pathname === "/api/toolchains/extra" && req.method === "GET") {
      return new Response(JSON.stringify(detectExtraToolchains()), { headers });
    }

    // 4e. PSP — filesystem dell'immagine (ISO o CSO trasparente): elenco
    // reale dei file del disco. Nota onesta: l'immagine arriva in base64
    // dal client (nessuna persistenza server): praticabile fino a ~1GB.
    if (url.pathname === "/api/psp/fs/list" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const image = new Uint8Array(Buffer.from(body.imageBase64 || "", "base64"));
        // un CSO compresso è per definizione PIÙ CORTO dell'ISO decompressa:
        // il limite minimo ha senso solo per ISO nude (bug reale corretto:
        // la prima versione rifiutava CSO piccoli ma perfettamente validi)
        if (!isCso(image) && image.length < 17 * 2048) {
          return new Response(JSON.stringify({ error: "Immagine troppo corta per un ISO9660 (min LBA 16 + PVD)." }), { status: 400, headers });
        }
        const reader = openSectorReader(image);
        const listing = listIsoFiles(reader);
        return new Response(JSON.stringify({
          format: image[0] === 0x43 && image[1] === 0x49 ? "CSO" : "ISO",
          systemId: listing.systemId,
          volumeId: listing.volumeId,
          isLikelyPsp: listing.isLikelyPsp,
          totalSectors: reader.numSectors(),
          entries: listing.entries.slice(0, 500).map((e) => ({
            path: e.path, isDir: e.isDir, size: e.size,
            lba: e.isDir ? undefined : e.lba,
          })),
          entryCount: listing.entries.length,
          truncated: listing.entries.length > 500,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4f. PSP — estrazione reale di un file dall'immagine per percorso.
    if (url.pathname === "/api/psp/fs/extract" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const image = new Uint8Array(Buffer.from(body.imageBase64 || "", "base64"));
        const reader = openSectorReader(image);
        const listing = listIsoFiles(reader);
        const file = extractIsoFile(reader, listing.entries, body.path || "");
        return new Response(JSON.stringify({
          path: body.path,
          size: file.length,
          fileBase64: Buffer.from(file).toString("base64"),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4k. Mega Drive — codec Kosinski (layout livelli Sega/Sonic):
    // decompressione e ricompressione reale con round-trip verificato.
    if (url.pathname === "/api/md/kosinski/decompress" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        if (data.length === 0) return new Response(JSON.stringify({ error: "dataBase64 vuoto." }), { status: 400, headers });
        const out = kosinskiDecompress(data);
        return new Response(JSON.stringify({ decompressedBase64: Buffer.from(out).toString("base64"), decompressedSize: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }
    if (url.pathname === "/api/md/kosinski/compress" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        if (data.length === 0) return new Response(JSON.stringify({ error: "dataBase64 vuoto." }), { status: 400, headers });
        const out = kosinskiCompress(data);
        return new Response(JSON.stringify({ compressedBase64: Buffer.from(out).toString("base64"), compressedSize: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    if (url.pathname === "/api/md/nemesis/compress" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        if (data.length === 0) return new Response(JSON.stringify({ error: "dataBase64 vuoto." }), { status: 400, headers });
        const out = nemesisCompressOptimal(data); // Huffman con fallback a lunghezza fissa
        return new Response(JSON.stringify({ compressedBase64: Buffer.from(out).toString("base64"), compressedSize: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4q. PSP — encoder texture GIM (inverse del decoder; P4/P8 con palette
    // esatta: oltre 16/256 colori → errore onesto).
    if (url.pathname === "/api/psp/gim/encode" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const width = Number(body.width), height = Number(body.height);
        const format = (body.format || "RGBA8888") as GimFormat;
        if (!width || !height) return new Response(JSON.stringify({ error: "width e height richieste." }), { status: 400, headers });
        const rgba = new Uint8Array(Buffer.from(body.rgbaBase64 || "", "base64"));
        const enc = encodeGim(rgba, width, height, format);
        return new Response(JSON.stringify({
          gimBase64: Buffer.from(enc.gim).toString("base64"),
          gimSize: enc.gim.length,
          format: enc.format,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4o. Rebuild immagine PSP (ISO, opzionale CSO): il client manda
    // l'immagine originale + i file modificati; il server rilegge tutto in
    // memoria, sostituisce e ricostruisce. Dietro gate di dichiarazione.
    if (url.pathname === "/api/psp/iso/build" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const image = new Uint8Array(Buffer.from(body.imageBase64 || "", "base64"));
        const replacements = (body.replacements || []).map((r: any) => ({
          name: String(r.name || ""),
          data: new Uint8Array(Buffer.from(r.fileBase64 || "", "base64")),
        })).filter((r: any) => r.name && r.data.length > 0);
        if (replacements.length === 0) return new Response(JSON.stringify({ error: "Nessun file di sostituzione fornito." }), { status: 400, headers });
        const r = rebuildPspImage(image, replacements, !!body.alsoCso);
        return new Response(JSON.stringify({
          applied: r.applied,
          unmatched: r.unmatched,
          isoBase64: Buffer.from(r.iso).toString("base64"),
          isoSize: r.iso.length,
          ...(r.cso ? { csoBase64: Buffer.from(r.cso).toString("base64"), csoSize: r.cso.length } : {}),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4p. Rebuild immagine Dreamcast GDI (traccia dati ricostruita,
    // IP.BIN dei primi 16 settori preservato). Dietro gate.
    if (url.pathname === "/api/dc/gdi/build" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const zip = new Uint8Array(Buffer.from(body.zipBase64 || "", "base64"));
        const replacements = (body.replacements || []).map((r: any) => ({
          name: String(r.name || ""),
          data: new Uint8Array(Buffer.from(r.fileBase64 || "", "base64")),
        })).filter((r: any) => r.name && r.data.length > 0);
        if (replacements.length === 0) return new Response(JSON.stringify({ error: "Nessun file di sostituzione fornito." }), { status: 400, headers });
        const r = rebuildDcGdi(zip, replacements);
        return new Response(JSON.stringify({
          applied: r.applied,
          unmatched: r.unmatched,
          zipBase64: Buffer.from(r.zip).toString("base64"),
          zipSize: r.zip.length,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4n. Dreamcast — filesystem di un'immagine GDI (ZIP con .gdi + tracce):
    // traccia dati ISO9660 2048 via parser esistente. CDI non supportato.
    if (url.pathname === "/api/dc/gdi/list" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const zip = new Uint8Array(Buffer.from(body.zipBase64 || "", "base64"));
        if (zip.length < 32) return new Response(JSON.stringify({ error: "ZIP troppo corto." }), { status: 400, headers });
        const l = listGdiFiles(zip);
        return new Response(JSON.stringify({
          gdiName: l.gdiName,
          trackCount: l.trackCount,
          tracks: l.tracks.map((t) => ({ number: t.number, file: t.file, sectorSize: t.sectorSize, isData: t.isData })),
          isLikelyDreamcast: l.isLikelyDreamcast,
          volumeId: l.volumeId,
          entries: l.entries.slice(0, 500).map((e) => ({ path: e.path, isDir: e.isDir, size: e.size })),
          entryCount: l.entries.length,
          truncated: l.entries.length > 500,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }
    if (url.pathname === "/api/dc/gdi/extract" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const zip = new Uint8Array(Buffer.from(body.zipBase64 || "", "base64"));
        const file = extractGdiFile(zip, body.path || "");
        return new Response(JSON.stringify({ path: body.path, size: file.length, fileBase64: Buffer.from(file).toString("base64") }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4q. CHD (MAME Compressed Hunks of Data) — lettura header/metadata di
    // un'immagine PSP/Dreamcast compressa. Solo v5 zlib, senza parent
    // (vedi src/chd.ts per i limiti dichiarati onestamente).
    if (url.pathname === "/api/chd/info" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.chdBase64 || "", "base64"));
        if (!isChd(data)) return new Response(JSON.stringify({ error: "Il file non ha il magic 'MComprHD' (non è un CHD)." }), { status: 400, headers });
        const chd = new ChdFile(data);
        return new Response(JSON.stringify(chd.info), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4r. CHD — estrae un intervallo logico di byte decompressi (es. per
    // isolare una traccia e passarla alle pipeline ISO9660/GDI esistenti).
    if (url.pathname === "/api/chd/extract" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.chdBase64 || "", "base64"));
        const chd = new ChdFile(data);
        const offset = Number(body.offset || 0);
        const length = Number(body.length || chd.logicalBytes);
        const out = chd.readLogical(offset, length);
        return new Response(JSON.stringify({ offset, length: out.length, dataBase64: Buffer.from(out).toString("base64") }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4m. N64 — encoder texture RGBA→formati RDP (inverse del decoder,
    // con palette CI4/CI8 dai colori esatti: oltre il limite → errore onesto).
    if (url.pathname === "/api/n64/texture/encode" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const width = Number(body.width), height = Number(body.height);
        const format = body.format as N64TextureFormat;
        if (!width || !height) return new Response(JSON.stringify({ error: "width e height richieste." }), { status: 400, headers });
        if (!BITS_PER_PIXEL[format]) return new Response(JSON.stringify({ error: `Formato non riconosciuto: ${format}` }), { status: 400, headers });
        const rgba = new Uint8Array(Buffer.from(body.rgbaBase64 || "", "base64"));
        const enc = encodeN64Texture(rgba, width, height, format, { quantize: !!body.quantize });
        return new Response(JSON.stringify({
          dataBase64: Buffer.from(enc.data).toString("base64"),
          dataSize: enc.data.length,
          ...(enc.palette ? { paletteBase64: Buffer.from(enc.palette).toString("base64"), paletteSize: enc.palette.length } : {}),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4l. Mega Drive — decompressore Nemesis (art/tile). Solo decompressione:
    // l'encoder (tabella codici ottimale) non è implementato — dichiarato.
    if (url.pathname === "/api/md/nemesis/decompress" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        if (data.length < 3) return new Response(JSON.stringify({ error: "Dati Nemesis troppo corti." }), { status: 400, headers });
        const out = nemesisDecompress(data);
        return new Response(JSON.stringify({ decompressedBase64: Buffer.from(out).toString("base64"), decompressedSize: out.length }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4a2. PSP — decoder texture GIM reale (formati GE 5650/5551/4444/8888
    // + indicizzati P4/P8 con palette, de-swizzle tiled).
    if (url.pathname === "/api/psp/gim/decode" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.dataBase64 || "", "base64"));
        const img = decodeGim(data);
        return new Response(JSON.stringify({
          width: img.width, height: img.height, format: img.format,
          rgbaBase64: Buffer.from(img.rgba).toString("base64"),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4a3. Header GBA + complement check (algoritmo BIOS, GBATEK).
    if (url.pathname === "/api/gba/rom-header" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const h = parseGbaRomHeader(rom);
        return new Response(JSON.stringify({
          ...h,
          storedComplement: "0x" + h.storedComplement.toString(16).toUpperCase().padStart(2, "0"),
          computedComplement: "0x" + h.computedComplement.toString(16).toUpperCase().padStart(2, "0"),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4a4. Fix complement GBA (0xBD) — dietro gate di dichiarazione.
    if (url.pathname === "/api/gba/checksum/fix" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const { rom: fixed, complement } = fixGbaComplement(rom);
        return new Response(JSON.stringify({
          complement: "0x" + complement.toString(16).toUpperCase().padStart(2, "0"),
          romBase64: Buffer.from(fixed).toString("base64"),
          size: fixed.length,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4c. Header ROM Genesis/Mega Drive + verifica checksum (algoritmo Sega
    // originale + variante SGDK, entrambi reali e distinti).
    if (url.pathname === "/api/genesis/rom-header" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const h = parseGenesisRomHeader(rom);
        return new Response(JSON.stringify({
          ...h,
          storedChecksum: "0x" + h.storedChecksum.toString(16).toUpperCase(),
          computedChecksum: "0x" + h.computedChecksum.toString(16).toUpperCase(),
          computedChecksumSgdk: "0x" + h.computedChecksumSgdk.toString(16).toUpperCase(),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4c2. Editor header ROM Genesis/Mega Drive — riscrive titoli/seriale e
    // ricalcola SEMPRE il checksum (riusa fixGenesisChecksum). Dietro lo
    // stesso gate di dichiarazione del patcher/CRC-fix N64.
    if (url.pathname === "/api/genesis/rom-header/write" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const { rom: out, checksum } = writeGenesisRomHeader(rom, {
          domesticTitle: body.domesticTitle,
          overseasTitle: body.overseasTitle,
          serial: body.serial,
        }, !!body.sgdk);
        return new Response(JSON.stringify({
          romBase64: Buffer.from(out).toString("base64"), size: out.length,
          checksum: "0x" + checksum.toString(16).toUpperCase(),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 4d. Fix checksum Genesis (formato Sega originale o SGDK) — dietro gate.
    if (url.pathname === "/api/genesis/checksum/fix" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const { rom: fixed, checksum } = fixGenesisChecksum(rom, !!body.sgdk);
        return new Response(JSON.stringify({
          checksum: "0x" + checksum.toString(16).toUpperCase(),
          format: body.sgdk ? "sgdk (XOR)" : "sega (somma da 0x200)",
          romBase64: Buffer.from(fixed).toString("base64"),
          size: fixed.length,
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
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

    // 12b. Editor header ROM N64 — riscrive titolo/country/versione e
    // ritorna la ROM intera modificata. Dietro lo stesso gate di
    // dichiarazione del patcher/CRC-fix: è una scrittura reale sulla ROM.
    if (url.pathname === "/api/n64/rom-header/write" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const out = writeN64RomHeader(rom, {
          imageName: body.imageName,
          countryCode: typeof body.countryCode === "number" ? body.countryCode : undefined,
          version: typeof body.version === "number" ? body.version : undefined,
        });
        return new Response(JSON.stringify({ romBase64: Buffer.from(out).toString("base64"), size: out.length }), { headers });
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

    // 13n2. Editor header ROM SNES — riscrive titolo/versione/destinazione
    // e ricalcola SEMPRE il checksum reale (il titolo è coperto dal
    // checksum). Dietro lo stesso gate di dichiarazione del patcher.
    if (url.pathname === "/api/snes/rom-header/write" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const rom = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const parsed = parseSnesRomHeader(rom); // per ritrovare l'headerOffset reale della mappatura rilevata
        const { rom: out, checksum, complement } = writeSnesRomHeader(rom, parsed.headerOffset, {
          title: body.title,
          version: typeof body.version === "number" ? body.version : undefined,
          destination: typeof body.destination === "number" ? body.destination : undefined,
        });
        return new Response(JSON.stringify({
          romBase64: Buffer.from(out).toString("base64"), size: out.length,
          checksum: "0x" + checksum.toString(16).toUpperCase(),
          checksumComplement: "0x" + complement.toString(16).toUpperCase(),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13o. Identificazione automatica ROM: accetta ROM nuda o ZIP (estratto
    // realmente in memoria), riconosce la console dai magic header e
    // converte automaticamente N64 .v64/.n64 in .z64 per i nostri tool.
    if (url.pathname === "/api/rom/identify" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        if (data.length < 16) return new Response(JSON.stringify({ error: "File troppo corto (minimo 16 byte)." }), { status: 400, headers });
        const result = identifyRomFile(data);
        // la ROM convertita in z64 torna come base64 solo se richiesta
        // (payload potenzialmente grande)
        return new Response(JSON.stringify({
          isArchive: result.isArchive,
          entries: result.entries.map((e) => ({
            name: e.name,
            size: e.size,
            console: e.console,
            format: e.format,
            confidence: e.confidence,
            detail: e.detail,
          })),
        }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // 13q. Conversione pura di formato N64 (.v64/.n64 → .z64): come
    // l'identificazione, opera sul byte-order del file e non tocca contenuti
    // protetti — nessun gate di dichiarazione (stessa classe di /identify).
    if (url.pathname === "/api/rom/convert" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const data = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const id = identifyConsole(data);
        if (!id.convertedZ64) {
          return new Response(JSON.stringify({
            error: id.console === "Nintendo 64"
              ? "La ROM è già in formato .z64: nessuna conversione necessaria."
              : "Il file non è una ROM N64 .v64/.n64 convertibile.",
          }), { status: 400, headers });
        }
        return new Response(JSON.stringify({
          romBase64: Buffer.from(id.convertedZ64).toString("base64"),
          size: id.convertedZ64.length,
          from: id.format,
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
  },
  websocket: {
    // Un solo messaggio JSON per connessione: { platform, sourceCode? |
    // sourceFiles? | zipBase64? }. La build reale gira UNA volta, con
    // pipeline.compile() che invia ogni fase reale via onProgress non
    // appena accade — non un progress bar finta a intervalli fissi.
    async message(ws, raw) {
      try {
        const body: any = JSON.parse(String(raw));
        const sourceFiles = body.zipBase64
          ? sourceFilesFromZip(new Uint8Array(Buffer.from(body.zipBase64, "base64")))
          : body.sourceFiles;
        const result = await pipeline.compile(
          { platform: body.platform, sourceCode: body.sourceCode, sourceFiles },
          (event) => { try { ws.send(JSON.stringify({ type: "progress", ...event })); } catch {} }
        );
        ws.send(JSON.stringify({ type: "done", result }));
      } catch (e: any) {
        try { ws.send(JSON.stringify({ type: "error", message: e.message })); } catch {}
      }
    },
  },
});

console.log(`\n======================================================`);
console.log(`🎮 Retro Console SDK Bridge (non ufficiale, non affiliato a Nintendo) — http://localhost:${PORT}`);
console.log(`🚀 Unified target compiles: SNES, N64, GameCube, Wii, Switch`);
console.log(`======================================================\n`);
