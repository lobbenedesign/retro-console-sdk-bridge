/**
 * 🦔 Parser header ROM Sega Mega Drive / Genesis + fix checksum
 *
 * Layout header (0x100-0x1FF, big-endian) secondo la documentazione
 * pubblica standard (Sega Retro "Mega Drive cartridge" + Software
 * Standards Manual Sega, riassunta anche da plutiedev.com/rom-header):
 *   0x100: nome console (16 B, "SEGA MEGA DRIVE " / "SEGA GENESIS    ")
 *   0x110: copyright (16 B)
 *   0x120: titolo domestico/JP (48 B)
 *   0x150: titolo internazionale (48 B)
 *   0x180: numero seriale (14 B, es. "GM 00001051-00")
 *   0x18E: checksum (u16 BE)
 *   0x190: dispositivi supportati (16 B, codici carattere)
 *   0x1A0: inizio ROM (u32) · 0x1A4: fine ROM (u32)
 *   0x1A8: inizio RAM · 0x1AC: fine RAM
 *   0x1B0: info SRAM (0x20 abilitato) · 0x1B2: start SRAM · 0x1B4: end
 *   0x1B8: nota modem (16 B) · 0x1C8: memo (40 B)
 *   0x1F0: codici regione (3 B: J=Giappone U=USA E=Europa)
 *
 * CHECKSUM — due formati REALI coesistono, dichiarati entrambi:
 * 1. Originale Sega (verificato su Sega Retro "Checksum" e
 *    plutiedev.com/rom-header, più l'utility community
 *    mrhappyasthma/Sega-Genesis-Checksum-Utility): SOMMA delle word
 *    16-bit BE da 0x200 alla fine della ROM, mod 0x10000.
 * 2. Variante XOR di SGDK (letta direttamente dal sorgente reale
 *    tools/sizebnd/src/sgdk/sizebnd/Launcher.java, MIT): XOR di tutte le
 *    word 32-bit (con checksum azzerato), piegata
 *    `(x ^ (x>>16)) & 0xFFFF`. Le ROM prodotte da SGDK portano questa.
 */

export interface GenesisRomHeader {
  looksLikeGenesisRom: boolean;
  consoleName: string;
  copyright: string;
  domesticTitle: string;
  overseasTitle: string;
  serial: string;
  storedChecksum: number;
  computedChecksum: number; // algoritmo originale Sega (somma da 0x200)
  computedChecksumSgdk: number; // variante XOR usata dalle ROM SGDK
  checksumValid: boolean; // match con uno dei due formati reali
  checksumFormat: "sega" | "sgdk" | "nessuno";
  devices: string[];
  romStart: number;
  romEnd: number;
  ramStart: number;
  ramEnd: number;
  sramEnabled: boolean;
  sramStart: number;
  sramEnd: number;
  memo: string;
  regionCodes: string;
  regions: string[];
}

const DEVICE_CODES: Record<string, string> = {
  J: "joypad 3 bottoni",
  "6": "joypad 6 bottoni",
  "0": "Master Tap",
  A: "joypad analogico",
  "4": "Multitap",
  B: "trackball",
  C: "CD-ROM (Mega CD)",
  D: "download",
  F: "floppy disk",
  G: "light gun",
  K: "keyboard",
  L: "Activator",
  M: "mouse",
  P: "printer",
  R: "seriale RS-232C",
  T: "tablet",
  V: "paddle",
  X: "altro/non standard",
};

const REGION_NAMES: Record<string, string> = {
  J: "Giappone (NTSC)",
  U: "USA (NTSC)",
  E: "Europa (PAL)",
  F: "Francia? (codice raro)",
  "8": "Hong Kong (codice raro)",
  B: "Brasile (codice raro)",
  "4": "Cina (codice raro)",
  A: "Asia/Pacifico (codice raro)",
};

function ascii(bytes: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = off; i < off + len && i < bytes.length; i++) {
    if (bytes[i] >= 0x20 && bytes[i] < 0x7f) s += String.fromCharCode(bytes[i]);
  }
  return s.trim();
}

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Checksum originale Sega: somma word 16-bit BE da 0x200 a fine ROM. */
export function genesisChecksum(rom: Uint8Array): number {
  let sum = 0;
  for (let i = 0x200; i + 1 < rom.length; i += 2) {
    sum = (sum + ((rom[i] << 8) | rom[i + 1])) & 0xffff;
  }
  return sum;
}

/** Variante XOR SGDK (Launcher.java): XOR delle word 32 con checksum azzerato. */
export function genesisChecksumSgdk(rom: Uint8Array): number {
  // copia per azzerare il campo checksum senza mutare l'input
  const work = new Uint8Array(rom);
  work[0x18e] = 0;
  work[0x18f] = 0;
  let c = 0;
  for (let i = 0; i + 3 < work.length; i += 4) {
    c ^= be32(work, i);
  }
  c = (c ^ (c >>> 16)) & 0xffff;
  return c >>> 0;
}

export function parseGenesisRomHeader(rom: Uint8Array): GenesisRomHeader {
  if (rom.length < 0x200) {
    throw new Error(`ROM troppo corta per un header Mega Drive (servono almeno 0x200 byte, forniti ${rom.length}).`);
  }
  const consoleName = ascii(rom, 0x100, 16);
  const looksLikeGenesisRom = consoleName.startsWith("SEGA") || ascii(rom, 0x100, 4) === "SEGA";

  const deviceBytes = ascii(rom, 0x190, 16);
  const devices = [...new Set(deviceBytes.split(""))].filter((c) => DEVICE_CODES[c]).map((c) => `${c} = ${DEVICE_CODES[c]}`);

  const regionCodes = ascii(rom, 0x1f0, 3);
  const regions = regionCodes.split("").filter((c) => REGION_NAMES[c]).map((c) => `${c}: ${REGION_NAMES[c]}`);

  const storedChecksum = be16(rom, 0x18e);
  const computedChecksum = genesisChecksum(rom);
  const computedChecksumSgdk = genesisChecksumSgdk(rom);
  const checksumValid = storedChecksum === computedChecksum || storedChecksum === computedChecksumSgdk;
  const checksumFormat = storedChecksum === computedChecksum ? "sega" : storedChecksum === computedChecksumSgdk ? "sgdk" : "nessuno";

  return {
    looksLikeGenesisRom,
    consoleName,
    copyright: ascii(rom, 0x110, 16),
    domesticTitle: ascii(rom, 0x120, 48),
    overseasTitle: ascii(rom, 0x150, 48),
    serial: ascii(rom, 0x180, 14),
    storedChecksum,
    computedChecksum,
    computedChecksumSgdk,
    checksumValid,
    checksumFormat,
    devices,
    romStart: be32(rom, 0x1a0),
    romEnd: be32(rom, 0x1a4),
    ramStart: be32(rom, 0x1a8),
    ramEnd: be32(rom, 0x1ac),
    sramEnabled: rom[0x1b0] === 0x20,
    sramStart: be32(rom, 0x1b2),
    sramEnd: be32(rom, 0x1b4),
    memo: ascii(rom, 0x1c8, 40),
    regionCodes,
    regions,
  };
}

/**
 * Riscrive il checksum nell'header. Formato di default: algoritmo Sega
 * originale (quello atteso dalla console e dalla maggior parte delle ROM);
 * `sgdk: true` per la variante XOR usata dalle ROM prodotte da SGDK.
 * Ritorna una copia: i byte del client non vengono mai mutati in place.
 */
export function fixGenesisChecksum(rom: Uint8Array, sgdk = false): { rom: Uint8Array; checksum: number } {
  const out = new Uint8Array(rom);
  const checksum = sgdk ? genesisChecksumSgdk(out) : genesisChecksum(out);
  out[0x18e] = (checksum >> 8) & 0xff;
  out[0x18f] = checksum & 0xff;
  return { rom: out, checksum };
}

/**
 * Riscrive titolo domestico/internazionale e/o seriale nell'header Genesis,
 * poi ricalcola SEMPRE il checksum (riusa fixGenesisChecksum già esistente
 * e verificato) — formato Sega di default, `sgdk: true` per la variante XOR
 * usata dalle ROM prodotte da SGDK. Ritorna una copia: i byte del client
 * non vengono mai mutati in place.
 */
export function writeGenesisRomHeader(
  rom: Uint8Array,
  fields: { domesticTitle?: string; overseasTitle?: string; serial?: string },
  sgdk = false
): { rom: Uint8Array; checksum: number } {
  const out = new Uint8Array(rom);
  const writeField = (off: number, len: number, text: string) => {
    const field = new Uint8Array(len).fill(0x20);
    field.set(new TextEncoder().encode(text.toUpperCase().slice(0, len)));
    out.set(field, off);
  };
  if (fields.domesticTitle !== undefined) writeField(0x120, 48, fields.domesticTitle);
  if (fields.overseasTitle !== undefined) writeField(0x150, 48, fields.overseasTitle);
  if (fields.serial !== undefined) writeField(0x180, 14, fields.serial);
  return fixGenesisChecksum(out, sgdk);
}
