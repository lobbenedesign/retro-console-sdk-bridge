/**
 * 🗜️ Lettore CSO (Compressed ISO) PSP — reimplementazione TypeScript.
 *
 * Specifica trascritta fedelmente leggendo il sorgente REALE di
 * hrydgard/ppsspp `Core/FileSystems/BlockDevices.cpp` (GPL-2.0, qui usato
 * SOLO come riferimento del formato — nessun codice copiato; la formula del
 * formato è conoscenza pubblica della scena PSP):
 *
 * Header 24 byte little-endian (sizeof = 0x18):
 *   0-3   "CISO"
 *   4-7   header_size (u32) — quasi tutti i tool lo scrivono 0x18
 *   8-15  total_bytes (u64): dimensione dell'ISO decompressa
 *   16-19 block_size (u32): potenza di 2 >= 2048 (frame)
 *   20    ver (u8, 0 o 1; >1 rifiutato, CSOv2 non esiste davvero)
 *   21    align_bits (u8): index entries shiftati a sinistra di questo
 *   22-23 riservati
 * Subito dopo: index u32 LE × (numFrames + 1). Per ogni frame:
 *   - offset byte = (entry & 0x7FFFFFFF) << align_bits
 *   - bit 31 (0x80000000) settato → frame memorizzato NON compresso
 *   - l'entry finale è il terminatore (offset di fine dati)
 * Ogni frame compresso è uno stream zlib RAW (inflate -15), decompresso a
 * block_size byte; un blocco da 2048 byte (settore) è letto dentro al frame
 * con l'offset frameNumber/blockShift.
 *
 * Validazioni di sanità riprese dal riferimento: indice monotono,
 * dimensioni coerenti (numBlocks <= numFrames << blockShift), ver <= 1,
 * block_size potenza di due >= 2048, align <= 20.
 */

import { inflateRawSync } from "node:zlib";

export interface SectorReader {
  readonly sectorSize: 2048;
  readSector(n: number): Uint8Array;
  numSectors(): number;
}

const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x10000) + 0) >>> 0;
const le32lo = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | b[o + 3] << 24) >>> 0;

export function isCso(data: Uint8Array): boolean {
  return data.length > 24 && data[0] === 0x43 && data[1] === 0x49 && data[2] === 0x53 && data[3] === 0x4f; // "CISO"
}

/** Lettore ISO "nuda": settori letti direttamente dai byte. */
export class IsoReader implements SectorReader {
  readonly sectorSize = 2048 as const;
  constructor(private data: Uint8Array) {}
  readSector(n: number): Uint8Array {
    if (n < 0 || (n + 1) * 2048 > this.data.length) throw new Error(`Settore ${n} fuori dai limiti dell'ISO (${this.numSectors()} settori).`);
    return this.data.slice(n * 2048, (n + 1) * 2048);
  }
  numSectors(): number {
    return Math.floor(this.data.length / 2048);
  }
}

export class CsoReader implements SectorReader {
  readonly sectorSize = 2048 as const;
  private frameSize: number;
  private blockShift: number;
  private indexShift: number;
  private numFrames: number;
  private numBlocksVal: number;
  private index: Uint32Array;
  private cacheFrame = -1;
  private cache: Uint8Array | null = null;

  constructor(private data: Uint8Array) {
    if (!isCso(data)) throw new Error("Il file non ha il magic 'CISO' del formato CSO.");
    const ver = data[20];
    if (ver > 1) throw new Error(`Versione CSO ${ver} non supportata (max 1).`);

    this.frameSize = le32(data, 16);
    if ((this.frameSize & (this.frameSize - 1)) !== 0) throw new Error(`CSO block size ${this.frameSize} non valido: deve essere potenza di due.`);
    if (this.frameSize < 0x800) throw new Error(`CSO block size ${this.frameSize} non valido: minimo un settore (2048).`);

    this.blockShift = 0;
    for (let i = this.frameSize; i > 0x800; i >>= 1) this.blockShift++;
    this.indexShift = data[21];
    if (this.indexShift > 20) throw new Error(`CSO index alignment ${this.indexShift} non supportato.`);

    // total_bytes: u64 LE a offset 8 (JS: Number è sufficiente per ISO < 9PB)
    const totalSize = le32lo(data, 8) + le32lo(data, 12) * 0x100000000;
    this.numFrames = Math.floor((totalSize + this.frameSize - 1) / this.frameSize);
    this.numBlocksVal = Math.floor(totalSize / 2048);
    if (this.numBlocksVal > this.numFrames << this.blockShift) {
      throw new Error("Header CSO incoerente (mismatch blocchi/frame).");
    }

    // header_size: la maggior parte dei tool scrive 0x18; ver<=1 → 24 fissi
    const headerEnd = 24;
    const indexSize = this.numFrames + 1;
    if (headerEnd + indexSize * 4 > data.length) throw new Error("CSO troncato: indice incompleto.");
    this.index = new Uint32Array(indexSize);
    for (let i = 0; i < indexSize; i++) this.index[i] = le32lo(data, headerEnd + i * 4);

    // indice monotono (validazione di sanità del riferimento ppsspp)
    for (let i = 0; i < indexSize - 1; i++) {
      if ((this.index[i] & 0x7fffffff) > (this.index[i + 1] & 0x7fffffff)) {
        throw new Error(`Indice CSO non monotono alla voce ${i}.`);
      }
    }
  }

  numSectors(): number {
    return this.numBlocksVal;
  }

  private readFrame(frameNumber: number): Uint8Array {
    if (this.cacheFrame === frameNumber && this.cache) return this.cache;

    const idx = this.index[frameNumber];
    const indexPos = idx & 0x7fffffff;
    const nextIndexPos = this.index[frameNumber + 1] & 0x7fffffff;
    const start = indexPos * (2 ** this.indexShift);
    const end = nextIndexPos * (2 ** this.indexShift);
    const plain = (idx & 0x80000000) !== 0;

    let frame: Uint8Array;
    if (plain) {
      frame = this.data.slice(start, start + this.frameSize);
      if (frame.length < this.frameSize) {
        const padded = new Uint8Array(this.frameSize);
        padded.set(frame);
        frame = padded;
      }
    } else {
      const compressed = this.data.slice(start, end);
      frame = new Uint8Array(inflateRawSync(Buffer.from(compressed)));
      if (frame.length !== this.frameSize) {
        throw new Error(`Frame CSO ${frameNumber}: decompresso a ${frame.length} byte invece di ${this.frameSize}.`);
      }
    }
    this.cacheFrame = frameNumber;
    this.cache = frame;
    return frame;
  }

  readSector(n: number): Uint8Array {
    if (n < 0 || n >= this.numBlocksVal) throw new Error(`Blocco ${n} fuori dai limiti del CSO (${this.numBlocksVal} blocchi).`);
    const frameNumber = n >> this.blockShift;
    const offsetInFrame = (n & (2 ** this.blockShift - 1)) * 2048;
    return this.readFrame(frameNumber).slice(offsetInFrame, offsetInFrame + 2048);
  }
}

/** Apre un'immagine ISO o CSO in modo trasparente. */
export function openSectorReader(data: Uint8Array): SectorReader {
  return isCso(data) ? new CsoReader(data) : new IsoReader(data);
}
