/**
 * 📤 Encoder GIM (PSP) — RGBA 8-8-8-8 → texture GIM.
 *
 * Inverso ESATTO del decoder in src/psp_gim.ts (stesso albero di blocchi,
 * stessi offset). Scelte dichiarate:
 *   - byte order BIG-ENDIAN (come i GIM dei giochi, rilevato dal decoder);
 *   - pixel_order = 0 (nessuno swizzle: file linearmente leggibile; i giochi
 *     reali usano spesso 1/tiled per performance — dichiarato);
 *   - rsx_pitch_align = 1 (nessun padding di riga);
 *   - struttura blocchi: root(2) → picture(3) → image(4) → [palette(5)];
 *   - palette (per P4/P8) in formato RGBA8888, costruita dai colori ESATTI:
 *     più di 16/256 colori → errore onesto (nessuna quantizzazione qui:
 *     usare prima quantizeRgba16 se serve).
 *
 * Packing nibble P4 (semantica del decoder/takePixel): primo pixel nel
 * nibble ALTO del byte, secondo nel nibble basso.
 */

import { decodeGim } from "./psp_gim";

export type GimFormat = "RGBA5650" | "RGBA5551" | "RGBA4444" | "RGBA8888" | "P4" | "P8";

const FORMAT_IDS: Record<GimFormat, number> = {
  RGBA5650: 0, RGBA5551: 1, RGBA4444: 2, RGBA8888: 3, P4: 4, P8: 5,
};

function beBlock(type: number, content: Uint8Array, next: number): Uint8Array {
  const h = new Uint8Array(20);
  const dv = new DataView(h.buffer);
  dv.setUint16(0, type, false);
  dv.setUint16(2, 0, false);
  dv.setUint32(4, 20 + content.length, false);
  dv.setUint32(8, next, false);
  dv.setUint32(12, 20, false);
  return Buffer.concat([h, content]);
}

/** Blocco image/palette (struttura 0x30 + frame offset + pixel data). */
function imageBlock(fmt: number, width: number, height: number, bpp: number, pixels: Uint8Array): Uint8Array {
  const st = new Uint8Array(0x30);
  const dv = new DataView(st.buffer);
  dv.setUint16(0, 0x30, false);        // structure size
  dv.setUint16(4, fmt, false);         // format
  dv.setUint16(6, 0, false);           // pixel_order: 0 = nessuno swizzle
  dv.setUint16(8, width, false);
  dv.setUint16(10, height, false);
  dv.setUint16(12, bpp, false);        // rsx_bpp
  dv.setUint16(14, 1, false);          // rsx_pitch_align
  dv.setUint16(38, 2, false);          // unknown_12 = 2 (come i file reali)
  dv.setUint32(20, 0x30, false);       // next_index_block (relativo al contenuto)
  dv.setUint32(24, 0x34, false);       // frame_data_start
  dv.setUint32(28, 0x34 + pixels.length, false); // frame_data_end
  dv.setUint16(40, 1, false);          // frame_count
  const frameOffset = new Uint8Array(4);
  new DataView(frameOffset.buffer).setUint32(0, 0x34, false);
  return Buffer.concat([st, frameOffset, pixels]);
}

/** Converte un pixel RGBA 8-8-8-8 nel valore nativo del formato. */
function toNative(format: number, r: number, g: number, b: number, a: number): number {
  switch (format) {
    case 0: return (((r >> 3) & 0x1f) << 11) | (((g >> 2) & 0x3f) << 5) | ((b >> 3) & 0x1f);
    case 1: return (((r >> 3) & 0x1f) << 11) | (((g >> 3) & 0x1f) << 6) | (((b >> 3) & 0x1f) << 1) | (a >= 128 ? 1 : 0);
    case 2: return ((r >> 4) << 12) | ((g >> 4) << 8) | ((b >> 4) << 4) | (a >> 4);
    case 3: return ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff);
    default: throw new Error(`Conversione colore GIM ${format} non supportata.`);
  }
}

/** Empila i pixel nativi per bpp 32/16/8/4 (semantica LSB-first del decoder). */
function packPixels(values: number[], bpp: number): Uint8Array {
  if (bpp === 32) {
    const out = new Uint8Array(values.length * 4);
    values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v >>> 0, true));
    return out;
  }
  if (bpp === 16) {
    const out = new Uint8Array(values.length * 2);
    values.forEach((v, i) => new DataView(out.buffer).setUint16(i * 2, v & 0xffff, true));
    return out;
  }
  if (bpp === 8) return new Uint8Array(values);
  if (bpp === 4) {
    const out = new Uint8Array(Math.ceil(values.length / 2));
    values.forEach((v, i) => {
      if (i % 2 === 0) out[i >> 1] |= (v & 0xf) << 4; // primo pixel = nibble ALTO
      else out[i >> 1] |= v & 0xf;
    });
    return out;
  }
  throw new Error(`bpp ${bpp} non supportato.`);
}

export interface EncodedGim {
  gim: Uint8Array;
  format: string;
  width: number;
  height: number;
}

export function encodeGim(rgba: Uint8Array, width: number, height: number, format: GimFormat): EncodedGim {
  const px = width * height;
  if (rgba.length < px * 4) throw new Error(`RGBA insufficienti per ${width}x${height}: servono ${px * 4} byte, forniti ${rgba.length}.`);
  const at = (i: number) => ({ r: rgba[i * 4], g: rgba[i * 4 + 1], b: rgba[i * 4 + 2], a: rgba[i * 4 + 3] });

  let imagePixels: Uint8Array;
  let paletteBlock: Uint8Array | null = null;
  const fmtId = FORMAT_IDS[format];

  if (format === "P4" || format === "P8") {
    const maxColors = format === "P4" ? 16 : 256;
    // palette dai colori esatti
    const palette: number[] = [];
    const index = new Map<number, number>();
    const idx: number[] = [];
    for (let i = 0; i < px; i++) {
      const { r, g, b, a } = at(i);
      const v = toNative(3, r, g, b, a); // palette 8888
      let ix = index.get(v);
      if (ix === undefined) {
        if (palette.length >= maxColors) {
          throw new Error(`Impossibile costruire la palette ${format}: più di ${maxColors} colori distinti (quantizza prima: nessuna riduzione silenziosa).`);
        }
        ix = palette.length;
        palette.push(v);
        index.set(v, ix);
      }
      idx.push(ix);
    }
    imagePixels = packPixels(idx, format === "P4" ? 4 : 8);
    paletteBlock = beBlock(5, imageBlock(3, palette.length, 1, 32, packPixels(palette, 32)), 0);
  } else {
    const bpp = format === "RGBA8888" ? 32 : 16;
    const values: number[] = [];
    for (let i = 0; i < px; i++) { const { r, g, b, a } = at(i); values.push(toNative(fmtId, r, g, b, a)); }
    imagePixels = packPixels(values, bpp);
  }

  const imageContent = imageBlock(fmtId, width, height, format === "P4" ? 4 : format === "P8" ? 8 : format === "RGBA8888" ? 32 : 16, imagePixels);
  const imageBlockBytes = beBlock(4, imageContent, paletteBlock ? 20 + imageContent.length : 0);
  const picture = beBlock(3, new Uint8Array(0), 20);
  const root = beBlock(2, new Uint8Array(0), 20);
  const header = Buffer.concat([
    Buffer.from("GIM."), Buffer.from("1.00"), Buffer.from("PSP\0"), Buffer.alloc(4),
  ]);

  const parts = paletteBlock ? [header, root, picture, imageBlockBytes, paletteBlock] : [header, root, picture, imageBlockBytes];
  const gim = Buffer.concat(parts);

  // autoverifica col nostro decoder: se non si rilegge, meglio fallire qui
  const check = decodeGim(gim);
  if (check.width !== width || check.height !== height) {
    throw new Error("Autoverifica GIM fallita (dimensioni): file non emesso.");
  }

  return { gim, format: format + (paletteBlock ? " + palette RGBA8888" : ""), width, height };
}
