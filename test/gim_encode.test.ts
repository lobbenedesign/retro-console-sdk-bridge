import { describe, expect, test } from "bun:test";
import { encodeGim, type GimFormat } from "../src/psp_gim_encode";
import { decodeGim } from "../src/psp_gim";

const COLORS = [0xff0000ff, 0x00ff0080, 0x0000ffff, 0xffffffff]; // RGBA8888 word LE-ish
function buildRgba(colors: number[], repeat = 1): Uint8Array {
  const out = new Uint8Array(colors.length * repeat * 4);
  let i = 0;
  for (let r = 0; r < repeat; r++) for (const c of colors) {
    out[i++] = (c >>> 24) & 0xff; out[i++] = (c >>> 16) & 0xff; out[i++] = (c >>> 8) & 0xff; out[i++] = c & 0xff;
  }
  return out;
}

describe("encodeGim (round-trip col decoder)", () => {
  test("RGBA8888: byte-identico", () => {
    const rgba = buildRgba(COLORS, 4);
    const e = encodeGim(rgba, 8, 2, "RGBA8888");
    const d = decodeGim(e.gim);
    expect(Buffer.from(d.rgba).equals(Buffer.from(rgba))).toBe(true);
    expect(d.format).toBe("RGBA8888");
  });

  test("RGBA5650: esatto su colori 5-6-5 rappresentabili", () => {
    const c5 = (v: number) => Math.round((v / 31) * 255);
    const c6 = (v: number) => Math.round((v / 63) * 255);
    const rgba = new Uint8Array([c5(31), 0, 0, 255, 0, c6(63), 0, 255, 0, 0, c5(31), 255, c5(17), c6(40), c5(9), 255]);
    const d = decodeGim(encodeGim(rgba, 4, 1, "RGBA5650").gim);
    expect(Buffer.from(d.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  test("P8 + palette: esatto (≤256 colori)", () => {
    const rgba = buildRgba(COLORS, 3);
    const d = decodeGim(encodeGim(rgba, 12, 1, "P8").gim);
    expect(Buffer.from(d.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  test("P4: max 16 colori, oltre → errore onesto; entro → esatto", () => {
    const many = buildRgba(Array.from({ length: 17 }, (_, i) => ((i * 40) << 24) | 0xff));
    expect(() => encodeGim(many, 17, 1, "P4")).toThrow(/più di 16 colori/);
    const few = buildRgba(COLORS, 4);
    const d = decodeGim(encodeGim(few, 8, 2, "P4").gim);
    expect(Buffer.from(d.rgba).equals(Buffer.from(few))).toBe(true);
  });

  test("P4 con numero DISPARI di pixel (nibble finale spaiato)", () => {
    const rgba = buildRgba(COLORS.slice(0, 3));
    const d = decodeGim(encodeGim(rgba, 3, 1, "P4").gim);
    expect(Buffer.from(d.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  test("RGBA insufficienti → errore onesto", () => {
    expect(() => encodeGim(new Uint8Array(4), 4, 4, "RGBA8888" as GimFormat)).toThrow(/insufficienti/);
  });
});
