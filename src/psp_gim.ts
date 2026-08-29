/**
 * 🖼️ Decoder texture GIM (PSP) — formati GE reali.
 *
 * Struttura del formato trascritta (variabili rinominate, nessun codice
 * copiato) leggendo l'implementazione REALE open source
 * GeofrontTeam/LibPSPThemes `gim.py` (GPL: riferimento di formato), con le
 * conversioni colore secondo i formati standard del GE PSP (documentati
 * pubblicamente nella PS SDK):
 *
 * File: header "GIM." "1.00" "PSP" 0x00 (big o little endian) → blocchi:
 *   header blocco: type u16 · 0 u16 · block_size u32 · next_block u32 ·
 *   data_offset u32. Type: 2=root, 3=picture, 4=image, 5=palette,
 *   0xff=fileinfo.
 * Blocco image/palette (structure_size 0x30): format(0=5650, 1=5551,
 *   2=4444, 3=8888, 4=P4, 5=P8, 6=pa8, 7=paXX8888, 8/9/10=DXT1/3/5),
 *   pixel_order (1 = tiled/swizzled), width, height, rsx_bpp,
 *   rsx_pitch_align, next_index_block, frame_data_start/end.
 * Pixel: letti a livello di BIT (bpp<8 con byte parziali), righe allineate
 * al pitch; se pixel_order==1 l'immagine è tile-swizzled (tile 0x80/bpp × 8)
 * e va de-swizzlata.
 *
 * Supporto onesto: formati 0-5 (inclusi indicizzati con palette). pa8,
 * paXX8888 e DXT1/3/5 → errore esplicito, mai output inventato.
 */

export interface GimImage {
  width: number;
  height: number;
  format: string;
  rgba: Uint8Array;
}

const GIM_MAGIC_BE = [0x47, 0x49, 0x4d, 0x2e]; // "GIM."

export function isGim(data: Uint8Array): boolean {
  return data.length >= 16 && GIM_MAGIC_BE.every((b, i) => data[i] === b);
}

type Reader = { u16(o: number): number; u32(o: number): number };

function makeReader(data: Uint8Array, le: boolean): Reader {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    u16: (o) => dv.getUint16(o, le),
    u32: (o) => dv.getUint32(o, le),
  };
}

const FORMAT_NAMES = ["RGBA5650", "RGBA5551", "RGBA4444", "RGBA8888", "P4 (indicizzato)", "P8 (indicizzato)", "pa8", "paXX8888", "DXT1", "DXT3", "DXT5"];

/** Legge un pixel a livello di bit con byte parziali (fedele al reference). */
function takePixel(data: Uint8Array, pos: number, partial: [number, number], bpp: number): [number, number, [number, number]] {
  const bytes = (bpp + 7) >> 3;
  const lastByteBits = bpp % 8;
  let value = 0;
  for (let i = 0; i < bytes; i++) value |= data[pos + i] << (8 * i); // LE
  pos += bytes;
  if (lastByteBits > 0) {
    let [bitsInPartial, ] = partial;
    const [, partialValue] = partial;
    if (bitsInPartial === 0) bitsInPartial = 8;
    const newPartial: [number, number] = [bitsInPartial - lastByteBits, value & (0xff >> (bitsInPartial - lastByteBits))];
    value >>= bitsInPartial - lastByteBits;
    value &= 0xff >> lastByteBits;
    partial = newPartial;
    if (bitsInPartial - lastByteBits > 0) pos -= 1;
    void partialValue;
  }
  return [value >>> 0, pos, partial];
}

const overscan = (v: number, tile: number) => (v % tile === 0 ? v : v + (tile - (v % tile)));

/** De-swizzle per immagini tiled (transcrizione del swap_tiles reale). */
function swapTiles(pixels: number[][], w: number, h: number, tileW: number, tileH: number): number[][] {
  const overW = overscan(w, tileW);
  const overH = overscan(h, tileH);
  const out: number[][] = Array.from({ length: overH }, () => new Array(overW).fill(0));
  let originX = 0, originY = 0, tilePos = 0;
  for (let y = 0; y < overH; y++) {
    for (let x = 0; x < overW; x++) {
      const dx = originX + (tilePos % tileW);
      const dy = originY + Math.floor(tilePos / tileW);
      if (dx < w && dy < h) out[y][x] = pixels[dy][dx];
      tilePos++;
      if (tilePos === tileW * tileH) {
        tilePos = 0;
        originX += tileW;
        if (originX >= overW) { originX = 0; originY += tileH; }
      }
    }
  }
  return out;
}

interface ParsedBlock {
  format: number;
  pixelOrder: number;
  width: number;
  height: number;
  rsxBpp: number;
  rsxPitchAlign: number;
  nextIndexBlock: number;
  frameDataEnd: number;
  frameCount: number;
  pixels: number[][];
}

function readImagePixels(data: Uint8Array, contentStart: number, pos: number, r: Reader): ParsedBlock {
  const structureSize = r.u16(pos);
  if (structureSize !== 0x30) throw new Error(`Blocco GIM con struttura 0x${structureSize.toString(16)} non valida (attesa 0x30).`);
  const format = r.u16(pos + 4);
  const pixelOrder = r.u16(pos + 6);
  const width = r.u16(pos + 8);
  const height = r.u16(pos + 10);
  const rsxBpp = r.u16(pos + 12);
  const rsxPitchAlign = r.u16(pos + 14) || 1;
  const nextIndexBlock = r.u32(pos + 20);
  const frameDataEnd = r.u32(pos + 28);
  const frameCount = r.u16(pos + 40);

  if (frameCount !== 1) throw new Error(`GIM con ${frameCount} frame: multi-frame non supportato onestamente in questa versione.`);

  // frame data: offset u32 a contentStart+nextIndexBlock
  const frameOffset = r.u32(contentStart + nextIndexBlock);
  const frameData = data.slice(contentStart + frameOffset, contentStart + frameDataEnd);

  const tileW = Math.floor(0x80 / rsxBpp);
  const tileH = 0x08;
  let w = width, h = height;
  if (pixelOrder === 1) { w = overscan(w, tileW); h = overscan(h, tileH); }

  const pixels: number[][] = [];
  let dataPos = 0;
  let partial: [number, number] = [0, 0];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      let v: number;
      [v, dataPos, partial] = takePixel(frameData, dataPos, partial, rsxBpp);
      row.push(v);
    }
    pixels.push(row);
    if (rsxBpp >= 8 && dataPos % rsxPitchAlign !== 0) {
      dataPos += rsxPitchAlign - (dataPos % rsxPitchAlign);
    }
  }
  const ordered = pixelOrder === 1 ? swapTiles(pixels, width, height, tileW, tileH) : pixels;
  return { format, pixelOrder, width, height, rsxBpp, rsxPitchAlign, nextIndexBlock, frameDataEnd, frameCount, pixels: ordered };
}

/** Converte un valore pixel nel formato indicato → RGBA 8-8-8-8. */
function pixelToRgba(format: number, v: number, out: Uint8Array, o: number): void {
  const c5 = (x: number) => (x << 3) | (x >> 2); // 5→8 bit
  const c6 = (x: number) => (x << 2) | (x >> 4); // 6→8 bit
  const c4 = (x: number) => (x << 4) | x;        // 4→8 bit
  switch (format) {
    case 0: out[o] = c5((v >> 11) & 0x1f); out[o + 1] = c6((v >> 5) & 0x3f); out[o + 2] = c5(v & 0x1f); out[o + 3] = 255; break;
    case 1: out[o] = c5((v >> 11) & 0x1f); out[o + 1] = c5((v >> 6) & 0x1f); out[o + 2] = c5((v >> 1) & 0x1f); out[o + 3] = (v & 1) * 255; break;
    case 2: out[o] = c4((v >> 12) & 0xf); out[o + 1] = c4((v >> 8) & 0xf); out[o + 2] = c4((v >> 4) & 0xf); out[o + 3] = c4(v & 0xf); break;
    case 3: out[o] = (v >> 24) & 0xff; out[o + 1] = (v >> 16) & 0xff; out[o + 2] = (v >> 8) & 0xff; out[o + 3] = v & 0xff; break;
    default: throw new Error(`Conversione colore per formato GIM ${format} (${FORMAT_NAMES[format] ?? "?"}) non supportata.`);
  }
}

/** Decodifica un GIM in RGBA. Fallisce onestamente su DXT/pa8/multi-frame. */
export function decodeGim(data: Uint8Array): GimImage {
  if (!isGim(data)) throw new Error("Il file non ha il magic 'GIM.'.");

  // byte order: i magic sono letti come u32 (i char "GIM." sono gli stessi:
  // cambia l'interpretazione). 0x47494D2E = "GIM." big-endian
  const dv0 = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let isLe: boolean;
  if (dv0.getUint32(0, false) === 0x47494d2e) isLe = false;
  else if (dv0.getUint32(0, true) === 0x47494d2e) isLe = true;
  else throw new Error("Magic GIM non riconosciuto.");
  const r = makeReader(data, isLe);

  let image: ParsedBlock | null = null;
  let palette: ParsedBlock | null = null;

  let pos = 16; // dopo i 4 magic u32
  while (pos < data.length) {
    const blockStart = pos;
    const type = r.u16(pos);
    const nextBlock = r.u32(pos + 8);
    const contentStart = pos + 20; // header blocco = 20 byte

    if (type === 4 || type === 5) {
      const parsed = readImagePixels(data, contentStart, contentStart, r);
      if (type === 4) image = parsed;
      else palette = parsed;
    }
    // type 2 (root), 3 (picture), 0xff (fileinfo): nessun pixel da leggere
    if (nextBlock === 0) break;
    pos = blockStart + nextBlock;
  }

  if (!image) throw new Error("Nessun blocco immagine trovato nel GIM.");
  if (image.format === 6 || image.format === 7 || image.format >= 8) {
    throw new Error(`Formato GIM ${FORMAT_NAMES[image.format]} non supportato onestamente (supportati: 5650/5551/4444/8888/P4/P8).`);
  }

  const { width, height } = image;
  const rgba = new Uint8Array(width * height * 4);

  if (image.format === 4 || image.format === 5) {
    if (!palette) throw new Error("Immagine indicizzata senza blocco palette nel GIM.");
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = image.pixels[y]?.[x] ?? 0;
        const color = palette.pixels[0]?.[idx] ?? 0;
        pixelToRgba(palette.format, color, rgba, (y * width + x) * 4);
      }
    }
    return { width, height, format: `${FORMAT_NAMES[image.format]} + palette ${FORMAT_NAMES[palette.format] ?? "?"}`, rgba };
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixelToRgba(image.format, image.pixels[y]?.[x] ?? 0, rgba, (y * width + x) * 4);
    }
  }
  return { width, height, format: FORMAT_NAMES[image.format], rgba };
}
