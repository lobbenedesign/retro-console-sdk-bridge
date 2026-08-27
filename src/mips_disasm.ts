/**
 * 🔍 Disassembler MIPS R4300i (subset reale usato dal codice N64)
 *
 * Referenza: encoding standard MIPS I/III documentato pubblicamente
 * (manuali SGI R4300 e la documentazione n64brew.dev). Riferimento
 * pratico di tool della community: il MIPS Disassembler in
 * jombo23/N64-Tools (licenza Unlicense/public domain) e rabbitizer
 * (Decompollaborate, MIT) usato da splat — qui si reimplementa il
 * solo subset di istruzioni che copre il grosso del codice dei giochi,
 * con decodifica REGIMM/SPECIAL e operandi formattati.
 *
 * Onestà dichiarata: NON è un disassembler completo MIPS III —
 * istruzioni COP1/FPU, 64-bit (dadd/dmult/ld/sd...) e speciali rare
 * vengono riportate come UNKNOWN con i 32 bit grezzi invece di
 * inventare un mnemonico. L'utente vede esattamente cosa manca.
 */

export interface DisassembledInstruction {
  address: number;
  bytes: string; // hex u32 big-endian
  text: string; // istruzione formattata, o "UNKNOWN"
}

const GP_REGS = [
  "zero", "at", "v0", "v1", "a0", "a1", "a2", "a3",
  "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
  "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
  "t8", "t9", "k0", "k1", "gp", "sp", "fp", "ra",
];

const R = (i: number) => "$" + GP_REGS[i & 0x1f];
const hex = (n: number) => "0x" + (n >>> 0).toString(16).toUpperCase();
const signed16 = (v: number) => (v & 0x8000 ? v - 0x10000 : v);

function disasmSpecial(w: number): string | null {
  const fn = w & 0x3f;
  const rd = (w >>> 11) & 0x1f, rt = (w >>> 16) & 0x1f, rs = (w >>> 21) & 0x1f;
  const sa = (w >>> 6) & 0x1f;
  switch (fn) {
    case 0x00: return w === 0 ? "nop" : `sll ${R(rd)}, ${R(rt)}, ${sa}`;
    case 0x02: return `srl ${R(rd)}, ${R(rt)}, ${sa}`;
    case 0x03: return `sra ${R(rd)}, ${R(rt)}, ${sa}`;
    case 0x04: return `sllv ${R(rd)}, ${R(rt)}, ${R(rs)}`;
    case 0x06: return `srlv ${R(rd)}, ${R(rt)}, ${R(rs)}`;
    case 0x07: return `srav ${R(rd)}, ${R(rt)}, ${R(rs)}`;
    case 0x08: return `jr ${R(rs)}`;
    case 0x09: return `jalr ${R(rd)}, ${R(rs)}`;
    case 0x0c: return "syscall";
    case 0x0d: return "break";
    case 0x10: return `mfhi ${R(rd)}`;
    case 0x11: return `mthi ${R(rs)}`;
    case 0x12: return `mflo ${R(rd)}`;
    case 0x13: return `mtlo ${R(rs)}`;
    case 0x18: return `mult ${R(rs)}, ${R(rt)}`;
    case 0x19: return `multu ${R(rs)}, ${R(rt)}`;
    case 0x1a: return `div ${R(rs)}, ${R(rt)}`;
    case 0x1b: return `divu ${R(rs)}, ${R(rt)}`;
    case 0x20: return `add ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x21: return `addu ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x22: return `sub ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x23: return `subu ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x24: return `and ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x25: return `or ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x26: return `xor ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x27: return `nor ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x2a: return `slt ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    case 0x2b: return `sltu ${R(rd)}, ${R(rs)}, ${R(rt)}`;
    default: return null;
  }
}

function disasmRegimm(w: number): string | null {
  const rt = (w >>> 16) & 0x1f;
  const rs = (w >>> 21) & 0x1f;
  const off = signed16(w & 0xffff);
  switch (rt) {
    case 0x00: return `bltz ${R(rs)}, ${off > 0 ? "+" : ""}${off}`;
    case 0x01: return `bgez ${R(rs)}, ${off > 0 ? "+" : ""}${off}`;
    case 0x10: return `bltzal ${R(rs)}, ${off > 0 ? "+" : ""}${off}`;
    case 0x11: return `bgezal ${R(rs)}, ${off > 0 ? "+" : ""}${off}`;
    default: return null;
  }
}

/** Decodifica una word MIPS. Ritorna il testo o null se non mappata. */
export function disassembleWord(w: number): string {
  const op = (w >>> 26) & 0x3f;
  const rs = (w >>> 21) & 0x1f, rt = (w >>> 16) & 0x1f;
  const imm = w & 0xffff, simm = signed16(imm);
  const target = (w & 0x3ffffff) << 2;

  switch (op) {
    case 0x00: return disasmSpecial(w) ?? `UNKNOWN(${hex(w)})`;
    case 0x01: return disasmRegimm(w) ?? `UNKNOWN(${hex(w)})`;
    case 0x02: return `j ${hex(target)}`;
    case 0x03: return `jal ${hex(target)}`;
    case 0x04: return `beq ${R(rs)}, ${R(rt)}, ${simm > 0 ? "+" : ""}${simm}`;
    case 0x05: return `bne ${R(rs)}, ${R(rt)}, ${simm > 0 ? "+" : ""}${simm}`;
    case 0x06: return `blez ${R(rs)}, ${simm > 0 ? "+" : ""}${simm}`;
    case 0x07: return `bgtz ${R(rs)}, ${simm > 0 ? "+" : ""}${simm}`;
    case 0x08: return `addi ${R(rt)}, ${R(rs)}, ${simm}`;
    case 0x09: return `addiu ${R(rt)}, ${R(rs)}, ${simm}`;
    case 0x0a: return `slti ${R(rt)}, ${R(rs)}, ${simm}`;
    case 0x0b: return `sltiu ${R(rt)}, ${R(rs)}, ${hex(imm)}`;
    case 0x0c: return `andi ${R(rt)}, ${R(rs)}, ${hex(imm)}`;
    case 0x0d: return `ori ${R(rt)}, ${R(rs)}, ${hex(imm)}`;
    case 0x0e: return `xori ${R(rt)}, ${R(rs)}, ${hex(imm)}`;
    case 0x0f: return `lui ${R(rt)}, ${hex(imm)}`;
    case 0x20: return `lb ${R(rt)}, ${simm}(${R(rs)})`;
    case 0x21: return `lh ${R(rt)}, ${simm}(${R(rs)})`;
    case 0x23: return `lw ${R(rt)}, ${simm}(${R(rs)})`;
    case 0x24: return `lbu ${R(rt)}, ${simm}(${R(rs)})`;
    case 0x25: return `lhu ${R(rt)}, ${simm}(${R(rs)})`;
    case 0x28: return `sb ${R(rt)}, ${simm}(${R(rs)})`;
    case 0x29: return `sh ${R(rt)}, ${simm}(${R(rs)})`;
    case 0x2b: return `sw ${R(rt)}, ${simm}(${R(rs)})`;
    default: return `UNKNOWN(${hex(w)})`;
  }
}

/**
 * Disassembla un blob di byte (allineato o no: le word scadute vengono
 * consumate con allineamento forzato a 4 a partire dall'offset 0).
 */
export function disassembleMips(
  bytes: Uint8Array,
  baseAddress = 0x80246000,
  maxInstructions = 2000,
): DisassembledInstruction[] {
  const out: DisassembledInstruction[] = [];
  const count = Math.min(Math.floor(bytes.length / 4), maxInstructions);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const w = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    out.push({
      address: baseAddress + o,
      bytes: w.toString(16).toUpperCase().padStart(8, "0"),
      text: disassembleWord(w),
    });
  }
  return out;
}
