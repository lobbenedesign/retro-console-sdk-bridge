import { describe, test, expect } from "bun:test";
import { isYay0, yay0Decompress } from "../src/n64_yay0";

// Helper: costruisce un blob Yay0 completo a partire da header + mask words +
// link table + chunk data, secondo il layout documentato nei commenti di
// src/n64_yay0.ts (magic, decompressedSize, linkTableOffset, chunkDataOffset,
// poi bitstream mask a 32 bit, poi le due sezioni dati).
function buildYay0(opts: {
  decompressedSize: number;
  maskWords: number[]; // uno o più word a 32 bit, MSB-first
  linkTableBytes: number[]; // entry a 2 byte big-endian (nibble conteggio + distanza 12 bit)
  chunkBytes: number[]; // byte letterali + eventuali byte di estensione conteggio
}): Uint8Array {
  const headerLen = 16;
  const maskLen = opts.maskWords.length * 4;
  const linkTableOffset = headerLen + maskLen;
  const chunkDataOffset = linkTableOffset + opts.linkTableBytes.length;
  const total = chunkDataOffset + opts.chunkBytes.length;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  buf.set([0x59, 0x61, 0x79, 0x30], 0); // "Yay0"
  view.setUint32(4, opts.decompressedSize, false);
  view.setUint32(8, linkTableOffset, false);
  view.setUint32(12, chunkDataOffset, false);

  let off = headerLen;
  for (const w of opts.maskWords) {
    view.setUint32(off, w >>> 0, false);
    off += 4;
  }
  buf.set(opts.linkTableBytes, linkTableOffset);
  buf.set(opts.chunkBytes, chunkDataOffset);

  return buf;
}

describe("isYay0", () => {
  test("riconosce il magic 'Yay0' reale", () => {
    const block = new Uint8Array(16);
    block.set([0x59, 0x61, 0x79, 0x30], 0);
    expect(isYay0(block)).toBe(true);
  });

  test("rifiuta un buffer troppo corto o senza magic", () => {
    expect(isYay0(new Uint8Array(4))).toBe(false);
    expect(isYay0(new Uint8Array(20))).toBe(false); // tutti zeri, nessun magic
  });
});

describe("yay0Decompress", () => {
  test("lancia un errore onesto se il magic manca", () => {
    expect(() => yay0Decompress(new Uint8Array(16))).toThrow();
  });

  test("lancia un errore onesto su un header malformato (magic sbagliato ma lunghezza valida)", () => {
    const bad = new Uint8Array(30);
    bad.set([0x59, 0x61, 0x79, 0x31], 0); // "Yay1", magic quasi giusto ma sbagliato
    expect(() => yay0Decompress(bad)).toThrow();
  });

  test("caso semplice: due byte letterali, nessuna backreference", () => {
    // 2 bit letterali (1,1) seguiti da padding a 0 nel mask word.
    const block = buildYay0({
      decompressedSize: 2,
      maskWords: [0b11000000_00000000_00000000_00000000],
      linkTableBytes: [],
      chunkBytes: [0x41, 0x42] // "A","B"
    });
    const out = yay0Decompress(block);
    expect(Array.from(out)).toEqual([0x41, 0x42]);
  });

  test("backreference semplice (nibble conteggio != 0): 'ABC' + ripetizione via link table", () => {
    // 3 letterali "A","B","C" poi un token compresso: bit pattern 1,1,1,0.
    // link = (nibble<<12)|distanza. nibble=1 -> count = nibble+2 = 3.
    // Il loop di copia usa out[offset+i-1] (non out[offset+i]): con
    // distanza=2, offset = idx(3) - 2 = 1, quindi per i=0 la sorgente è
    // out[offset-1] = out[0] = 'A', riproducendo "ABC" in sequenza.
    const nibble = 1;
    const distance = 2;
    const link = (nibble << 12) | distance;
    const block = buildYay0({
      decompressedSize: 6,
      maskWords: [0b11100000_00000000_00000000_00000000],
      linkTableBytes: [(link >> 8) & 0xff, link & 0xff],
      chunkBytes: [0x41, 0x42, 0x43] // "A","B","C"
    });
    const out = yay0Decompress(block);
    expect(Array.from(out)).toEqual(Array.from("ABCABC").map(c => c.charCodeAt(0)));
  });

  test("byte di estensione conteggio (nibble conteggio == 0): pattern 'ABC' ripetuto via extended length", () => {
    // 3 letterali "A","B","C" poi un token compresso con nibble=0: legge un
    // byte extra dal chunk stream come countModifier, count = countModifier + 18.
    // distanza=2 -> offset = idx(3) - 2 = 1 -> sorgente parte da out[0] (offset+i-1),
    // producendo una copia sequenziale che ripete "ABC" ciclicamente (LZ77
    // overlapping copy classico). Con countModifier=0 -> count=18, totale
    // 3 + 18 = 21 byte = "ABC" ripetuto 7 volte.
    const nibble = 0;
    const distance = 2;
    const link = (nibble << 12) | distance;
    const countModifier = 0;
    const block = buildYay0({
      decompressedSize: 21,
      maskWords: [0b11100000_00000000_00000000_00000000],
      linkTableBytes: [(link >> 8) & 0xff, link & 0xff],
      chunkBytes: [0x41, 0x42, 0x43, countModifier] // "A","B","C", countModifier
    });
    const out = yay0Decompress(block);
    const expected = "ABC".repeat(7).split("").map(c => c.charCodeAt(0));
    expect(Array.from(out)).toEqual(expected);
  });

  test("mask multi-word: forza il ricaricamento della bitstream mask dopo 32 bit consumati", () => {
    // 33 letterali: il primo mask word (32 bit tutti a 1) copre i primi 32
    // byte letterali, il secondo mask word fornisce il bit per il 33esimo.
    const decompressedSize = 33;
    const chunkBytes = Array.from({ length: 33 }, (_, i) => i + 1); // 1..33
    const block = buildYay0({
      decompressedSize,
      maskWords: [0xffffffff, 0b10000000_00000000_00000000_00000000],
      linkTableBytes: [],
      chunkBytes
    });
    const out = yay0Decompress(block);
    expect(Array.from(out)).toEqual(chunkBytes);
  });
});
