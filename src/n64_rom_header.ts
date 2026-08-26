/**
 * 🧾 Parser reale dell'header ROM Nintendo 64 (primi 64 byte, offset 0x00-0x3F)
 *
 * Formato hardware GENERICO, identico su ogni ROM N64 commerciale o
 * homebrew (non specifico di un singolo gioco) — richiesto dal bootloader
 * IPL2/IPL3 di ogni console N64 reale per avviare qualunque cartuccia.
 * Documentazione pubblica incrociata da più fonti indipendenti:
 * ultra64.ca/files/tools/DETAILED_N64_MEMORY_MAP.txt, la voce "ROM Header"
 * della N64Brew Wiki, e il codice sorgente reale `libdragon/tools/n64tool.c`
 * (DragonMinded/libdragon, toolchain open source realmente usata per
 * costruire ROM homebrew N64). Stesso tipo di informazione usata da ogni
 * emulatore N64 reale (es. Mupen64Plus, Ares) e da ogni flashcart per
 * riconoscere una ROM.
 *
 * CORREZIONE (2026-08-26): una prima versione leggeva un campo
 * "manufacturerId" da un singolo byte a offset 0x38, assunzione mai
 * cross-verificata con una seconda fonte indipendente sull'offset esatto
 * (il test sintetico dell'epoca "passava" solo perché costruiva i dati di
 * prova con lo stesso offset sbagliato — bug autoconsistente, stesso
 * pattern del bug 0x27 del level-script). Verificato ora contro due fonti
 * indipendenti (ricerca pubblica sull'header N64 + `n64tool.c`, che
 * definisce `CATEGORY_OFFSET 0x3B` con default `'N'`): il byte reale a
 * quell'indirizzo è a offset **0x3B**, non 0x38, e rappresenta il formato
 * cartuccia ('N'=cart standard, 'D'=64DD, 'C'=cart+expansion,
 * 'E'=64DD expansion, 'Z'=Aleck64), non un generico "manufacturer ID".
 * Campo rinominato `cartridgeFormat` di conseguenza.
 */

export interface N64RomHeader {
  piBsdDom1LatReg: number;
  piBsdDom1PgsReg: number;
  piBsdDom1PwdReg: number;
  piBsdDom1RlsReg: number;
  clockRate: number;
  bootAddress: string; // hex, program counter d'ingresso
  release: string; // hex
  crc1: string; // hex, checksum primario memorizzato nell'header
  crc2: string; // hex, checksum secondario memorizzato nell'header
  imageName: string;
  cartridgeFormat: string; // offset 0x3B reale: 'N'=cart standard, 'D'=64DD, 'C'=cart+expansion, 'E'=64DD expansion, 'Z'=Aleck64
  cartridgeId: string;
  countryCode: number;
  countryName: string;
  version: number;
  looksLikeValidN64Rom: boolean; // vero se i primi 4 byte combaciano col magic reale documentato 80 37 12 40
}

// Magic dei primi 4 byte reali di ogni ROM N64 big-endian (.z64), documentato
// pubblicamente in ogni fonte di reverse engineering N64: PI_BSD_DOM1 init.
const N64_MAGIC = [0x80, 0x37, 0x12, 0x40];

// Mappa codice paese -> regione reale, documentata pubblicamente (byte
// ASCII usato come terzo carattere del game code, es. 'E'=USA, 'J'=Japan).
const COUNTRY_NAMES: Record<number, string> = {
  0x37: "Beta", 0x41: "Asian (NTSC)", 0x42: "Brazilian", 0x43: "Chinese",
  0x44: "German", 0x45: "USA (NTSC)", 0x46: "French", 0x47: "Gateway 64 (NTSC)",
  0x48: "Dutch", 0x49: "Italian", 0x4a: "Japanese (NTSC)", 0x4b: "Korean",
  0x4c: "Gateway 64 (PAL)", 0x4e: "Canadian", 0x50: "European (basic spec, PAL)",
  0x53: "Spanish", 0x55: "Australian", 0x57: "Scandinavian", 0x58: "European",
  0x59: "European"
};

function hex(n: number, digits = 8): string {
  return "0x" + (n >>> 0).toString(16).padStart(digits, "0");
}

export function parseN64RomHeader(rom: Uint8Array): N64RomHeader {
  if (rom.length < 0x40) throw new Error("Buffer troppo corto per contenere un header ROM N64 (minimo 64 byte).");

  const v = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const looksLikeValidN64Rom = N64_MAGIC.every((b, i) => rom[i] === b);

  const imageNameBytes = rom.slice(0x20, 0x34);
  const imageName = Array.from(imageNameBytes)
    .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ""))
    .join("")
    .trim();

  const countryCode = rom[0x3e];

  return {
    piBsdDom1LatReg: rom[0x00],
    piBsdDom1PgsReg: rom[0x01],
    piBsdDom1PwdReg: rom[0x02],
    piBsdDom1RlsReg: rom[0x03],
    clockRate: v.getUint32(0x04, false),
    bootAddress: hex(v.getUint32(0x08, false)),
    release: hex(v.getUint32(0x0c, false)),
    crc1: hex(v.getUint32(0x10, false)),
    crc2: hex(v.getUint32(0x14, false)),
    imageName,
    cartridgeFormat: String.fromCharCode(rom[0x3b]) || "?",
    cartridgeId: String.fromCharCode(rom[0x3c]) + String.fromCharCode(rom[0x3d]),
    countryCode,
    countryName: COUNTRY_NAMES[countryCode] || `Sconosciuto (0x${countryCode.toString(16)})`,
    version: rom[0x3f],
    looksLikeValidN64Rom
  };
}
