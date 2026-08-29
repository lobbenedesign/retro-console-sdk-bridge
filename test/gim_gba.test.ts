import { describe, expect, test } from "bun:test";
import { decodeGim, isGim } from "../src/psp_gim";
import { parseGbaRomHeader, fixGbaComplement, gbaComplement } from "../src/gba_rom_header";
import { identifyConsole } from "../src/rom_identify";

// ---------------------------------------------------------------------------
// GIM sintetici costruiti secondo la struttura del formato
// ---------------------------------------------------------------------------

/** Scrive un blocco GIM (header 20 byte + contenuto) e ritorna i byte. */
function block(type: number, content: Uint8Array, next: number): Uint8Array {
  const h = new Uint8Array(20);
  const dv = new DataView(h.buffer);
  dv.setUint16(0, type, false);
  dv.setUint16(2, 0, false);
  dv.setUint32(4, 20 + content.length, false);
  dv.setUint32(8, next, false);
  dv.setUint32(12, 20, false);
  return Buffer.concat([h, content]);
}

/** Blocco image/palette (struttura 0x30) con frame data a seguire. */
function imageBlock(opts: {
  format: number; width: number; height: number; bpp: number;
  frameData: Uint8Array; pixelOrder?: number; pitchAlign?: number;
}): { block: Uint8Array } {
  const st = new Uint8Array(0x30);
  const dv = new DataView(st.buffer);
  dv.setUint16(0, 0x30, false);
  dv.setUint16(4, opts.format, false);
  dv.setUint16(6, opts.pixelOrder ?? 0, false);
  dv.setUint16(8, opts.width, false);
  dv.setUint16(10, opts.height, false);
  dv.setUint16(12, opts.bpp, false);
  dv.setUint16(14, opts.pitchAlign ?? 1, false);
  dv.setUint32(20, 0x30, false); // next_index_block relativo al contenuto
  dv.setUint32(24, 0x30 + 4, false); // frame_data_start
  dv.setUint32(28, 0x30 + 4 + opts.frameData.length, false); // frame_data_end
  dv.setUint16(40, 1, false); // frame_count
  const frameOffset = Buffer.alloc(4);
  new DataView(frameOffset.buffer).setUint32(0, 0x30 + 4, false);
  return { block: Buffer.concat([st, frameOffset, opts.frameData]) };
}

function gimHeader(): Uint8Array {
  // 16 byte: "GIM." "1.00" "PSP" 0x00000000 (tutti byte magico: ordine ok per il detector u32)
  return Buffer.concat([
    Buffer.from("GIM."), Buffer.from("1.00"), Buffer.from("PSP\0"), new Uint8Array(4),
  ]);
}

function buildGim(image: { block: Uint8Array }, palette?: { block: Uint8Array }): Uint8Array {
  // root(2) → picture(3) → [image(4), palette(5)]
  // struttura semplice: root → picture → image → [palette] → fine
  const parts: Uint8Array[] = [gimHeader()];
  const rootContent = new Uint8Array(0);
  const picContent = new Uint8Array(0);
  // calcolo offset: header16 + root(20) + picture(20) + image(blen) + [palette]
  const imageLen = image.block.length;
  const paletteLen = palette ? 20 + palette.block.length : 0;
  // root next = 20 (a picture), picture next = 20 (a image)
  // image next = imageLen (a palette se c'è, altrimenti 0)
  const root = block(2, rootContent, 20);
  const pic = block(3, picContent, 20);
  const img = block(4, image.block, palette ? 20 + imageLen : 0);
  parts.push(root, pic, img);
  if (palette) parts.push(block(5, palette.block, 0));
  return Buffer.concat(parts);
}

describe("decodeGim (formati GE PSP)", () => {
  test("RGBA8888: 2x2 con colori noti decodificati correttamente", () => {
    // pixel LE u32: (r<<24)|(g<<16)|(b<<8)|a — come lo scrive il decoder
    const px = Buffer.alloc(2 * 2 * 4);
    const colors = [0xff0000ff, 0x00ff0080, 0x0000ffff, 0xffffffff]; // rosso, verde semitrasp, blu, bianco
    colors.forEach((c, i) => px.writeUInt32LE(c >>> 0, i * 4));
    const img = imageBlock({ format: 3, width: 2, height: 2, bpp: 32, frameData: px });
    const gim = buildGim(img);
    const out = decodeGim(gim);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(Array.from(out.rgba.slice(0, 4))).toEqual([0xff, 0, 0, 0xff]);
    expect(Array.from(out.rgba.slice(4, 8))).toEqual([0, 0xff, 0, 0x80]);
    expect(Array.from(out.rgba.slice(12, 16))).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  test("RGBA5650: conversione 5-6-5 → 8-8-8", () => {
    // rosso pieno 565: r=0x1F<<11 = 0xF800
    const px = Buffer.alloc(2 * 2 * 2); // 4 pixel × 2 byte
    for (let i = 0; i < 4; i++) px.writeUInt16LE(0xf800, i * 2);
    const out = decodeGim(buildGim(imageBlock({ format: 0, width: 2, height: 2, bpp: 16, frameData: px })));
    expect(Array.from(out.rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  test("P8 + palette RGBA8888: indicizzato risolto coi colori della palette", () => {
    // palette: 2 colori 8888
    const palPx = Buffer.alloc(2 * 4);
    palPx.writeUInt32LE(0xff0000ff, 0); // idx0 rosso
    palPx.writeUInt32LE(0x00ff00ff, 4); // idx1 verde
    const pal = imageBlock({ format: 3, width: 2, height: 1, bpp: 32, frameData: palPx });
    // immagine 2x2 P8 con indici 0,1,1,0
    const idx = Uint8Array.from([0, 1, 1, 0]);
    const img = imageBlock({ format: 5, width: 2, height: 2, bpp: 8, frameData: idx });
    const out = decodeGim(buildGim(img, pal));
    expect(Array.from(out.rgba.slice(0, 4))).toEqual([0xff, 0, 0, 0xff]);
    expect(Array.from(out.rgba.slice(4, 8))).toEqual([0, 0xff, 0, 0xff]);
    expect(Array.from(out.rgba.slice(12, 16))).toEqual([0xff, 0, 0, 0xff]);
  });

  test("DXT1 → rifiuto onesto", () => {
    const img = imageBlock({ format: 8, width: 2, height: 2, bpp: 32, frameData: new Uint8Array(16) });
    expect(() => decodeGim(buildGim(img))).toThrow(/non supportato onestamente|Conversione colore/);
  });

  test("isGim riconosce il magic", () => {
    expect(isGim(gimHeader())).toBe(true);
    expect(isGim(new Uint8Array(32))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GBA
// ---------------------------------------------------------------------------

function buildGbaRom(title: string, code: string, goodComplement: boolean): Uint8Array {
  const rom = new Uint8Array(0x200);
  rom.set([0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21], 0x04); // logo
  rom.set(new TextEncoder().encode(title.padEnd(12, " ")), 0xa0);
  rom.set(new TextEncoder().encode(code), 0xac);
  rom.set(new TextEncoder().encode("01"), 0xb0); // maker
  rom[0xb2] = 0x96;
  rom[0xbc] = 0; // versione
  if (goodComplement) rom[0xbd] = gbaComplement(rom);
  else rom[0xbd] = 0x00;
  return rom;
}

describe("parseGbaRomHeader (layout GBATEK)", () => {
  test("titolo, codici, 0x96, unit rilevati", () => {
    const h = parseGbaRomHeader(buildGbaRom("MARIOKART", "AMKP", true));
    expect(h.logoValid).toBe(true);
    expect(h.title).toBe("MARIOKART");
    expect(h.gameCode).toBe("AMKP");
    expect(h.makerCode).toBe("01");
    expect(h.fixed96).toBe(true);
    expect(h.unitCode).toBe("GBA");
    expect(h.complementValid).toBe(true);
  });

  test("complement sbagliato rilevato, un byte cambia il calcolo", () => {
    const h = parseGbaRomHeader(buildGbaRom("MARIOKART", "AMKP", false));
    expect(h.complementValid).toBe(false);
    const rom = buildGbaRom("MARIOKART", "AMKP", true);
    rom[0xa5] ^= 1;
    expect(parseGbaRomHeader(rom).complementValid).toBe(false);
  });

  test("fix: riscrive 0xBD e la ROM torna valida (input non mutato)", () => {
    const rom = buildGbaRom("TEST", "ATEX", false);
    const snap = Buffer.from(rom).toString("base64");
    const { rom: fixed } = fixGbaComplement(rom);
    expect(Buffer.from(rom).toString("base64")).toBe(snap); // copia difensiva
    expect(parseGbaRomHeader(fixed).complementValid).toBe(true);
  });

  test("formula identica a gbafix (devkitPro): complement = -(0x19 + somma(0xA0..0xBC))", () => {
    // verifica indipendente trascritta da devkitPro/gba-tools src/gbafix.c
    const rom = buildGbaRom("CHECK", "ACHK", true);
    let sum = 0;
    for (let i = 0xa0; i < 0xbd; i++) sum = (sum + rom[i]) & 0xff;
    const gbafixValue = (-(0x19 + sum)) & 0xff;
    expect(rom[0xbd]).toBe(gbafixValue);
    expect(gbaComplement(rom)).toBe(gbafixValue);
  });

  test("ROM troppo corta → errore onesto", () => {
    expect(() => parseGbaRomHeader(new Uint8Array(16))).toThrow(/troppo corta/);
  });
});

describe("identificazione ~PSP (modulo cifrato)", () => {
  test("firma ~PSP riconosciuta con avviso di cifratura onesto", () => {
    const mod = new Uint8Array(64);
    mod.set([0x7e, 0x50, 0x53, 0x50], 0);
    const r = identifyConsole(mod);
    expect(r.console).toBe("Sony PlayStation Portable");
    expect(r.format).toContain("cifrato");
    expect(r.detail).toContain("non lo decifra");
  });
});
