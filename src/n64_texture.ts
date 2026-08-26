/**
 * 🎨 Decoder reale dei formati texture N64 (RDP: Reality Display Processor)
 *
 * Formati hardware GENERICI, identici su qualunque ROM N64 (non specifici
 * di un gioco) — lo stesso set di formati texture supportato dal chip
 * grafico di ogni console N64 reale. Formule di estrazione canali derivate
 * da documentazione pubblica e cross-verificate contro il comportamento
 * documentato del tool open source reale Texture64 (queueRAM/Texture64,
 * N64Graphics.cs) — nessun codice copiato, solo le formule di conversione
 * bit-level del formato hardware, reimplementate da zero qui in
 * TypeScript. Vedi ROADMAP.md per le fonti verificate.
 *
 * Opera esclusivamente su blob di byte texture forniti dal CLIENT a
 * runtime (mai una ROM intera aperta da questo server).
 */

export type N64TextureFormat =
  | "RGBA16" | "RGBA32"
  | "IA16" | "IA8" | "IA4"
  | "I8" | "I4"
  | "CI4" | "CI8";

export const BITS_PER_PIXEL: Record<N64TextureFormat, number> = {
  RGBA16: 16, RGBA32: 32, IA16: 16, IA8: 8, IA4: 4, I8: 8, I4: 4, CI4: 4, CI8: 8
};

export interface DecodedTexture {
  width: number;
  height: number;
  rgba: Uint8ClampedArray; // 4 byte per pixel, RGBA8888
}

// Scala reale un valore a N bit fino a 8 bit per replicazione bit (stesso
// principio usato dall'hardware N64 stesso, non un semplice shift che
// lascerebbe i valori troppo scuri — es. 5 bit -> 8 bit: 0x1F -> 0xFF, non 0xF8).
function scaleTo8(value: number, bits: number): number {
  if (bits >= 8) return value & 0xff;
  const maxIn = (1 << bits) - 1;
  return Math.round((value / maxIn) * 255);
}

function setPixel(out: Uint8ClampedArray, idx: number, r: number, g: number, b: number, a: number) {
  out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = a;
}

/**
 * Decodifica un blob di byte texture reale nel formato N64 indicato in una
 * bitmap RGBA8888. `palette` è richiesta solo per CI4/CI8 (entry RGBA16,
 * come da specifica reale: 16 entry per CI4, fino a 256 per CI8).
 */
export function decodeN64Texture(
  data: Uint8Array,
  width: number,
  height: number,
  format: N64TextureFormat,
  palette?: Uint8Array
): DecodedTexture {
  const out = new Uint8ClampedArray(width * height * 4);
  const pixelCount = width * height;

  const readRgba16Entry = (bytes: Uint8Array, byteOffset: number): [number, number, number, number] => {
    const c0 = bytes[byteOffset];
    const c1 = bytes[byteOffset + 1];
    const r5 = (c0 & 0xf8) >> 3;
    const g5 = ((c0 & 0x07) << 2) | ((c1 & 0xc0) >> 6);
    const b5 = (c1 & 0x3e) >> 1;
    const a1 = c1 & 0x01;
    return [scaleTo8(r5, 5), scaleTo8(g5, 5), scaleTo8(b5, 5), a1 ? 255 : 0];
  };

  switch (format) {
    case "RGBA16": {
      for (let i = 0; i < pixelCount; i++) {
        const [r, g, b, a] = readRgba16Entry(data, i * 2);
        setPixel(out, i * 4, r, g, b, a);
      }
      break;
    }
    case "RGBA32": {
      for (let i = 0; i < pixelCount; i++) {
        const o = i * 4;
        setPixel(out, o, data[o], data[o + 1], data[o + 2], data[o + 3]);
      }
      break;
    }
    case "IA16": {
      for (let i = 0; i < pixelCount; i++) {
        const intensity = data[i * 2];
        const alpha = data[i * 2 + 1];
        setPixel(out, i * 4, intensity, intensity, intensity, alpha);
      }
      break;
    }
    case "IA8": {
      for (let i = 0; i < pixelCount; i++) {
        const byte = data[i];
        const intensity = scaleTo8(byte >> 4, 4);
        const alpha = scaleTo8(byte & 0x0f, 4);
        setPixel(out, i * 4, intensity, intensity, intensity, alpha);
      }
      break;
    }
    case "IA4": {
      for (let i = 0; i < pixelCount; i++) {
        const byteIdx = i >> 1;
        const nibble = i & 1; // pixel pari = nibble alto, dispari = nibble basso (big-endian N64 reale)
        const byte = data[byteIdx];
        const val = (nibble === 0) ? (byte >> 4) & 0x0f : byte & 0x0f;
        const intensity3 = (val >> 1) & 0x07;
        const alpha1 = val & 0x01;
        const intensity = scaleTo8(intensity3, 3);
        setPixel(out, i * 4, intensity, intensity, intensity, alpha1 ? 255 : 0);
      }
      break;
    }
    case "I8": {
      for (let i = 0; i < pixelCount; i++) {
        const v = data[i];
        setPixel(out, i * 4, v, v, v, v); // I8 reale: intensità usata anche come alpha (CI/I mode standard)
      }
      break;
    }
    case "I4": {
      for (let i = 0; i < pixelCount; i++) {
        const byteIdx = i >> 1;
        const nibble = i & 1;
        const byte = data[byteIdx];
        const val4 = (nibble === 0) ? (byte >> 4) & 0x0f : byte & 0x0f;
        const v = scaleTo8(val4, 4);
        setPixel(out, i * 4, v, v, v, v);
      }
      break;
    }
    case "CI4": {
      if (!palette) throw new Error("CI4 richiede una palette reale (16 entry RGBA16, 32 byte).");
      for (let i = 0; i < pixelCount; i++) {
        const byteIdx = i >> 1;
        const nibble = i & 1;
        const byte = data[byteIdx];
        const index = (nibble === 0) ? (byte >> 4) & 0x0f : byte & 0x0f;
        const [r, g, b, a] = readRgba16Entry(palette, index * 2);
        setPixel(out, i * 4, r, g, b, a);
      }
      break;
    }
    case "CI8": {
      if (!palette) throw new Error("CI8 richiede una palette reale (fino a 256 entry RGBA16).");
      for (let i = 0; i < pixelCount; i++) {
        const index = data[i];
        const [r, g, b, a] = readRgba16Entry(palette, index * 2);
        setPixel(out, i * 4, r, g, b, a);
      }
      break;
    }
  }

  return { width, height, rgba: out };
}

/** Calcola la dimensione reale in byte richiesta per una texture in un dato formato. */
export function requiredByteLength(width: number, height: number, format: N64TextureFormat): number {
  const bits = BITS_PER_PIXEL[format];
  return Math.ceil((width * height * bits) / 8);
}
