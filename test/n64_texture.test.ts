import { describe, test, expect } from "bun:test";
import { decodeN64Texture, requiredByteLength } from "../src/n64_texture";

/**
 * Test reali per il decoder texture N64 (src/n64_texture.ts), con texture
 * sintetiche 2x2 e valori attesi calcolati a mano secondo le formule
 * documentate nel modulo (RGBA16: 5/5/5/1, IA8: intensità/alpha a 4 bit,
 * CI4: indice a 4 bit su palette RGBA16).
 */

describe("requiredByteLength", () => {
  test("calcola correttamente la dimensione per ogni formato su una texture 2x2", () => {
    expect(requiredByteLength(2, 2, "RGBA16")).toBe(8); // 4 px * 16 bit = 8 byte
    expect(requiredByteLength(2, 2, "RGBA32")).toBe(16); // 4 px * 32 bit = 16 byte
    expect(requiredByteLength(2, 2, "IA8")).toBe(4); // 4 px * 8 bit = 4 byte
    expect(requiredByteLength(2, 2, "IA4")).toBe(2); // 4 px * 4 bit = 2 byte (arrotondato)
    expect(requiredByteLength(2, 2, "CI4")).toBe(2); // 4 px * 4 bit = 2 byte
  });
});

describe("decodeN64Texture — RGBA16", () => {
  test("decodifica correttamente 4 pixel 2x2, canali 5/5/5/1 scalati a 8 bit", () => {
    // Pixel0: r5=31 g5=0  b5=0  a1=1 -> bytes [0xF8, 0x01]
    // Pixel1: r5=0  g5=31 b5=0  a1=1 -> bytes [0x07, 0xC1]
    // Pixel2: r5=0  g5=0  b5=31 a1=0 -> bytes [0x00, 0x3E]
    // Pixel3: r5=15 g5=15 b5=15 a1=1 -> bytes [0x7B, 0xDF]
    const data = new Uint8Array([
      0xf8, 0x01,
      0x07, 0xc1,
      0x00, 0x3e,
      0x7b, 0xdf
    ]);
    const tex = decodeN64Texture(data, 2, 2, "RGBA16");
    expect(tex.width).toBe(2);
    expect(tex.height).toBe(2);

    // Pixel0: rosso pieno, alpha piena
    expect([...tex.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    // Pixel1: verde pieno, alpha piena
    expect([...tex.rgba.slice(4, 8)]).toEqual([0, 255, 0, 255]);
    // Pixel2: blu pieno, alpha trasparente (a1=0 -> alpha 0)
    expect([...tex.rgba.slice(8, 12)]).toEqual([0, 0, 255, 0]);
    // Pixel3: grigio a metà (15/31 scalato a 8 bit = round(15/31*255) = 123)
    expect([...tex.rgba.slice(12, 16)]).toEqual([123, 123, 123, 255]);
  });
});

describe("decodeN64Texture — IA8", () => {
  test("decodifica intensità/alpha a 4+4 bit scalati a 8 bit", () => {
    // byte0 = 0xF0 -> intensity4=15 (->255), alpha4=0  (->0)
    // byte1 = 0x0F -> intensity4=0  (->0),   alpha4=15 (->255)
    // byte2 = 0xFF -> intensity4=15 (->255), alpha4=15 (->255)
    // byte3 = 0x88 -> intensity4=8  (->round(8/15*255)=136), alpha4=8 (->136)
    const data = new Uint8Array([0xf0, 0x0f, 0xff, 0x88]);
    const tex = decodeN64Texture(data, 2, 2, "IA8");

    expect([...tex.rgba.slice(0, 4)]).toEqual([255, 255, 255, 0]);
    expect([...tex.rgba.slice(4, 8)]).toEqual([0, 0, 0, 255]);
    expect([...tex.rgba.slice(8, 12)]).toEqual([255, 255, 255, 255]);
    expect([...tex.rgba.slice(12, 16)]).toEqual([136, 136, 136, 136]);
  });
});

describe("decodeN64Texture — CI4", () => {
  test("decodifica indici a 4 bit risolti su una palette RGBA16 reale", () => {
    // Palette: entry0 = rosso pieno (r5=31,g5=0,b5=0,a1=1) -> [0xF8, 0x01]
    //          entry1 = verde pieno (r5=0,g5=31,b5=0,a1=1) -> [0x07, 0xC1]
    const palette = new Uint8Array(32); // 16 entry RGBA16
    palette[0] = 0xf8; palette[1] = 0x01; // entry 0 = rosso
    palette[2] = 0x07; palette[3] = 0xc1; // entry 1 = verde

    // 4 pixel, indici: 0,1,1,0 -> nibble alto = pixel pari, nibble basso = pixel dispari
    // byte0 = (0<<4)|1 = 0x01 (pixel0=indice0, pixel1=indice1)
    // byte1 = (1<<4)|0 = 0x10 (pixel2=indice1, pixel3=indice0)
    const data = new Uint8Array([0x01, 0x10]);
    const tex = decodeN64Texture(data, 2, 2, "CI4", palette);

    expect([...tex.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]); // pixel0 = rosso
    expect([...tex.rgba.slice(4, 8)]).toEqual([0, 255, 0, 255]); // pixel1 = verde
    expect([...tex.rgba.slice(8, 12)]).toEqual([0, 255, 0, 255]); // pixel2 = verde
    expect([...tex.rgba.slice(12, 16)]).toEqual([255, 0, 0, 255]); // pixel3 = rosso
  });

  test("lancia un errore esplicito se manca la palette", () => {
    const data = new Uint8Array([0x01, 0x10]);
    expect(() => decodeN64Texture(data, 2, 2, "CI4")).toThrow();
  });
});
