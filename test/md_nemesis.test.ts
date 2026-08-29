import { describe, expect, test } from "bun:test";
import { nemesisDecompress } from "../src/md_nemesis";

/**
 * Vettori costruiti a mano secondo l'algoritmo trascritto (niente round-trip:
 * l'encoder non esiste, quindi i test partono da stream costruiti byte per
 * byte secondo la specifica).
 */

describe("nemesisDecompress", () => {
  test("run codificato: 2 tile di nibble 5 tramite codice a 2 bit", () => {
    // header: rtiles=2 (0x0002, alt=0)
    // tabella: 0x85 (nibble 5) + 0x12 (count=2, len=2) + code 0x02 + 0xFF
    // stream: 64 volte il codice 0b10 → bit [1,0] ripetuti, LSB-first → byte 0x55
    const stream = new Uint8Array([0x00, 0x02, 0x85, 0x12, 0x02, 0xff, ...Array(16).fill(0x55)]);
    const out = nemesisDecompress(stream);
    expect(out.length).toBe(64); // 2 tile × 32 byte
    expect(out.every((b) => b === 0x55)).toBe(true); // coppie di nibble 5
  });

  test("RLE inline (pattern 111111): conteggio e nibble dallo stream", () => {
    // rtiles=1 (32 byte = 64 nibble)
    // stream: 111111 (inline) + cnt-1=7 (111) + nibble 0xA (1010)
    // → 8 nibble A = 4 byte 0xAA; serve ancora 60 nibble: di nuovo inline
    // con cnt-1=7 nibble A... costruiamo: 2 inline run da 8 = 16 nibble,
    // poi 48 nibble via un terzo run da... max cnt inline = 8. Usiamo 8 run
    // da 8 nibble = 64 ✓
    const bits: number[] = [];
    for (let r = 0; r < 8; r++) {
      bits.push(1, 1, 1, 1, 1, 1); // pattern inline
      bits.push(1, 1, 1);          // cnt-1 = 7 → 8 nibble
      bits.push(1, 0, 1, 0);       // nibble A (MSB-first field)
    }
    // pack LSB-first
    const bytes: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b |= (bits[i + j] ?? 0) << j;
      bytes.push(b);
    }
    const stream = new Uint8Array([0x00, 0x01, 0xff, ...bytes]);
    const out = nemesisDecompress(stream);
    expect(out.length).toBe(32);
    expect(out.every((b) => b === 0xaa)).toBe(true);
  });

  test("modalità alternating (bit 15): XOR progressivo delle word LE", () => {
    // come il primo test ma con alt: rtiles = 0x8002
    const stream = new Uint8Array([0x80, 0x02, 0x85, 0x12, 0x02, 0xff, ...Array(16).fill(0x55)]);
    const out = nemesisDecompress(stream);
    expect(out.length).toBe(64);
    // raw interno: tutte word 0x55555555; XOR progressivo: w, w^w=0, w, 0...
    // → parole alternate 0x55555555 e 00000000 (little-endian nei byte)
    for (let w = 0; w < 16; w++) {
      const fill = w % 2 === 0 ? 0x55 : 0x00;
      expect(out.slice(w * 4, w * 4 + 4).every((b) => b === fill)).toBe(true);
    }

  });

  test("header con 0 tile → errore esplicito", () => {
    expect(() => nemesisDecompress(new Uint8Array([0x00, 0x00, 0xff]))).toThrow(/0 tile/);
  });

  test("stream corrotto (nessun codice valido) → errore onesto", () => {
    // codice che non esiste in tabella, bit tutti 0 → len cresce fino a 8
    const stream = new Uint8Array([0x00, 0x01, 0x85, 0x12, 0x02, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(() => nemesisDecompress(stream)).toThrow(/corrotto|troncato/);
  });

  test("dimensione multipla tile: 4 tile = 128 byte", () => {
    // 256 nibble da run(5,2): 128 codici a 2 bit = 256 bit = 32 byte 0x55
    const stream = new Uint8Array([0x00, 0x04, 0x85, 0x12, 0x02, 0xff, ...Array(32).fill(0x55)]);
    const out = nemesisDecompress(stream);
    expect(out.length).toBe(128);
    expect(out.every((b) => b === 0x55)).toBe(true);
  });
});
