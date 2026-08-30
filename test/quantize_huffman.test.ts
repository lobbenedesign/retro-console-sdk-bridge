import { describe, expect, test } from "bun:test";
import { quantizeRgba16, encodeN64Texture } from "../src/n64_texture_encode";
import { decodeN64Texture } from "../src/n64_texture";
import { nemesisCompress, nemesisCompressOptimal, nemesisDecompress } from "../src/md_nemesis";

const exp5 = (v: number) => Math.round((v / 31) * 255);

describe("quantizeRgba16 (median-cut)", () => {
  test("≤ max colori: lossless (ritorna i byte identici)", () => {
    const rgba = new Uint8Array(16 * 4);
    for (let i = 0; i < 16; i++) { rgba[i * 4] = exp5(i); rgba[i * 4 + 1] = exp5(15 - i); rgba[i * 4 + 2] = exp5(i * 2); rgba[i * 4 + 3] = 255; }
    expect(Buffer.from(quantizeRgba16(rgba, 16)).equals(Buffer.from(rgba))).toBe(true);
  });

  test("oltre i colori massimi: riduce esattamente a maxColors", () => {
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { rgba[i * 4] = exp5(i & 0x1f); rgba[i * 4 + 1] = exp5((i * 3) & 0x1f); rgba[i * 4 + 2] = exp5((i * 7) & 0x1f); rgba[i * 4 + 3] = 255; }
    const q = quantizeRgba16(rgba, 16);
    const uni = new Set<string>();
    for (let i = 0; i < 256; i++) uni.add(q.slice(i * 4, i * 4 + 4).join(","));
    expect(uni.size).toBeLessThanOrEqual(16);
  });

  test("CI8 con quantize: 256+ colori ora encodabili (prima: errore onesto)", () => {
    const rgba = new Uint8Array(300 * 4);
    for (let i = 0; i < 300; i++) { rgba[i * 4] = exp5(i & 0x1f); rgba[i * 4 + 1] = exp5((i >> 3) & 0x1f); rgba[i * 4 + 2] = exp5((i >> 4) & 0x1f); rgba[i * 4 + 3] = 255; }
    // senza quantize: errore oltre 256
    expect(() => encodeN64Texture(rgba, 300, 1, "CI8")).toThrow(/più di 256 colori/);
    // con quantize: encoda e decodifica senza errori
    const enc = encodeN64Texture(rgba, 300, 1, "CI8", { quantize: true });
    const dec = decodeN64Texture(enc.data, 300, 1, "CI8", enc.palette);
    expect(dec.rgba.length).toBe(300 * 4);
  });
});

describe("nemesisCompressOptimal (Huffman + vincolo 111111)", () => {
  test("art con frequenze sbilanciate: batte la lunghezza fissa", () => {
    const data = new Uint8Array(3200);
    for (let i = 0; i < 3200; i++) data[i] = i % 7 === 0 ? 0xff : (i % 3);
    const fixed = nemesisCompress(data);
    const opt = nemesisCompressOptimal(data);
    expect(opt.length).toBeLessThan(fixed.length);
    expect(Buffer.from(nemesisDecompress(opt)).equals(Buffer.from(data))).toBe(true);
  });

  test("round-trip su dati random (fallback o huffman: sempre esatto)", () => {
    let s = 42;
    const rnd = new Uint8Array(2048);
    for (let i = 0; i < 2048; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; rnd[i] = s & 0xff; }
    expect(Buffer.from(nemesisDecompress(nemesisCompressOptimal(rnd))).equals(Buffer.from(rnd))).toBe(true);
  });

  test("round-trip su casi limite: 1 tile, un solo colore, tutti i 16 nibble", () => {
    const cases = [
      new Uint8Array(32).fill(0xab),
      Uint8Array.from(Array.from({ length: 64 }, (_, i) => (i * 17) & 0xff)),
    ];
    for (const c of cases) {
      expect(Buffer.from(nemesisDecompress(nemesisCompressOptimal(c))).equals(Buffer.from(c))).toBe(true);
    }
  });
});
