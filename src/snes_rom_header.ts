/**
 * 🧾 Parser header ROM SNES (formato hardware generico)
 *
 * Layout dell'header SNES documentato pubblicamente (spec coperta anche
 * da GerbilSoft/rom-properties, GPL-2.0 — qui usata SOLO come reference
 * del formato, mai copiandone codice; il layout header SNES è conoscenza
 * pubblica preesistente documentata su sneslab.net/fullsnes).
 *
 * L'header si trova in uno di tre offset a seconda della mappatura:
 *   LoROM  : 0x007FC0   · HiROM: 0x00FFC0   · ExHiROM: 0x40FFC0
 * Campi (relativi all'inizio header):
 *   +0x00 titolo (21 byte ASCII)
 *   +0x15 map mode (0x20 LoROM fast, 0x21 HiROM fast, 0x30 ExHiROM…)
 *   +0x16 tipo chipset (0x00 ROM solo, 0x01+ ROM+RAM, 0x20+ con coprocessore…)
 *   +0x17 dimensione ROM (log2: 0x07 = 128KB … 0x0D = 8MB)
 *   +0x18 dimensione SRAM
 *   +0x19 destinazione (0/1/2 Giappone/USA/Europa, 3+ workaround rari)
 *   +0x1A licenziatario
 *   +0x1B versione
 *   +0x1C complement checksum (2 byte LE)
 *   +0x1E checksum (2 byte LE)
 * Validazione reale: complement + checksum == 0xFFFF (usata per scegliere
 * la mappatura giusta quando più candidati cadono dentro la ROM).
 */

export interface SnesRomHeader {
  mapping: "LoROM" | "HiROM" | "ExHiROM" | "sconosciuta";
  headerOffset: number;
  title: string;
  mapMode: number;
  chipset: string;
  romSize: number;
  sramSize: number;
  destination: string;
  licenseeCode: string;
  version: number;
  checksum: number;
  checksumComplement: number;
  checksumConsistent: boolean;
}

const MAPPING_CANDIDATES: Array<{ name: SnesRomHeader["mapping"]; offset: number }> = [
  { name: "LoROM", offset: 0x7fc0 },
  { name: "HiROM", offset: 0xffc0 },
  { name: "ExHiROM", offset: 0x40ffc0 },
];

const CHIPSETS: Record<number, string> = {
  0x00: "solo ROM",
  0x01: "ROM + RAM",
  0x02: "ROM + SRAM",
  0x03: "ROM + DSP1",
  0x04: "ROM + RAM + DSP1",
  0x05: "ROM + SRAM + DSP1",
  0x13: "ROM + DSP2",
  0x14: "ROM + RAM + DSP2",
  0x15: "ROM + SRAM + DSP2",
  0x1a: "ROM + DSP4",
  0x20: "ROM + SuperFX (GSU)",
  0x22: "ROM + RAM + SuperFX",
  0x23: "ROM + SRAM + SuperFX",
  0x25: "ROM + SRAM + OBC1",
  0x32: "ROM + SA-1",
  0x34: "ROM + SA-1 + SRAM",
  0x35: "ROM + SA-1 + SRAM (bank switch)",
  0x43: "ROM + S-DD1",
  0x45: "ROM + S-DD1 + SRAM",
  0x55: "ROM + SPC7110 + SRAM",
  0xe3: "ROM + Satellaview (BS-X)",
  0xf5: "ROM + SPC7110 + RTC",
  0xf6: "ROM + ST010",
  0xf9: "ROM + ST011",
  0xfa: "ROM + ST018",
};

const DESTINATIONS: Record<number, string> = {
  0x00: "Giappone (NTSC)",
  0x01: "USA / Canada (NTSC)",
  0x02: "Europa / Oceania (PAL)",
  0x03: "Svezia/Scandinavia (workaround)",
  0x04: "Finlandia (workaround)",
  0x05: "Danimarca (workaround)",
  0x06: "Francia",
  0x07: "Olanda",
  0x08: "Spagna",
  0x09: "Germania / Austria / Svizzera",
  0x0a: "Italia",
  0x0b: "Cina / Hong Kong",
  0x0d: "Corea del Sud",
  0x0f: "Canada (bilingue)",
};

function readLe16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function parseAt(rom: Uint8Array, mapping: string, headerOffset: number): SnesRomHeader {
  const h = rom.slice(headerOffset);
  const titleBytes = h.slice(0, 21);
  let title = "";
  for (const b of titleBytes) if (b >= 0x20 && b < 0x7f) title += String.fromCharCode(b);
  const mapMode = h[0x15];
  const chipsetCode = h[0x16];
  const checksumComplement = readLe16(h, 0x1c);
  const checksum = readLe16(h, 0x1e);
  return {
    mapping: mapping as SnesRomHeader["mapping"],
    headerOffset,
    title: title.trim(),
    mapMode,
    chipset: CHIPSETS[chipsetCode] ?? `codice 0x${chipsetCode.toString(16).toUpperCase()} (non mappato)`,
    romSize: (1 << h[0x17]) * 1024, // byte size = log2(KB): SMW 0x09 → 512KB
    sramSize: h[0x18] === 0 ? 0 : (1 << h[0x18]) * 1024,
    destination: DESTINATIONS[h[0x19]] ?? `codice 0x${h[0x19].toString(16).toUpperCase()}`,
    licenseeCode: h[0x1a] === 0x33 ? "nome esteso dopo header" : `0x${h[0x1a].toString(16).toUpperCase()}`,
    version: h[0x1b],
    checksum,
    checksumComplement,
    checksumConsistent: (checksumComplement + checksum) === 0xffff,
  };
}

/** Parsa l'header SNES provando le tre mappature; vince il checksum coerente. */
export function parseSnesRomHeader(rom: Uint8Array): SnesRomHeader {
  if (rom.length < 0x8000) {
    throw new Error(`ROM troppo corta per un header SNES (servono almeno 0x8000 byte, forniti ${rom.length}).`);
  }
  const candidates = MAPPING_CANDIDATES
    .filter((c) => c.offset + 0x20 <= rom.length)
    .map((c) => parseAt(rom, c.name, c.offset));

  if (candidates.length === 0) {
    throw new Error("Nessun offset header SNES cade dentro la ROM fornita.");
  }
  // Preferisce: checksum coerente; a parità, il titolo ASCII più "pieno"
  // (un header falso dentro dati casuali raramente ha checksum coerente)
  const consistent = candidates.filter((c) => c.checksumConsistent);
  const pool = consistent.length ? consistent : candidates;
  pool.sort((a, b) => b.title.length - a.title.length);
  return { ...pool[0], mapping: consistent.length ? pool[0].mapping : "sconosciuta" };
}

/**
 * Ricalcola il checksum reale SNES: somma a 16 bit di tutti i byte della
 * ROM, col campo checksum stesso forzato a 0xFFFF e il complemento a 0x0000
 * durante il calcolo — convenzione standard usata dai tool di produzione
 * ROM reali (documentata su sneslab.net/fullsnes, stessa fonte pubblica già
 * citata in cima a questo file). Il complemento è sempre `checksum XOR
 * 0xFFFF`: è così che un lettore verifica la coerenza senza dover ricalcolare.
 */
export function computeSnesChecksum(rom: Uint8Array, headerOffset: number): { checksum: number; complement: number } {
  const work = new Uint8Array(rom);
  work[headerOffset + 0x1c] = 0x00; work[headerOffset + 0x1d] = 0x00;
  work[headerOffset + 0x1e] = 0xff; work[headerOffset + 0x1f] = 0xff;
  let sum = 0;
  for (let i = 0; i < work.length; i++) sum = (sum + work[i]) & 0xffff;
  return { checksum: sum, complement: sum ^ 0xffff };
}

/**
 * Riscrive titolo (21 byte ASCII), versione e/o destinazione nell'header
 * SNES alla mappatura indicata, poi ricalcola SEMPRE il checksum reale: il
 * titolo è coperto dal checksum, quindi modificarlo senza ricalcolo produce
 * una ROM che molti emulatori/flashcart segnalano come corrotta. Ritorna
 * una copia: i byte del client non vengono mai mutati in place.
 */
export function writeSnesRomHeader(
  rom: Uint8Array, headerOffset: number,
  fields: { title?: string; version?: number; destination?: number }
): { rom: Uint8Array; checksum: number; complement: number } {
  const out = new Uint8Array(rom);
  if (fields.title !== undefined) {
    const field = new Uint8Array(21).fill(0x20);
    field.set(new TextEncoder().encode(fields.title.toUpperCase().slice(0, 21)));
    out.set(field, headerOffset);
  }
  if (fields.version !== undefined) out[headerOffset + 0x1b] = fields.version & 0xff;
  if (fields.destination !== undefined) out[headerOffset + 0x19] = fields.destination & 0xff;
  const { checksum, complement } = computeSnesChecksum(out, headerOffset);
  out[headerOffset + 0x1c] = complement & 0xff;
  out[headerOffset + 0x1d] = (complement >> 8) & 0xff;
  out[headerOffset + 0x1e] = checksum & 0xff;
  out[headerOffset + 0x1f] = (checksum >> 8) & 0xff;
  return { rom: out, checksum, complement };
}
