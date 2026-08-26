import { describe, test, expect } from "bun:test";
import { isMio0, mio0Decompress, mio0CompressForTesting } from "../src/n64_mio0";

describe("isMio0", () => {
  test("riconosce il magic 'MIO0' reale", () => {
    const block = new Uint8Array(16);
    block.set([0x4d, 0x49, 0x4f, 0x30], 0); // "MIO0"
    expect(isMio0(block)).toBe(true);
  });

  test("rifiuta un buffer troppo corto o senza magic", () => {
    expect(isMio0(new Uint8Array(4))).toBe(false);
    expect(isMio0(new Uint8Array(20))).toBe(false); // tutti zeri, nessun magic
  });
});

describe("mio0Decompress", () => {
  test("lancia un errore onesto se il magic manca", () => {
    expect(() => mio0Decompress(new Uint8Array(16))).toThrow();
  });

  test("round-trip reale compressione->decompressione su dati sintetici ripetitivi", () => {
    const original = new Uint8Array(64);
    for (let i = 0; i < original.length; i++) original[i] = i % 4; // pattern altamente ripetitivo, forza backreference
    const compressed = mio0CompressForTesting(original);
    expect(isMio0(compressed)).toBe(true);
    const decompressed = mio0Decompress(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(original));
  });

  test("round-trip su dati puramente casuali (nessuna backreference possibile, solo letterali)", () => {
    const original = new Uint8Array(40);
    // pattern pseudo-casuale deterministico, non ripetitivo entro la finestra
    for (let i = 0; i < original.length; i++) original[i] = (i * 37 + 11) % 251;
    const compressed = mio0CompressForTesting(original);
    const decompressed = mio0Decompress(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(original));
  });

  test("round-trip su buffer vuoto", () => {
    const original = new Uint8Array(0);
    const compressed = mio0CompressForTesting(original);
    const decompressed = mio0Decompress(compressed);
    expect(decompressed.length).toBe(0);
  });

  test("round-trip su un singolo byte ripetuto molte volte (caso RLE estremo)", () => {
    const original = new Uint8Array(200).fill(0xab);
    const compressed = mio0CompressForTesting(original);
    const decompressed = mio0Decompress(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(original));
  });

  test("header decodificato correttamente: layout big-endian a 16 byte", () => {
    // Costruisce un blocco MIO0 minimale a mano: 4 byte letterali, nessuna
    // backreference. layout bitstream: 4 bit a 1 (tutti letterali), padding a 0.
    const literalBytes = [0x11, 0x22, 0x33, 0x44];
    const layoutByte = 0b11110000; // 4 bit letterali seguiti da padding
    const headerLen = 16;
    const compOffset = headerLen + 1; // 1 byte di layout, nessun token compresso
    const uncompOffset = compOffset; // sezione compressa vuota
    const block = new Uint8Array(headerLen + 1 + literalBytes.length);
    const view = new DataView(block.buffer);
    block.set([0x4d, 0x49, 0x4f, 0x30], 0);
    view.setUint32(4, literalBytes.length, false);
    view.setUint32(8, compOffset, false);
    view.setUint32(12, uncompOffset, false);
    block[16] = layoutByte;
    block.set(literalBytes, uncompOffset);

    const out = mio0Decompress(block);
    expect(Array.from(out)).toEqual(literalBytes);
  });

  test("backreference esplicita costruita a mano: lunghezza e distanza secondo la formula documentata", () => {
    // formula: length = (b0>>4)+3, distance = (((b0&0xF)<<8)+b1)+1
    // Costruiamo: 3 byte letterali "A","B","C", poi un token compresso che
    // ripete "ABC" con length=3, distance=3 (torna all'inizio del buffer).
    const literalsBefore = [0x41, 0x42, 0x43]; // "ABC"
    const length = 3;
    const distance = 3;
    const b0 = ((length - 3) << 4) | ((distance - 1) >> 8);
    const b1 = (distance - 1) & 0xff;

    const headerLen = 16;
    // layout: 1,1,1 (letterali A,B,C) poi 0 (token compresso) -> bits: 1110 0000
    const layoutByte = 0b11100000;
    const compOffset = headerLen + 1;
    const uncompOffset = compOffset + 2; // 2 byte per il token compresso

    const decompressedSize = literalsBefore.length + length;
    const block = new Uint8Array(uncompOffset + literalsBefore.length);
    const view = new DataView(block.buffer);
    block.set([0x4d, 0x49, 0x4f, 0x30], 0);
    view.setUint32(4, decompressedSize, false);
    view.setUint32(8, compOffset, false);
    view.setUint32(12, uncompOffset, false);
    block[16] = layoutByte;
    block[compOffset] = b0;
    block[compOffset + 1] = b1;
    block.set(literalsBefore, uncompOffset);

    const out = mio0Decompress(block);
    // "ABC" + backreference a distanza 3 di lunghezza 3 => ripete "ABC"
    expect(Array.from(out)).toEqual([0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
  });
});
