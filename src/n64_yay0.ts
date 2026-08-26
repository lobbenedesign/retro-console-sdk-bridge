/**
 * 📦 Decodificatore Yay0 reale
 *
 * Yay0 è un formato di compressione LZ77-style GENERICO imparentato a
 * MIO0 (stessa famiglia, usato da vari titoli N64 dell'epoca inclusi
 * Paper Mario e altri — non specifico di un singolo gioco), con lunghezza
 * massima di match estesa da 18 a 273 byte tramite un byte aggiuntivo nella
 * sezione dati quando il nibble di conteggio è zero.
 *
 * Algoritmo trascritto ESATTAMENTE (stessa logica, variabili rinominate in
 * italiano dove non ambiguo) dal riferimento pubblico open source reale
 * `ethteck/n64decompress` (Yay0/decompress.py), per garantire fedeltà
 * bit-per-bit al formato invece di una reinterpretazione approssimativa —
 * nessun codice copiato letteralmente, solo l'algoritmo/formula
 * riprodotta in TypeScript dopo lettura diretta della fonte pubblica.
 *
 * Layout header (16 byte, big-endian):
 *   0-3:   "Yay0"
 *   4-7:   dimensione decompressa
 *   8-11:  offset della "link table" (voci a 2 byte: nibble conteggio + distanza a 12 bit)
 *   12-15: offset della sezione "chunk" (byte letterali + byte di estensione conteggio)
 * Dopo l'header (offset 0x10): bitstream mask a 32 bit (big-endian), MSB
 * per bit, ricaricato ogni 32 bit consumati.
 */

const MAGIC = "Yay0";

export function isYay0(data: Uint8Array): boolean {
  return data.length >= 16 && String.fromCharCode(...data.slice(0, 4)) === MAGIC;
}

export function yay0Decompress(data: Uint8Array): Uint8Array {
  if (!isYay0(data)) throw new Error("Non è un blocco Yay0 valido (magic 'Yay0' mancante).");

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decompressedSize = view.getUint32(4, false);
  const linkTableOffset = view.getUint32(8, false);
  const chunkDataOffset = view.getUint32(12, false);

  const out = new Uint8Array(decompressedSize);
  let idx = 0; // posizione di scrittura nell'output
  let maskIdx = 16; // lettore della bitstream mask, parte subito dopo l'header
  let linkIdx = linkTableOffset;
  let chunkIdx = chunkDataOffset;

  let currentMask = 0;
  let maskBitsLeft = 0;

  while (idx < decompressedSize) {
    if (maskBitsLeft === 0) {
      currentMask = view.getUint32(maskIdx, false) >>> 0;
      maskIdx += 4;
      maskBitsLeft = 32;
    }

    if (currentMask & 0x80000000) {
      out[idx] = data[chunkIdx];
      idx += 1;
      chunkIdx += 1;
    } else {
      const link = view.getUint16(linkIdx, false);
      linkIdx += 2;

      const offset = idx - (link & 0xfff);
      let count = link >>> 12;

      if (count === 0) {
        const countModifier = data[chunkIdx];
        chunkIdx += 1;
        count = countModifier + 18;
      } else {
        count += 2;
      }

      for (let i = 0; i < count && idx < decompressedSize; i++) {
        out[idx] = out[offset + i - 1];
        idx += 1;
      }
    }

    currentMask = (currentMask << 1) >>> 0;
    maskBitsLeft -= 1;
  }

  return out;
}
