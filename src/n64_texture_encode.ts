/**
 * 🎨 Encoder texture N64 — RGBA 8-8-8-8 → formati RDP.
 *
 * Formule INVERSE del decoder in src/n64_texture.ts (le cui formule sono
 * state verificate contro Texture64 di queueRAM — vedi ROADMAP).
 *
 * Onestà sui limiti di fedeltà: i formati N64 sono con perdita
 * (5-6-5 / 4-4-4 / 3-3+1 bit per canale): il round-trip è esatto SOLO per
 * i colori rappresentabili. L'encoder tronca (come fanno i tool reali:
 * n64graphics usa gli stessi shift). Per CI4/CI8 costruisce la palette
 * dai colori esatti presenti (max 16/256): più colori → errore esplicito,
 * nessuna quantizzazione silenziosa.
 */

import type { N64TextureFormat } from "./n64_texture";

export interface EncodedTexture {
  data: Uint8Array;
  palette?: Uint8Array; // per CI4/CI8, in formato RGBA16
}

const r5 = (v: number) => (v >> 3) & 0x1f;
const g5 = (v: number) => (v >> 3) & 0x1f;
const g6 = (v: number) => (v >> 2) & 0x3f;
const nib4 = (v: number) => v >> 4;
const nib3 = (v: number) => (v >> 5) & 0x7;
const luma = (r: number, g: number, b: number) => Math.round((r + g + b) / 3);

function rgba16Word(r: number, g: number, b: number, a: number): number {
  return ((r5(r) << 11) | (g5(g) << 6) | (r5(b) << 1) | (a >= 128 ? 1 : 0)) & 0xffff;
}

export function encodeN64Texture(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: N64TextureFormat,
): EncodedTexture {
  const px = width * height;
  if (rgba.length < px * 4) throw new Error(`RGBA insufficienti per ${width}x${height}: servono ${px * 4} byte, forniti ${rgba.length}.`);

  const at = (i: number) => ({ r: rgba[i * 4], g: rgba[i * 4 + 1], b: rgba[i * 4 + 2], a: rgba[i * 4 + 3] });

  switch (format) {
    case "RGBA32": {
      return { data: new Uint8Array(rgba.slice(0, px * 4)) };
    }
    case "RGBA16": {
      const out = new Uint8Array(px * 2);
      const dv = new DataView(out.buffer);
      for (let i = 0; i < px; i++) {
        const { r, g, b, a } = at(i);
        dv.setUint16(i * 2, rgba16Word(r, g, b, a), false);
      }
      return { data: out };
    }
    case "IA16": {
      const out = new Uint8Array(px * 2);
      for (let i = 0; i < px; i++) { const { r, g, b, a } = at(i); out[i * 2] = luma(r, g, b); out[i * 2 + 1] = a; }
      return { data: out };
    }
    case "IA8": {
      const out = new Uint8Array(px);
      for (let i = 0; i < px; i++) { const { r, g, b, a } = at(i); out[i] = (nib4(luma(r, g, b)) << 4) | nib4(a); }
      return { data: out };
    }
    case "IA4": {
      const out = new Uint8Array(Math.ceil(px / 2));
      for (let i = 0; i < px; i++) {
        const { r, g, b, a } = at(i);
        const nib = (nib3(luma(r, g, b)) << 1) | (a >= 128 ? 1 : 0);
        if (i % 2 === 0) out[i >> 1] |= nib << 4; // pixel pari = nibble alto
        else out[i >> 1] |= nib;
      }
      return { data: out };
    }
    case "I8": {
      const out = new Uint8Array(px);
      for (let i = 0; i < px; i++) { const { r, g, b } = at(i); out[i] = luma(r, g, b); }
      return { data: out };
    }
    case "I4": {
      const out = new Uint8Array(Math.ceil(px / 2));
      for (let i = 0; i < px; i++) {
        const { r, g, b } = at(i);
        const nib = nib4(luma(r, g, b));
        if (i % 2 === 0) out[i >> 1] |= nib << 4;
        else out[i >> 1] |= nib;
      }
      return { data: out };
    }
    case "CI4":
    case "CI8": {
      // palette dai colori esatti (rappresentabili in RGBA16)
      const maxColors = format === "CI4" ? 16 : 256;
      const palette: number[] = []; // word RGBA16
      const index = new Map<number, number>();
      const idxBytes = new Uint8Array(format === "CI4" ? Math.ceil(px / 2) : px);

      for (let i = 0; i < px; i++) {
        const { r, g, b, a } = at(i);
        const w = rgba16Word(r, g, b, a);
        let ix = index.get(w);
        if (ix === undefined) {
          if (palette.length >= maxColors) {
            throw new Error(
              `Impossibile costruire la palette ${format}: più di ${maxColors} colori RGBA16 distinti. ` +
              "Quantizza prima (nessuna quantizzazione silenziosa qui).",
            );
          }
          ix = palette.length;
          palette.push(w);
          index.set(w, ix);
        }
        if (format === "CI8") idxBytes[i] = ix;
        else if (i % 2 === 0) idxBytes[i >> 1] |= ix << 4;
        else idxBytes[i >> 1] |= ix;
      }

      const palBytes = new Uint8Array(palette.length * 2);
      const dv = new DataView(palBytes.buffer);
      palette.forEach((w, i) => dv.setUint16(i * 2, w, false));
      return { data: idxBytes, palette: palBytes };
    }
    default:
      throw new Error(`Formato non supportato per l'encoding: ${format}`);
  }
}
