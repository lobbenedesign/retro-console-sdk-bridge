import { describe, expect, test } from "bun:test";
import { kosinskiDecompress, kosinskiCompress } from "../src/md_kosinski";

/**
 * Round-trip sul nostro compressore + decompressore, più un vettore
 * costruito A MANO byte-per-byte secondo la specifica del decompressore
 * 68000 reale (per non testare il codice solo contro sé stesso).
 */

describe("kosinskiDecompress (vettori costruiti a mano)", () => {
  function buildStream(tokens: string): Uint8Array {
    // hex compatto: "AB CD ..." → byte
    const clean = tokens.replace(/[^0-9a-fA-F]/g, "");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  test("descriptor + 2 letterali + terminatore", () => {
    // descriptor u16 LE: bit consumati LSB-prima.
    // token: 1 (lit 0xAA), 1 (lit 0xBB), 0 1 (sep) 00 00 00 (terminatore)
    // bit in ordine: [1,1,0,1, poi 0 di padding] → LSB-prima: bit0=1,bit1=1,bit2=0,bit3=1
    // value = 1 | 1<<1 | 0<<2 | 1<<3 = 0x0B → LE: 0B 00
    const out = kosinskiDecompress(buildStream("0B 00 AA BB 00 00 00"));
    expect(Array.from(out)).toEqual([0xaa, 0xbb]);
  });

  test("dizionario inline: 2 letterali + backreference 4 byte dist 1 (RLE overlap)", () => {
    // token: lit(0x42), lit(0x42), inline count=3 (bit 2bit=1,1 → ((1<<1)|1)=3 → count 5? no:
    // ((High<<1)|Low)+2: per count=4 → (H<<1|L)=2 → H=1,L=0 → bit seq 1,0
    // bit: lit(1) lit(1) inline(0,0) H(1) L(0) sep-term(0,1) + padding
    // ordine bit: [1,1,0,0,1,0,0,1] → value = bit0..bit7: 1+2+0+0+16+0+0+128 = 0x93
    // dist byte: 0x100-1 = 0xFF
    const out = kosinskiDecompress(buildStream("93 00 42 42 FF 00 00 00"));
    // 2 letterali + 4 copie del byte a dist 1 → 0x42 × 6
    expect(Array.from(out)).toEqual([0x42, 0x42, 0x42, 0x42, 0x42, 0x42]);
  });

  test("dizionario separato 2 byte: count 5, dist 3", () => {
    // lit ×3 (0x11 0x22 0x33), poi sep: High = (5-2)|dist, Low
    // dist = 3 → stored = 0x2000-3 = 0x1FFD → High bit3-7 = (0x1FFD>>5)&0xF8 = 0xFF&0xF8? 0x1FFD>>5 = 0xFF (0x1FFD>>5 = 255.9→255=0xFF) &0xF8 = 0xF8; Low = 0xFD
    // High = 3 | 0xF8 = 0xFB
    // bit: 1,1,1, 0,1(SEP), 0,1(term): 1+2+4+16+64 = 0x57
    // value = 1+2+4+0+16 = 0x17
    const out = kosinskiDecompress(buildStream("57 00 11 22 33 FD FB 00 00 00"));
    expect(Array.from(out)).toEqual([0x11, 0x22, 0x33, 0x11, 0x22, 0x33, 0x11, 0x22]); // 3 letterali + 5 copie a dist 3
  });

  test("terminatore seguito da dati ignorato onestamente", () => {
    const out = kosinskiDecompress(buildStream("0B 00 AA BB 00 00 00 FF FF FF FF"));
    expect(Array.from(out)).toEqual([0xaa, 0xbb]);
  });

  test("distanza invalida → errore esplicito, niente crash", () => {
    // inline con dist 2 ma 0 byte prodotti
    expect(() => kosinskiDecompress(buildStream("01 00 FE"))).toThrow(/invalida|troncato/);
  });
});

describe("kosinskiCompress (round-trip reale)", () => {
  test("round-trip su dati con ripetizioni (caso layout livelli)", () => {
    const data = new Uint8Array(3000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 3 === 0 ? 0xaa : (i * 13) & 0xff;
    const comp = kosinskiCompress(data);
    const back = kosinskiDecompress(comp);
    expect(Buffer.from(back).equals(Buffer.from(data))).toBe(true);
  });

  test("round-trip su run RLE lungo (> 9 byte: percorso separato 3 byte)", () => {
    const data = new Uint8Array(500);
    data.fill(0x77, 0, 400);
    for (let i = 400; i < 500; i++) data[i] = i & 0xff;
    const back = kosinskiDecompress(kosinskiCompress(data));
    expect(Buffer.from(back).equals(Buffer.from(data))).toBe(true);
  });

  test("round-trip su entropia alta (tutti letterali)", () => {
    let s = 0x9e3779b9;
    const data = new Uint8Array(500);
    for (let i = 0; i < data.length; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; data[i] = s & 0xff; }
    const back = kosinskiDecompress(kosinskiCompress(data));
    expect(Buffer.from(back).equals(Buffer.from(data))).toBe(true);
  });

  test("compressione reale: i dati ripetitivi si comprimono sul serio", () => {
    const data = new Uint8Array(2000).fill(0x11);
    expect(kosinskiCompress(data).length).toBeLessThan(100);
  });

  test("input vuoto e da 1 byte", () => {
    expect(kosinskiDecompress(kosinskiCompress(new Uint8Array(0))).length).toBe(0);
    const one = new Uint8Array([0x5a]);
    expect(Buffer.from(kosinskiDecompress(kosinskiCompress(one))).equals(Buffer.from(one))).toBe(true);
  });
});
