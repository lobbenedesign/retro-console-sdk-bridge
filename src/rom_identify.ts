/**
 * 🕹️ Identificatore automatico della console di appartenenza di una ROM
 *
 * Riconosce le firme binarie reali degli header hardware (documentazione
 * pubblica: n64brew.dev, fullsnes/sneslab, GBATEK per GBA/NDS, wiki
 * Dolphin per GC/Wii):
 *   N64 z64: 80 37 12 40 · v64: 37 80 40 12 (byteswap 16-bit) ·
 *        n64: 40 12 37 80 (wordswap 32-bit) — con CONVERSIONE automatica a z64
 *   NES:   "NES\x1A" a offset 0
 *   GB/GBC: logo Nintendo a 0x104
 *   GBA:   logo Nintendo a 0x04
 *   NDS:   logo Nintendo a 0xC0
 *   SNES:  header a 0x7FC0/0xFFC0/0x40FFC0 (euristica checksum, vedi
 *          src/snes_rom_header.ts — confidenza "euristica", non magic)
 *   Genesis/Mega Drive: "SEGA" a 0x100
 *   GameCube: magic 0xC2339F3D a 0x1C · Wii: magic 0x5D1C9EA3 a 0x18
 *
 * L'ordine di verifica conta: i magic esatti vincono, le euristiche
 * (SNES) vengono provate per ultime e dichiarate come tali.
 */

import { unzip, isZip, type ZipEntry } from "./zip_reader";
import { parseSnesRomHeader } from "./snes_rom_header";

export interface ConsoleMatch {
  console: string; // "Nintendo 64", "SNES", ...
  format: string; // "z64", "v64", "sfc/LoROM", ...
  confidence: "magic" | "euristica";
  detail: string;
  /** solo per N64 v64/n64: byte convertiti in z64 big-endian pronti per i tool */
  convertedZ64?: Uint8Array;
}

const startsWith = (b: Uint8Array, off: number, bytes: number[]) =>
  b.length >= off + bytes.length && bytes.every((v, i) => b[off + i] === v);

// logo Nintendo GB (primo tratto distintivo, 16 byte a 0x104)
const GB_LOGO = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x37, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0d, 0x00];
// logo Nintendo GBA/NDS (primo tratto distintivo, 16 byte)
const GBA_LOGO = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a, 0x84, 0xe4, 0x09, 0xad];

/** Converte una ROM N64 .v64 (byteswap 16-bit) in .z64 big-endian. */
export function v64ToZ64(v64: Uint8Array): Uint8Array {
  const out = new Uint8Array(v64.length);
  for (let i = 0; i + 1 < v64.length; i += 2) {
    out[i] = v64[i + 1];
    out[i + 1] = v64[i];
  }
  return out;
}

/** Converte una ROM N64 .n64 (little-endian 32-bit) in .z64 big-endian. */
export function n64leToZ64(n64: Uint8Array): Uint8Array {
  const out = new Uint8Array(n64.length);
  for (let i = 0; i + 3 < n64.length; i += 4) {
    out[i] = n64[i + 3];
    out[i + 1] = n64[i + 2];
    out[i + 2] = n64[i + 1];
    out[i + 3] = n64[i];
  }
  return out;
}

/** Identifica la console di una ROM già scompattata. */
export function identifyConsole(rom: Uint8Array): ConsoleMatch {
  if (rom.length < 16) throw new Error("File troppo corto per un'identificazione (minimo 16 byte).");

  // N64 nelle tre varianti di byte order (magic = i 4 registri PI_BSD_DOM1)
  if (startsWith(rom, 0, [0x80, 0x37, 0x12, 0x40])) {
    return { console: "Nintendo 64", format: "z64 (big-endian)", confidence: "magic", detail: "Magic header PI_BSD 80 37 12 40: ROM N64 standard big-endian, pronta per i tool." };
  }
  if (startsWith(rom, 0, [0x37, 0x80, 0x40, 0x12])) {
    return { console: "Nintendo 64", format: "v64 (byteswap 16-bit)", confidence: "magic", detail: "Magic 37 80 40 12: variante .v64 (word-swapped). Convertita automaticamente in .z64.", convertedZ64: v64ToZ64(rom) };
  }
  if (startsWith(rom, 0, [0x40, 0x12, 0x37, 0x80])) {
    return { console: "Nintendo 64", format: "n64 (little-endian 32-bit)", confidence: "magic", detail: "Magic 40 12 37 80: variante .n64 (little-endian). Convertita automaticamente in .z64.", convertedZ64: n64leToZ64(rom) };
  }

  if (startsWith(rom, 0, [0x4e, 0x45, 0x53, 0x1a])) {
    return { console: "Nintendo Entertainment System", format: "ines (.nes)", confidence: "magic", detail: "Header iNES \"NES\\x1A\": cartuccia NES/Famicom." };
  }
  if (startsWith(rom, 0x104, GB_LOGO)) {
    // GB vs GBC: il byte 0x143 (0x143=0x80/0xC0 indica CGB)
    const cgb = rom.length > 0x143 && (rom[0x143] & 0x80) !== 0;
    return { console: cgb ? "Game Boy Color" : "Game Boy", format: "GB/GBC", confidence: "magic", detail: "Logo Nintendo a 0x104 verificato (16 byte)." + (cgb ? " Flag CGB attivo a 0x143." : "") };
  }
  if (startsWith(rom, 0x04, GBA_LOGO)) {
    return { console: "Game Boy Advance", format: "GBA", confidence: "magic", detail: "Logo Nintendo a 0x04 verificato (16 byte)." };
  }
  if (startsWith(rom, 0xc0, GBA_LOGO)) {
    return { console: "Nintendo DS", format: "NDS", confidence: "magic", detail: "Logo Nintendo a 0xC0 verificato (16 byte)." };
  }
  if (startsWith(rom, 0x100, [0x53, 0x45, 0x47, 0x41])) {
    return { console: "Sega Mega Drive / Genesis", format: "MD", confidence: "magic", detail: "Firma \"SEGA\" a 0x100." };
  }
  if (startsWith(rom, 0x1c, [0xc2, 0x33, 0x9f, 0x3d])) {
    return { console: "Nintendo GameCube", format: "GCM/ISO", confidence: "magic", detail: "Disc magic 0xC2339F3D a 0x1C." };
  }
  if (startsWith(rom, 0x18, [0x5d, 0x1c, 0x9e, 0xa3])) {
    return { console: "Nintendo Wii", format: "ISO/WBFS-origin", confidence: "magic", detail: "Disc magic 0x5D1C9EA3 a 0x18." };
  }

  // SNES: nessun magic fisso — prova gli offset header con checksum (euristica)
  if (rom.length >= 0x8000) {
    try {
      const h = parseSnesRomHeader(rom);
      if (h.checksumConsistent) {
        return {
          console: "Super Nintendo", format: `SNES (${h.mapping})`, confidence: "euristica",
          detail: `Header ${h.mapping} valido a 0x${h.headerOffset.toString(16)} con checksum coerente, titolo "${h.title}".`,
        };
      }
    } catch { /* sotto 0x8000: non SNES */ }
  }

  return {
    console: "sconosciuta", format: "raw/binary", confidence: "euristica",
    detail: "Nessun magic header noto corrisponde ai primi byte del file. Se è una ROM raw senza header, l'identificazione per console richiede un'analisi manuale.",
  };
}

export interface IdentifiedEntry extends ConsoleMatch {
  name: string;
  size: number;
}

export interface RomIdentification {
  isArchive: boolean;
  entries: IdentifiedEntry[];
}

/**
 * Identifica un file caricato dall'utente, che possa essere una ROM nuda
 * o uno ZIP contenente una o più ROM (ogni voce viene identificata).
 * Nessun file viene salvato: tutto in memoria, byte restituiti al client.
 */
export function identifyRomFile(data: Uint8Array): RomIdentification {
  const identifyEntry = (name: string, bytes: Uint8Array): IdentifiedEntry => {
    // le voci chiaramente non-ROM (readme, txt piccoli, ecc.) non devono
    // far fallire l'identificazione delle altre: marcate e saltate
    if (bytes.length < 16) {
      return {
        name, size: bytes.length, console: "ignorata", format: "troppo piccola",
        confidence: "euristica", detail: `Voce da ${bytes.length} byte: troppo piccola per una ROM, ignorata onestamente.`,
      };
    }
    try {
      return { name, size: bytes.length, ...identifyConsole(bytes), convertedZ64: undefined };
    } catch (e: any) {
      return {
        name, size: bytes.length, console: "errore", format: "non identificabile",
        confidence: "euristica", detail: e.message,
      };
    }
  };

  if (isZip(data)) {
    const entries: ZipEntry[] = unzip(data);
    return { isArchive: true, entries: entries.map((e) => identifyEntry(e.name, e.data)) };
  }
  return { isArchive: false, entries: [identifyEntry("(file caricato)", data)] };
}
