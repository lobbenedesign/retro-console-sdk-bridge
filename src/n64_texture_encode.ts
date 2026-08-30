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
  options: { quantize?: boolean } = {},
): EncodedTexture {
  // quantizzazione opzionale (CON PERDITA, dichiarata) per i formati
  // indicizzati: porta l'immagine nello spazio RGBA16 e la riduce ai
  // colori della palette con median-cut
  if (options.quantize && (format === "CI4" || format === "CI8")) {
    rgba = quantizeRgba16(rgba, format === "CI4" ? 16 : 256);
  }
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

// ---------------------------------------------------------------------------
// Quantizzazione colore (median-cut nello spazio RGBA16) per CI4/CI8
// ---------------------------------------------------------------------------

/**
 * 🎨 Quantizzazione median-cut a maxColors colori.
 *
 * Opera nello spazio RGBA16 (5-5-5-1: lo stesso in cui vivrà la palette) così
 * i colori già rappresentabili restano IDENTICI — un'immagine a 16 colori
 * passa senza perdite. Onestà dichiarata: oltre i colori massimi la
 * quantizzazione è con perdita (dichiarata dal chiamante all'utente).
 */
export function quantizeRgba16(rgba: Uint8Array, maxColors: number): Uint8Array {
  // 1. porta i pixel nello spazio RGBA16 e raccoglie i colori distinti
  const words = new Uint16Array(rgba.length / 4);
  const counts = new Map<number, number>();
  for (let i = 0; i < words.length; i++) {
    const w = rgba16Word(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]);
    words[i] = w;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  if (counts.size <= maxColors) return rgba; // nulla da fare: già rappresentabile

  // 2. median-cut: bucket come liste di colori (r5,g5,b5,a1)
  interface Box { colors: number[] }
  const toRgb = (w: number) => ({ r: (w >> 11) & 0x1f, g: (w >> 6) & 0x1f, b: (w >> 1) & 0x1f, a: w & 1 });
  const boxes: Box[] = [{ colors: [...counts.keys()] }];

  const splitWidest = (): boolean => {
    // box col massimo "volume" (canale con range più ampio pesato dal n. pixel)
    let best = -1, bestRange = -1, bestChannel = 0 as 0 | 1 | 2 | 3;
    boxes.forEach((box, idx) => {
      if (box.colors.length < 2) return;
      let pop = 0;
      const mins = [31, 63, 31, 1], maxs = [0, 0, 0, 0];
      for (const w of box.colors) {
        const c = toRgb(w);
        mins[0] = Math.min(mins[0], c.r); maxs[0] = Math.max(maxs[0], c.r);
        mins[1] = Math.min(mins[1], c.g); maxs[1] = Math.max(maxs[1], c.g);
        mins[2] = Math.min(mins[2], c.b); maxs[2] = Math.max(maxs[2], c.b);
        mins[3] = Math.min(mins[3], c.a); maxs[3] = Math.max(maxs[3], c.a);
        pop += counts.get(w) || 1;
      }
      for (const ch of [0, 1, 2, 3] as const) {
        const range = (maxs[ch] - mins[ch]) * (ch === 1 ? 1 : 1); // g a 6 bit: range naturale già maggiore
        const score = range * Math.log2(pop + 1);
        if (range > 0 && score > bestRange) { bestRange = score; best = idx; bestChannel = ch; }
      }
    });
    if (best < 0) return false;
    const box = boxes[best];
    const ch = bestChannel;
    box.colors.sort((wa, wb) => {
      const a = toRgb(wa), b = toRgb(wb);
      const va = ch === 0 ? a.r : ch === 1 ? a.g : ch === 2 ? a.b : a.a;
      const vb = ch === 0 ? b.r : ch === 1 ? b.g : ch === 2 ? b.b : b.a;
      return va - vb;
    });
    const mid = box.colors.length >> 1;
    boxes.splice(best, 1, { colors: box.colors.slice(0, mid) }, { colors: box.colors.slice(mid) });
    return true;
  };

  while (boxes.length < maxColors) { if (!splitWidest()) break; }

  // 3. colore rappresentativo di ogni box = media pesata (arrotondata);
  //    se un box ha un solo colore resta ESATTO
  const paletteWords: number[] = boxes.map((box) => {
    if (box.colors.length === 1) return box.colors[0];
    let r = 0, g = 0, b = 0, a = 0, tot = 0;
    for (const w of box.colors) {
      const c = toRgb(w); const n = counts.get(w) || 1;
      r += c.r * n; g += c.g * n; b += c.b * n; a += c.a * n; tot += n;
    }
    return (((Math.round(r / tot) & 0x1f) << 11) | ((Math.round(g / tot) & 0x1f) << 6) |
      ((Math.round(b / tot) & 0x1f) << 1) | (Math.round(a / tot) & 1)) & 0xffff;
  });

  // 4. rimappa ogni pixel al colore della palette più vicino (distanza
  //    pesata RGBA nello spazio 5-5-5-1)
  const dist = (a: number, b: number): number => {
    const ca = toRgb(a), cb = toRgb(b);
    const dr = ca.r - cb.r, dg = ca.g - cb.g, db = ca.b - cb.b, da = (ca.a - cb.a) * 8;
    return dr * dr + dg * dg * 0.8 + db * db + da * da * 4;
  };
  const nearest = new Map<number, number>();
  for (const w of counts.keys()) {
    let bestW = paletteWords[0], bestD = Infinity;
    for (const p of paletteWords) {
      const d = dist(w, p);
      if (d < bestD) { bestD = d; bestW = p; }
    }
    nearest.set(w, bestW);
  }

  // 5. ritorna i pixel rimappati in RGBA 8-8-8-8
  const out = new Uint8Array(rgba.length);
  const from5 = (v: number) => Math.round((v / 31) * 255);
  for (let i = 0; i < words.length; i++) {
    const w = nearest.get(words[i])!;
    const c = toRgb(w);
    out[i * 4] = from5(c.r);
    out[i * 4 + 1] = from5(c.g);
    out[i * 4 + 2] = from5(c.b);
    out[i * 4 + 3] = c.a ? 255 : 0;
  }
  return out;
}
