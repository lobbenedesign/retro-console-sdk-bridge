/**
 * 🔐 Checksum CRC dell'header ROM N64 (formato hardware generico)
 *
 * Il PIF della console verifica i due CRC a offset 0x10/0x14 dell'header
 * calcolandoli con un algoritmo eseguito dall'IPL3 (bootstrap) sulla
 * regione ROM 0x1000..0x101000. Una ROM modificata senza ricalcolo di
 * questi checksum NON boota su console/emulatori reali.
 *
 * Algoritmo CIC-6102/6103/6106 trascritto fedelmente (variabili MIPS
 * rinominate in italiano dove non ambiguo) da `sm64_calc_checksums` in
 * queueRAM/sm64tools `libsm64.c` (MIT) — a sua volta derivato dal boot
 * code di SM64. Variante CIC-6105 trascritta da
 * Dragorn421/n64checksum `n64checksum_6105.c` (CC0), che ha un loop
 * diverso e legge anche una finestra di word a ROM offset ~0x750.
 *
 * Rilevamento del CIC: CRC32 dell'IPL3 (byte 0x40..0x1000) confrontato
 * con la tabella usata realmente da ethteck/splat (`util/n64/rominfo.py`,
 * MIT) — la stessa usata dai progetti di decompilazione reali.
 */

// CRC32 IEEE 802.3 (stessa tabella usata dal patcher IPS/BPS)
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type CicChip = "6101" | "7102" | "6102" | "7101" | "6103" | "7103" | "6105" | "7105" | "6106" | "7106" | "sconosciuto";

interface CicInfo {
  chip: CicChip;
  ntscName: string;
  palName: string;
  seed: number; // seme per l'algoritmo 6102-style (6105 usa algoritmo proprio)
}

// Tabella CRC32(IPL3) -> CIC, identica a quella di splat/rominfo.py
const CRC_TO_CIC: Array<{ crc: number; ntsc: string; pal: string; seed: number; offset: number }> = [
  { crc: 0x6170a4a1, ntsc: "6101", pal: "7102", seed: 0x3f, offset: 0x0 },
  { crc: 0x90bb6cb5, ntsc: "6102", pal: "7101", seed: 0x3f, offset: 0x0 },
  { crc: 0x0b050ee0, ntsc: "6103", pal: "7103", seed: 0x78, offset: 0x100000 },
  { crc: 0x98bc2c86, ntsc: "6105", pal: "7105", seed: 0x91, offset: 0x0 },
  { crc: 0xacc8580a, ntsc: "6106", pal: "7106", seed: 0x85, offset: 0x200000 },
];

/** Rileva il chip CIC dalla ROM (byte 0x40..0x1000 = IPL3). */
export function detectCic(rom: Uint8Array): CicInfo {
  if (rom.length < 0x1000) throw new Error("ROM troppo corta per contenere l'IPL3 (servono almeno 0x1000 byte).");
  const crc = crc32(rom.slice(0x40, 0x1000));
  const hit = CRC_TO_CIC.find((e) => e.crc === crc);
  if (!hit) return { chip: "sconosciuto", ntscName: "sconosciuto", palName: "sconosciuto", seed: 0 };
  // La versione PAL/NTSC si distingue dal country code 0x3E/0x50 (E/P)
  const countryCode = rom.length > 0x3e ? rom[0x3e] : 0;
  const isPal = countryCode === 0x50 || countryCode === 0x58 || countryCode === 0x59;
  const chip = (isPal ? hit.pal : hit.ntsc) as CicChip;
  return { chip, ntscName: hit.ntsc, palName: hit.pal, seed: hit.seed };
}

function readU32be(rom: Uint8Array, off: number): number {
  return ((rom[off] << 24) | (rom[off + 1] << 16) | (rom[off + 2] << 8) | rom[off + 3]) >>> 0;
}

/**
 * Algoritmo famiglia CIC-6102 (vale per 6101/6102/6103/6106 e varianti PAL,
 * cambia solo il seme). Trascrizione fedele del boot code SM64.
 */
function calcChecksums6102Family(rom: Uint8Array, seed: number): [number, number] {
  let t0 = 0;
  let t1 = 0x1000;
  const t5 = 32;
  const ra = 0x100000; // itera su 0x100000 byte (4 byte per giro)

  const lo = (seed * 0x5d588b65) >>> 0;
  let v0 = (lo + 1) >>> 0;
  let a3 = v0;
  let t2 = v0;
  let t3 = v0;
  let s0 = v0;
  let a2 = v0;
  let t4 = v0;

  do {
    v0 = readU32be(rom, t1);
    let v1 = (a3 + v0) >>> 0;
    const carry = v1 < a3 ? 1 : 0;
    if (carry) t2 = (t2 + 1) >>> 0;
    const shift = v0 & 0x1f;
    const a0 = ((v0 << shift) | (v0 >>> (t5 - shift))) >>> 0;
    const at = a2 < v0 ? 1 : 0;
    a3 = v1;
    t3 = (t3 ^ v0) >>> 0;
    s0 = (s0 + a0) >>> 0;
    if (at) {
      const t9 = (a3 ^ v0) >>> 0;
      a2 = (a2 ^ t9) >>> 0;
    } else {
      a2 = (a2 ^ a0) >>> 0;
    }
    t0 = (t0 + 4) >>> 0;
    const t7 = (v0 ^ s0) >>> 0;
    t1 = (t1 + 4) >>> 0;
    t4 = (t4 + t7) >>> 0;
  } while (t0 !== ra);

  const t6 = (a3 ^ t2) >>> 0;
  a3 = (t6 ^ t3) >>> 0;
  const t8 = (s0 ^ a2) >>> 0;
  s0 = (t8 ^ t4) >>> 0;
  return [a3 >>> 0, s0 >>> 0];
}

/**
 * Variante CIC-6105 (trascritta da Dragorn421/n64checksum, CC0): loop con
 * base PC virtuale 0x80000400 e lettura aggiuntiva di una finestra di word
 * della ROM che scorre ciclicamente tra gli offset 0x750..0x850.
 */
function calcChecksums6105(rom: Uint8Array): [number, number] {
  const INI_PC = 0x80000400;
  const seed = 0x91;

  const lo = (seed * 0x5d588b65) >>> 0;
  let v0 = (lo + 1) >>> 0;
  let a3 = v0;
  let t2 = v0;
  let t3 = v0;
  let s0 = v0;
  let a2 = v0;
  let t4 = v0;
  const t5 = 0x20;

  let t0 = 0;
  let t1 = INI_PC;
  let s6 = 0xa0000200;
  const ra = 0x100000;

  do {
    v0 = readU32be(rom, (t1 - INI_PC + 0x1000) >>> 0);
    let v1 = (a3 + v0) >>> 0;
    const carry = v1 < a3;
    if (carry) t2 = (t2 + 1) >>> 0;
    const shift = v0 & 0x1f;
    const t7s = (t5 - shift) >>> 0;
    const t8 = v0 >>> t7s;
    const t6 = (v0 << shift) >>> 0;
    const a0 = (t6 | t8) >>> 0;
    const at = a2 < v0;
    a3 = v1;
    t3 = (t3 ^ v0) >>> 0;
    s0 = (s0 + a0) >>> 0;
    if (!at) {
      a2 = (a2 ^ a0) >>> 0;
    } else {
      const t9 = (a3 ^ v0) >>> 0;
      a2 = (a2 ^ t9) >>> 0;
    }
    const t7 = readU32be(rom, (s6 - 0xa0000004 + 0x000514 + 0x40) >>> 0);
    t0 = (t0 + 4) >>> 0;
    s6 = (s6 + 4) >>> 0;
    const t7x = (t7 ^ v0) >>> 0;
    t4 = (t4 + t7x) >>> 0;
    t1 = (t1 + 4) >>> 0;
    s6 = s6 & 0xa00002ff;
  } while (t0 !== ra);

  const t6 = (a3 ^ t2) >>> 0;
  a3 = (t6 ^ t3) >>> 0;
  const t8 = (s0 ^ a2) >>> 0;
  s0 = (t8 ^ t4) >>> 0;
  return [a3 >>> 0, s0 >>> 0];
}

export interface N64CrcResult {
  cic: CicChip;
  crc1: number;
  crc2: number;
  storedCrc1: number;
  storedCrc2: number;
  valid: boolean;
}

/** Calcola e confronta i checksum dell'header per una ROM completa. */
export function computeN64Checksums(rom: Uint8Array, cicOverride?: CicChip): N64CrcResult {
  if (rom.length < 0x101000) {
    throw new Error(
      `ROM troppo corta per il calcolo checksum (servono 0x101000 byte = ${0x101000}, forniti ${rom.length}). ` +
        "Le ROM SM64 estese (8MB) vanno bene; quelle da 4MB vanno prima estese (sm64extend)."
    );
  }
  const detected = detectCic(rom);
  const chip = cicOverride && cicOverride !== "sconosciuto" ? cicOverride : detected.chip;
  if (chip === "sconosciuto") {
    throw new Error("CIC non riconosciuto dall'IPL3: impossibile scegliere l'algoritmo. Specifica il CIC manualmente.");
  }
  const [crc1, crc2] = chip === "6105" || chip === "7105" ? calcChecksums6105(rom) : calcChecksums6102Family(rom, detected.seed || 0x3f);
  const storedCrc1 = readU32be(rom, 0x10);
  const storedCrc2 = readU32be(rom, 0x14);
  return { cic: chip, crc1, crc2, storedCrc1, storedCrc2, valid: crc1 === storedCrc1 && crc2 === storedCrc2 };
}

/** Ricalcola e scrive i checksum corretti nell'header, ritornando la ROM fixata. */
export function fixN64Checksums(rom: Uint8Array, cicOverride?: CicChip): { rom: Uint8Array; result: N64CrcResult } {
  const result = computeN64Checksums(rom, cicOverride);
  const out = new Uint8Array(rom); // copia: mai mutare i byte del client in place
  const dv = new DataView(out.buffer);
  dv.setUint32(0x10, result.crc1, false);
  dv.setUint32(0x14, result.crc2, false);
  return { rom: out, result: { ...result, valid: true } };
}
