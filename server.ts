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
import { identifyRomFile, identifyConsole } from "./src/rom_identify";
import { unzip } from "./src/zip_reader";
import { DASHBOARD_HTML } from "./src/dashboard_html";
import { parseLevelScript, serializeLevelScript, EDITABLE_COMMAND_NAMES, type LevelCommand } from "./src/sm64_level_script";
import { parseN64RomHeader } from "./src/n64_rom_header";
import { decodeN64Texture, requiredByteLength, BITS_PER_PIXEL, type N64TextureFormat } from "./src/n64_texture";
import { join } from "path";
import { existsSync, writeFileSync } from "fs";

const PORT = Number(process.env.PORT) || 3014;
const pipeline = new CompilerPipeline();
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
      return new Response(DASHBOARD_HTML, { headers: { "Content-Type": "text/html" } });
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

    // 13p. Unzip + identificazione + conversione z64 in un colpo solo: per
    // ZIP o ROM N64 non-z64 restituisce anche i byte pronti per gli altri
    // tool (crc/split/level-script), sempre dietro gate di dichiarazione.
    if (url.pathname === "/api/rom/prepare" && req.method === "POST") {
      try {
        const body: any = await req.json();
        if (!verifyToken(body.token, body.fullName)) {
          return new Response(JSON.stringify({ error: "Dichiarazione non valida o mancante (stesso gate del patcher)." }), { status: 403, headers });
        }
        const data = new Uint8Array(Buffer.from(body.romBase64 || "", "base64"));
        const result = identifyRomFile(data);
        // seleziona la prima ROM N64 trovata (convertita se serve) o la
        // prima ROM identificata con confianza "magic"
        let prepared = null;
        const base = result.isArchive
          ? unzip(data)
          : [{ name: "(file caricato)", data }];
        for (const entry of base) {
          if (entry.data.length < 16) continue; // voci non-ROM (readme ecc.) saltate
          const id = identifyConsole(entry.data);
          if (id.console === "Nintendo 64" && id.convertedZ64) {
            prepared = { name: entry.name, romBase64: Buffer.from(id.convertedZ64).toString("base64"), size: id.convertedZ64.length, note: "v64/n64 convertita in z64" };
            break;
          }
          if (id.console === "Nintendo 64" && !prepared) {
            prepared = { name: entry.name, romBase64: Buffer.from(entry.data).toString("base64"), size: entry.data.length, note: "z64 già pronta" };
          }
        }
        return new Response(JSON.stringify({
          isArchive: result.isArchive,
          entries: result.entries.map((e) => ({ name: e.name, console: e.console, format: e.format, confidence: e.confidence })),
          prepared,
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
  }
});

console.log(`\n======================================================`);
console.log(`🎮 Retro Console SDK Bridge (non ufficiale, non affiliato a Nintendo) — http://localhost:${PORT}`);
console.log(`🚀 Unified target compiles: SNES, N64, GameCube, Wii, Switch`);
console.log(`======================================================\n`);
