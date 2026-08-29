import { describe, expect, test } from "bun:test";
import { decodeN64Texture } from "../src/n64_texture";
import { encodeN64Texture } from "../src/n64_texture_encode";
import { nemesisCompress, nemesisDecompress } from "../src/md_nemesis";

// colori nell'immagine ESATTA dell'espansione del decoder round(v5*255/31):
// encode tronca v8>>3 e il decode espande: round-trip perfetto per costruzione
const exp5 = (v: number) => Math.round((v / 31) * 255);
const COLORS_5BIT = [
  [exp5(0), 0, 0, 255], [exp5(31), 0, 0, 255], [0, exp5(31), 0, 255],
  [0, 0, exp5(31), 255], [exp5(31), exp5(31), exp5(31), 0],
  [exp5(3), exp5(15), exp5(7), 255], [exp5(25), exp5(5), exp5(1), 0], [exp5(17), exp5(25), exp5(21), 255],
];

describe("encodeN64Texture (round-trip decode(encode(x)) == x)", () => {
  function buildRgba(colors: number[][]): Uint8Array {
    const out = new Uint8Array(colors.length * 4);
    colors.forEach((c, i) => out.set(c, i * 4));
    return out;
  }

  test("RGBA32: round-trip esatto byte-per-byte", () => {
    const rgba = buildRgba(COLORS_5BIT);
    const enc = encodeN64Texture(rgba, 8, 1, "RGBA32");
    const dec = decodeN64Texture(enc.data, 8, 1, "RGBA32");
    expect(Buffer.from(dec.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  test("RGBA16: round-trip esatto su colori 5-5-5-1 rappresentabili", () => {
    const rgba = buildRgba(COLORS_5BIT);
    const enc = encodeN64Texture(rgba, 8, 1, "RGBA16");
    const dec = decodeN64Texture(enc.data, 8, 1, "RGBA16");
    expect(Buffer.from(dec.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  test("IA16: il round-trip preserva intensità e alpha (grigio + alpha)", () => {
    const gray = [200, 200, 200, 128];
    const rgba = buildRgba([gray, gray]);
    const dec = decodeN64Texture(encodeN64Texture(rgba, 2, 1, "IA16").data, 2, 1, "IA16");
    expect(Array.from(dec.rgba.slice(0, 4))).toEqual([200, 200, 200, 128]);
  });

  test("CI8: round-trip esatto con palette di colori RGBA16 rappresentabili", () => {
    const colors = COLORS_5BIT.map(c => c);
    const rgba = buildRgba([...colors, ...colors]); // 16 pixel, 8 colori
    const enc = encodeN64Texture(rgba, 16, 1, "CI8");
    const dec = decodeN64Texture(enc.data, 16, 1, "CI8", enc.palette);
    expect(Buffer.from(dec.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  test("CI4: max 16 colori rispettato, oltre → errore esplicito", () => {
    const colors17 = Array.from({ length: 17 }, (_, i) => [exp5(i % 32), 0, 0, 255] as number[]);
    const rgba = buildRgba(colors17);
    expect(() => encodeN64Texture(rgba, 17, 1, "CI4")).toThrow(/più di 16 colori/);
    // con 16 colori ok
    const enc = encodeN64Texture(buildRgba(colors17.slice(0, 16)), 16, 1, "CI4");
    const dec = decodeN64Texture(enc.data, 16, 1, "CI4", enc.palette);
    expect(Buffer.from(dec.rgba).equals(Buffer.from(buildRgba(colors17.slice(0, 16))))).toBe(true);
  });

  test("RGBA insufficienti → errore onesto", () => {
    expect(() => encodeN64Texture(new Uint8Array(4), 4, 4, "RGBA16")).toThrow(/insufficienti/);
  });
});

describe("nemesis encoder end-to-end con il decoder (ulteriore)", () => {
  test("art mista 1024 byte", () => {
    const data = new Uint8Array(1024);
    for (let t = 0; t < 32; t++) {
      const base = t * 32;
      for (let j = 0; j < 32; j++) data[base + j] = j < 16 ? ((t * 17) & 0xff) : ((j % 4) * 0x44 & 0xff);
    }
    expect(Buffer.from(nemesisDecompress(nemesisCompress(data))).equals(Buffer.from(data))).toBe(true);
  });
});
