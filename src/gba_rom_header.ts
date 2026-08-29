/**
 * 🎮 Parser header ROM Game Boy Advance + fix complement checksum.
 *
 * Layout header (0x00-0xBF, documentato pubblicamente su GBATEK di
 * nocash — https://problemkaputt.de/gbatek-gba-cartridge-header.htm):
 *   0x00-0x03: branch di boot
 *   0x04-0x9F: logo Nintendo (156 byte, fisso)
 *   0xA0-0xAB: titolo (12 byte ASCII)
 *   0xAC-0xAF: codice gioco (4 byte, es. "AMLE" per Super Mario Advance)
 *   0xB0-0xB1: codice produttore (2 byte)
 *   0xB2: 0x96 fisso
 *   0xB3: unit code (0=GBA, 1/2=compatibilità GB/GBC)
 *   0xB4: tipo dispositivo (0=generale)
 *   0xBC: versione
 *   0xBD: complement check — algoritmo del BIOS reale (GBATEK + ezgba):
 *         chk = 0; per i in 0xA0..0xBC: chk = (chk - rom[i] - 1) & 0xFF;
 *         scritto a 0xBD. Una ROM con complement corretto somma a 0
 *         includendo il byte stesso.
 */

export interface GbaRomHeader {
  looksLikeGbaRom: boolean;
  logoValid: boolean; // primo tratto del logo Nintendo verificato
  title: string;
  gameCode: string;
  makerCode: string;
  fixed96: boolean;
  unitCode: string;
  deviceType: number;
  version: number;
  storedComplement: number;
  computedComplement: number;
  complementValid: boolean;
}

const LOGO_PREFIX = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21]; // stesso logo già usato dall'identificatore

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = off; i < off + len && i < b.length; i++) if (b[i] >= 0x20 && b[i] < 0x7f) s += String.fromCharCode(b[i]);
  return s.trim();
}

/**
 * Complement del BIOS GBA — trascritto ESATTAMENTE da devkitPro/gba-tools
 * src/gbafix.c HeaderComplement(): somma dei byte 0xA0..0xBC, poi
 * complement = -(0x19 + somma) mod 256. (Fonte secondaria ezgba usava
 * l'accumulo -b-1×29 che differisce di 4: vince gbafix, lo standard
 * dell'homebrew GBA.)
 */
export function gbaComplement(rom: Uint8Array): number {
  let c = 0;
  for (let i = 0xa0; i < 0xbd; i++) c = (c + rom[i]) & 0xff;
  return (-(0x19 + c)) & 0xff;
}

export function parseGbaRomHeader(rom: Uint8Array): GbaRomHeader {
  if (rom.length < 0xC0) {
    throw new Error(`ROM troppo corta per un header GBA (servono 0xC0 byte, forniti ${rom.length}).`);
  }
  const logoValid = LOGO_PREFIX.every((v, i) => rom[0x04 + i] === v);
  const storedComplement = rom[0xbd];
  const computedComplement = gbaComplement(rom);
  return {
    looksLikeGbaRom: logoValid,
    logoValid,
    title: ascii(rom, 0xa0, 12),
    gameCode: ascii(rom, 0xac, 4),
    makerCode: ascii(rom, 0xb0, 2),
    fixed96: rom[0xb2] === 0x96,
    unitCode: rom[0xb3] === 0 ? "GBA" : `compatibile GB/GBC (code ${rom[0xb3]})`,
    deviceType: rom[0xb4],
    version: rom[0xbc],
    storedComplement,
    computedComplement,
    complementValid: storedComplement === computedComplement,
  };
}

/** Riscrive il complement corretto a 0xBD (copia difensiva, mai in place). */
export function fixGbaComplement(rom: Uint8Array): { rom: Uint8Array; complement: number } {
  const out = new Uint8Array(rom);
  const complement = gbaComplement(out);
  out[0xbd] = complement;
  return { rom: out, complement };
}
