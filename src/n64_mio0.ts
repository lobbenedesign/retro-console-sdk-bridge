/**
 * 📦 Decodificatore/codificatore MIO0 reale
 *
 * MIO0 è un formato di compressione LZ77-style GENERICO usato su
 * Nintendo 64 (non specifico di un singolo gioco — utility di compressione
 * usata da vari titoli dell'epoca). Specifica pubblica documentata dalla
 * community di reverse-engineering N64 (vedi n64squid.com, e i tool open
 * source `mio0.c` diffusi nella scena homebrew/hacking N64, es. sm64tools
 * di queueRAM). Nessun dato di un gioco specifico è incluso qui: solo
 * l'algoritmo di (de)compressione generico.
 *
 * Layout header (16 byte, big-endian):
 *   0-3:  "MIO0"
 *   4-7:  dimensione decompressa
 *   8-11: offset della sezione "compressa" (coppie length/distance)
 *   12-15: offset della sezione "non compressa" (byte letterali)
 * Dopo l'header: bitstream di layout (1 bit per token, MSB-first): 1=byte
 * letterale dalla sezione non compressa, 0=riferimento all'indietro a 2
 * byte dalla sezione compressa (nibble alto = lunghezza-3, 12 bit bassi =
 * distanza-1).
 *
 * CROSS-CHECK (2026-08-26): implementazione validata confrontando riga per
 * riga la formula qui sopra con il codice sorgente reale del riferimento
 * open source `libmio0.c` (queueRAM/sm64tools, MIT). Confermato identico:
 * stessi offset header big-endian, stesso ordine bit MSB-first
 * (`buf[bit/8] & (1 << (7 - bit%8))`), stessa formula esatta
 * `length = (b0>>4)+3` e `distance = (((b0&0xF)<<8)+b1)+1`. Nessuna
 * discrepanza trovata — nessun codice è stato copiato, solo la formula
 * pubblica del formato è stata verificata contro un'implementazione
 * indipendente nota per essere corretta e usata in produzione dalla
 * community di ROM hacking N64 da anni.
 */

const MAGIC = "MIO0";

export function isMio0(data: Uint8Array): boolean {
  return data.length >= 16 && String.fromCharCode(...data.slice(0, 4)) === MAGIC;
}

export function mio0Decompress(data: Uint8Array): Uint8Array {
  if (!isMio0(data)) throw new Error("Non è un blocco MIO0 valido (magic 'MIO0' mancante).");

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decompressedSize = view.getUint32(4, false);
  const compOffset = view.getUint32(8, false);
  const uncompOffset = view.getUint32(12, false);

  const out = new Uint8Array(decompressedSize);
  let outPos = 0;
  let layoutBitPos = 0; // bit index nel layout bitstream, che parte da byte 16
  let compPos = compOffset;
  let uncompPos = uncompOffset;

  const nextLayoutBit = (): number => {
    const byteIdx = 16 + (layoutBitPos >> 3);
    const bitIdx = 7 - (layoutBitPos & 7);
    layoutBitPos++;
    return (data[byteIdx] >> bitIdx) & 1;
  };

  while (outPos < decompressedSize) {
    const bit = nextLayoutBit();
    if (bit === 1) {
      out[outPos++] = data[uncompPos++];
    } else {
      const b0 = data[compPos++];
      const b1 = data[compPos++];
      const length = (b0 >> 4) + 3;
      const distance = (((b0 & 0x0f) << 8) | b1) + 1;
      for (let i = 0; i < length && outPos < decompressedSize; i++) {
        out[outPos] = out[outPos - distance];
        outPos++;
      }
    }
  }

  return out;
}

/**
 * Compressore MIO0 reale (greedy, non ottimo ma corretto): usato SOLO per
 * generare dati di test sintetici e verificare il decompressore con un vero
 * round-trip — non serve per un uso reale di ricompressione di livelli.
 */
export function mio0CompressForTesting(data: Uint8Array): Uint8Array {
  const layoutBits: number[] = [];
  const compTokens: number[] = [];
  const literalBytes: number[] = [];

  let pos = 0;
  const MAX_LEN = 18; // (0xF)+3
  const MAX_DIST = 4096; // 12 bit + 1

  while (pos < data.length) {
    let bestLen = 0;
    let bestDist = 0;
    const searchStart = Math.max(0, pos - MAX_DIST);
    for (let start = searchStart; start < pos; start++) {
      let len = 0;
      while (len < MAX_LEN && pos + len < data.length && data[start + len] === data[pos + len]) len++;
      if (len > bestLen) {
        bestLen = len;
        bestDist = pos - start;
      }
    }
    if (bestLen >= 3) {
      layoutBits.push(0);
      const lenNibble = bestLen - 3;
      const distField = bestDist - 1;
      compTokens.push(((lenNibble << 4) | (distField >> 8)) & 0xff, distField & 0xff);
      pos += bestLen;
    } else {
      layoutBits.push(1);
      literalBytes.push(data[pos]);
      pos += 1;
    }
  }

  const layoutByteLen = Math.ceil(layoutBits.length / 8);
  const layoutBytes = new Uint8Array(layoutByteLen);
  layoutBits.forEach((bit, i) => {
    if (bit) layoutBytes[i >> 3] |= 1 << (7 - (i & 7));
  });

  const headerLen = 16;
  const compOffset = headerLen + layoutByteLen;
  const uncompOffset = compOffset + compTokens.length;
  const total = uncompOffset + literalBytes.length;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x4d, 0x49, 0x4f, 0x30], 0); // "MIO0"
  view.setUint32(4, data.length, false);
  view.setUint32(8, compOffset, false);
  view.setUint32(12, uncompOffset, false);
  out.set(layoutBytes, headerLen);
  out.set(new Uint8Array(compTokens), compOffset);
  out.set(new Uint8Array(literalBytes), uncompOffset);
  return out;
}
