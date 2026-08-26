import { describe, test, expect } from "bun:test";
import {
  crc32,
  applyIpsPatch,
  applyBpsPatch,
  applyPatch,
  detectPatchFormat
} from "../src/rom_patcher";

// --- helpers per costruire patch IPS/BPS sintetiche a mano, secondo la
// stessa specifica reale (zerosoft IPS / beat BPS) usata per la verifica
// manuale documentata nel README e nei commit di oggi. ---

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

function u24be(n: number): number[] {
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function buildIps(records: Array<{ offset: number; data?: number[]; rle?: { runLength: number; value: number } }>): Uint8Array {
  const out: number[] = [0x50, 0x41, 0x54, 0x43, 0x48]; // "PATCH"
  for (const r of records) {
    out.push(...u24be(r.offset));
    if (r.rle) {
      out.push(0x00, 0x00); // size=0 => RLE record
      out.push(...u16be(r.rle.runLength));
      out.push(r.rle.value);
    } else {
      const data = r.data!;
      out.push(...u16be(data.length));
      out.push(...data);
    }
  }
  out.push(0x45, 0x4f, 0x46); // "EOF"
  return new Uint8Array(out);
}

// --- Encoder BPS minimale, spec-compliant, scritto SOLO per costruire
// fixture di test round-trip (stesso approccio usato per la verifica
// manuale di oggi: nessun encoder BPS esiste nel codice applicativo). ---

function writeVarInt(n: number): number[] {
  const out: number[] = [];
  n = n >>> 0;
  while (true) {
    const x = n & 0x7f;
    n = Math.floor(n / 128);
    if (n === 0) {
      out.push(x | 0x80);
      break;
    }
    out.push(x);
    n -= 1;
  }
  return out;
}

function bpsAction(mode: number, length: number): number[] {
  return writeVarInt(((length - 1) << 2) | mode);
}

function bpsSignedVarInt(delta: number): number[] {
  const sign = delta < 0 ? 1 : 0;
  return writeVarInt((Math.abs(delta) << 1) | sign);
}

function u32le(n: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return Array.from(b);
}

interface BpsOp {
  mode: 0 | 1 | 2 | 3; // SourceRead, TargetRead, SourceCopy, TargetCopy
  length: number;
  literal?: number[]; // solo mode 1
  relDelta?: number; // solo mode 2/3
}

function buildBps(source: Uint8Array, target: Uint8Array, ops: BpsOp[], opts?: { corruptSourceCrc?: boolean }): Uint8Array {
  const header: number[] = [
    0x42, 0x50, 0x53, 0x31, // "BPS1"
    ...writeVarInt(source.length),
    ...writeVarInt(target.length),
    ...writeVarInt(0) // metadata size 0
  ];
  const body: number[] = [];
  for (const op of ops) {
    body.push(...bpsAction(op.mode, op.length));
    if (op.mode === 1) body.push(...op.literal!);
    if (op.mode === 2 || op.mode === 3) body.push(...bpsSignedVarInt(op.relDelta ?? 0));
  }
  const srcCrc = opts?.corruptSourceCrc ? (crc32(source) ^ 0xffffffff) >>> 0 : crc32(source);
  const tgtCrc = crc32(target);
  const footer = [...u32le(srcCrc), ...u32le(tgtCrc), ...u32le(0)];
  return new Uint8Array([...header, ...body, ...footer]);
}

describe("crc32", () => {
  test("calcola il CRC32 IEEE 802.3 corretto per stringhe note", () => {
    // Vettore di test standard, ampiamente noto/verificabile: CRC32("") = 0
    expect(crc32(new Uint8Array())).toBe(0);
    // CRC32 di "123456789" (vettore di test standard del polinomio 0xEDB88320) = 0xCBF43926
    const check = new TextEncoder().encode("123456789");
    expect(crc32(check).toString(16)).toBe("cbf43926");
  });

  test("CRC32 diverso per input diversi", () => {
    const a = crc32(new TextEncoder().encode("AAAA"));
    const b = crc32(new TextEncoder().encode("AAAB"));
    expect(a).not.toBe(b);
  });
});

describe("detectPatchFormat", () => {
  test("riconosce header IPS ('PATCH')", () => {
    const patch = buildIps([]);
    expect(detectPatchFormat(patch)).toBe("IPS");
  });
  test("riconosce header BPS ('BPS1')", () => {
    const source = new TextEncoder().encode("AB");
    const patch = buildBps(source, source, [{ mode: 0, length: 2 }]);
    expect(detectPatchFormat(patch)).toBe("BPS");
  });
  test("ritorna null per byte non riconosciuti", () => {
    expect(detectPatchFormat(bytes(0x00, 0x01, 0x02))).toBeNull();
  });
});

describe("applyIpsPatch", () => {
  test("applica un record letterale con sostituzione byte puntuale", () => {
    const source = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
    const patch = buildIps([{ offset: 1, data: [0xaa, 0xbb] }]);
    const result = applyIpsPatch(source, patch);
    expect(Array.from(result.outputBytes)).toEqual([0x00, 0xaa, 0xbb, 0x00, 0x00]);
    expect(result.format).toBe("IPS");
    expect(result.patchesApplied).toBe(1);
  });

  test("applica un record RLE (run-length)", () => {
    const source = new Uint8Array(8).fill(0x00);
    const patch = buildIps([{ offset: 2, rle: { runLength: 4, value: 0xff } }]);
    const result = applyIpsPatch(source, patch);
    expect(Array.from(result.outputBytes)).toEqual([0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00]);
  });

  test("applica record multipli letterale + RLE nello stesso patch", () => {
    const source = new Uint8Array(10).fill(0x00);
    const patch = buildIps([
      { offset: 0, data: [0x11, 0x22, 0x33] },
      { offset: 6, rle: { runLength: 3, value: 0x99 } }
    ]);
    const result = applyIpsPatch(source, patch);
    expect(Array.from(result.outputBytes)).toEqual([
      0x11, 0x22, 0x33, 0x00, 0x00, 0x00, 0x99, 0x99, 0x99, 0x00
    ]);
    expect(result.patchesApplied).toBe(2);
  });

  test("rifiuta un file senza header 'PATCH' valido", () => {
    expect(() => applyIpsPatch(new Uint8Array(4), bytes(0x00, 0x01, 0x02, 0x03))).toThrow();
  });

  test("calcola sourceCrc32/targetCrc32 reali sull'output", () => {
    const source = new Uint8Array([0x00, 0x00]);
    const patch = buildIps([{ offset: 0, data: [0x01, 0x02] }]);
    const result = applyIpsPatch(source, patch);
    expect(result.sourceCrc32).toBe(crc32(source).toString(16).padStart(8, "0"));
    expect(result.targetCrc32).toBe(crc32(result.outputBytes).toString(16).padStart(8, "0"));
  });
});

describe("applyBpsPatch", () => {
  test("SourceRead: copia diretta dalla sorgente", () => {
    const source = new TextEncoder().encode("HELLO!!!");
    const patch = buildBps(source, source, [{ mode: 0, length: source.length }]);
    const result = applyBpsPatch(source, patch);
    expect(new TextDecoder().decode(result.outputBytes)).toBe("HELLO!!!");
    expect(result.sourceCrcMatched).toBe(true);
    expect(result.targetCrcMatched).toBe(true);
  });

  test("TargetRead: dati letterali inseriti direttamente dalla patch", () => {
    const source = new Uint8Array(0);
    const target = new TextEncoder().encode("NEW");
    const patch = buildBps(source, target, [
      { mode: 1, length: 3, literal: [0x4e, 0x45, 0x57] }
    ]);
    const result = applyBpsPatch(source, patch);
    expect(new TextDecoder().decode(result.outputBytes)).toBe("NEW");
  });

  test("SourceCopy: copia da un offset relativo (con segno) nella sorgente", () => {
    // sorgente "ABCDEFGH", target = ultimi 4 byte ripetuti in testa: "EFGH" + "ABCD"
    const source = new TextEncoder().encode("ABCDEFGH");
    const target = new TextEncoder().encode("EFGHABCD");
    const patch = buildBps(source, target, [
      { mode: 2, length: 4, relDelta: 4 }, // sourceRelOffset 0 -> 4, legge source[4..8) = "EFGH"
      { mode: 2, length: 4, relDelta: -8 } // sourceRelOffset 8 -> 0, legge source[0..4) = "ABCD"
    ]);
    const result = applyBpsPatch(source, patch);
    expect(new TextDecoder().decode(result.outputBytes)).toBe("EFGHABCD");
  });

  test("TargetCopy: backreference RLE-style con overlap nell'output già scritto", () => {
    const source = new TextEncoder().encode("AAAABBBB");
    const target = new TextEncoder().encode("AAAABBBBBBBB");
    const patch = buildBps(source, target, [
      { mode: 0, length: 8 }, // SourceRead: copia "AAAABBBB"
      { mode: 3, length: 4, relDelta: 4 } // TargetCopy: ripete le ultime 4 "BBBB" via overlap
    ]);
    const result = applyBpsPatch(source, patch);
    expect(new TextDecoder().decode(result.outputBytes)).toBe("AAAABBBBBBBB");
  });

  test("segnala sourceCrcMatched:false se la ROM fornita non è quella corretta per la patch", () => {
    const source = new TextEncoder().encode("AAAABBBB");
    const wrongSource = new TextEncoder().encode("XXXXXXXX");
    const target = new TextEncoder().encode("AAAABBBBBBBB");
    const patch = buildBps(source, target, [
      { mode: 1, length: 12, literal: Array.from(target) }
    ]);
    const result = applyBpsPatch(wrongSource, patch);
    expect(result.sourceCrcMatched).toBe(false);
    // targetCrcMatched resta vero: l'output prodotto è comunque quello dichiarato
    // dalla patch (qui costruita solo con TargetRead, indipendente dalla sorgente)
    expect(result.targetCrcMatched).toBe(true);
  });

  test("rifiuta un file senza header 'BPS1' valido", () => {
    expect(() => applyBpsPatch(new Uint8Array(4), bytes(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f))).toThrow();
  });
});

describe("applyPatch (dispatch automatico per formato)", () => {
  test("instrada correttamente verso applyIpsPatch", () => {
    const source = new Uint8Array(4).fill(0x00);
    const patch = buildIps([{ offset: 0, data: [0x01] }]);
    const result = applyPatch(source, patch);
    expect(result.format).toBe("IPS");
  });

  test("instrada correttamente verso applyBpsPatch", () => {
    const source = new TextEncoder().encode("AB");
    const patch = buildBps(source, source, [{ mode: 0, length: 2 }]);
    const result = applyPatch(source, patch);
    expect(result.format).toBe("BPS");
  });

  test("lancia un errore onesto per un formato non riconosciuto", () => {
    expect(() => applyPatch(new Uint8Array(4), bytes(0xde, 0xad, 0xbe, 0xef))).toThrow();
  });
});
