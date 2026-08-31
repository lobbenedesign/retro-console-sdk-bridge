/**
 * 🗄️ Lettore CHD v5 (MAME Compressed Hunks of Data) — ISO PSP/Dreamcast.
 *
 * Specifica trascritta fedelmente (nessun codice copiato) dai sorgenti
 * REALI di MAME, che definiscono il formato:
 *   - src/lib/util/chd.h      → layout header v5 + enum COMPRESSION_*
 *   - src/lib/util/chd.cpp    → decompress_v5_map (mappa codificata con
 *                                bitstream MSB-first + Huffman RLE)
 *   - src/lib/util/huffman.cpp→ import_tree_rle (albero a lunghezze RLE,
 *                                codici canonici)
 *   - src/lib/util/chdcodec.cpp → codec zlib (inflate raw per hunk)
 *
 * Header v5 (tutti i campi big-endian): 'MComprHD', length=124, version=5,
 * compressors[4] fourcc BE ('zlib', 'lzma', …; 0 = nessuno), logicalbytes
 * u64, mapoffset u64, metaoffset u64, hunkbytes u32, unitbytes u32, sha1×3.
 *
 * Mappa v5 COMPRESSA (il caso dei CHD zlib reali): 16 byte di header
 * (length, datastart48, crc16, lengthbits, selfbits, parentbits) poi un
 * bitstream MSB-first: prima l'albero Huffman RLE dei TIPI di compressione
 * (16 simboli, numbits=4), poi per ogni hunk il tipo (con run-length RLE
 * small/large) e i campi variabili (complength a lengthbits, crc16;
 * selfref a selfbits; parentunit a parentbits).
 *
 * Onestà dichiarata: codec supportato 'zlib' (inflate raw). 'lzma' e i codec
 * lossy (flac/cdyl) → errore esplicito. CHD con parent (diff) non gestiti.
 * Validazione = sintetici costruiti a spec + round-trip col nostro writer
 * di test: compatibilità con chdman reale dichiarata "da verificare su
 * file reali" (non ne possediamo in sviluppo).
 */

import { inflateRawSync } from "node:zlib";

const COMPRESSION = {
  TYPE_0: 0, TYPE_1: 1, TYPE_2: 2, TYPE_3: 3, NONE: 4, SELF: 5, PARENT: 6,
  RLE_SMALL: 7, RLE_LARGE: 8, SELF_0: 9, SELF_1: 10, PARENT_SELF: 11, PARENT_0: 12, PARENT_1: 13,
} as const;

/** Bitstream MSB-first (come util::bitstream_in di MAME). */
class BitstreamIn {
  private bitPos = 0;
  constructor(private data: Uint8Array) {}
  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byteIdx = this.bitPos >> 3;
      if (byteIdx >= this.data.length) throw new Error("Bitstream CHD esaurito (lettura oltre la fine).");
      const bit = (this.data[byteIdx] >> (7 - (this.bitPos & 7))) & 1;
      v = (v << 1) | bit;
      this.bitPos++;
    }
    return v;
  }
}

/** Albero Huffman RLE a 16 simboli con codici canonici (import_tree_rle). */
class HuffmanRle16 {
  private lengths: number[] = [];
  private firstCode: number[] = [];
  private numCodes = 16;

  /** numbits = 4 per 16 simboli / maxbits 8 (huffman_decoder<16,8>). */
  importTreeRle(bits: BitstreamIn): void {
    const numbits = 4;
    for (let curnode = 0; curnode < this.numCodes; ) {
      let nodebits = bits.read(numbits);
      if (nodebits !== 1) {
        this.lengths[curnode++] = nodebits;
      } else {
        nodebits = bits.read(numbits);
        if (nodebits === 1) {
          this.lengths[curnode++] = 1;
        } else {
          let repcount = bits.read(numbits) + 3;
          while (repcount-- > 0 && curnode < this.numCodes) this.lengths[curnode++] = nodebits;
        }
      }
    }
    this.assignCanonical();
  }

  /** Codici canonici per lunghezza (come assign_canonical_codes). */
  private assignCanonical(): void {
    const maxLen = Math.max(...this.lengths);
    const count = new Array(maxLen + 1).fill(0);
    for (const l of this.lengths) if (l > 0) count[l]++;
    this.firstCode = new Array(maxLen + 2).fill(0);
    let code = 0;
    for (let len = 1; len <= maxLen; len++) {
      code = (code + count[len - 1]) << 1;
      this.firstCode[len] = code;
    }
  }

  /** Decodifica un simbolo bit per bit (MSB-first, canonico). */
  decode(bits: BitstreamIn): number {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | bits.read(1);
      // cerca il simbolo canonico: i codici di lunghezza len partono da
      // firstCode[len] e sono assegnati in ordine di indice simbolo
      let k = 0;
      for (let i = 0; i < this.numCodes; i++) {
        if (this.lengths[i] === len) {
          if (this.firstCode[len] + k === code) return i;
          k++;
        }
      }
    }
    throw new Error("Codice Huffman CHD non decodificabile (albero corrotto).");
  }
}

export interface ChdMapEntry {
  compression: number; // COMPRESSION_*
  offset: number;
  length: number;
  crc: number;
}

export interface ChdMetadata {
  tag: string;   // fourcc, es. "CHT2" (tracce), "IDNT"
  length: number;
  dataBase64: string;
}

export interface ChdInfo {
  version: number;
  logicalBytes: number;
  hunkBytes: number;
  unitBytes: number;
  hunkCount: number;
  codecs: string[]; // fourcc dei compressori attivi
  hasParent: boolean;
  metadata: ChdMetadata[];
}

const be24 = (b: Uint8Array, o: number) => ((b[o] << 16) | (b[o + 1] << 8) | b[o + 2]) >>> 0;
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be48 = (b: Uint8Array, o: number) => b[o] * 0x10000000000 + b[o + 1] * 0x100000000 + b[o + 2] * 0x1000000 + (b[o + 3] << 16) + (b[o + 4] << 8) + b[o + 5];
const be64 = (b: Uint8Array, o: number) => b[o] * 0x100000000000000 + b[o + 1] * 0x1000000000000 + b[o + 2] * 0x10000000000 + b[o + 3] * 0x100000000 + be32(b, o + 4);
const fourcc = (v: number) => (v === 0 ? "" : String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff));

export function isChd(data: Uint8Array): boolean {
  return data.length >= 124 && String.fromCharCode(...data.slice(0, 8)) === "MComprHD";
}

export class ChdFile {
  private map: ChdMapEntry[] = [];
  private hunkCache: { index: number; data: Uint8Array } | null = null;

  readonly version: number;
  readonly logicalBytes: number;
  readonly hunkBytes: number;
  readonly unitBytes: number;
  readonly hunkCount: number;
  readonly codecs: string[];
  readonly hasParent: boolean;
  readonly metadata: ChdMetadata[] = [];

  constructor(private data: Uint8Array) {
    if (!isChd(data)) throw new Error("Il file non ha il magic 'MComprHD'.");
    this.version = be32(data, 12);
    if (this.version !== 5) throw new Error(`CHD versione ${this.version} non supportata (solo v5: le versioni precedenti hanno header diversi).`);

    const compressors = [be32(data, 16), be32(data, 20), be32(data, 24), be32(data, 28)];
    this.codecs = compressors.filter((c) => c !== 0).map(fourcc);
    this.logicalBytes = be64(data, 32);
    const mapOffset = be64(data, 40);
    const metaOffset = be64(data, 48);
    this.hunkBytes = be32(data, 56);
    this.unitBytes = be32(data, 60);
    this.hunkCount = Math.ceil(this.logicalBytes / this.hunkBytes);
    this.hasParent = data.slice(104, 124).some((b) => b !== 0);
    if (this.hasParent) throw new Error("CHD con parent (diff chain) non supportato onestamente in questa versione.");

    if (this.codecs.some((c) => c !== "zlib")) {
      throw new Error(`Codec CHD non supportato: ${this.codecs.join(", ") || "nessuno?"} (supportato: zlib).`);
    }

    this.readMap(mapOffset);
    this.readMetadata(metaOffset);
  }

  private readMap(mapOffset: number): void {
    if (mapOffset === 0) throw new Error("CHD senza mappa (mapoffset=0).");
    const rawbuf = this.data.slice(mapOffset, mapOffset + 16);
    const mapbytes = be32(rawbuf, 0);
    const firstoffs = be48(rawbuf, 4);
    this.lenBits = rawbuf[12];
    this.selfBits = rawbuf[13];
    const parentbits = rawbuf[14];

    const compressed = this.data.slice(mapOffset + 16, mapOffset + 16 + mapbytes);
    const bits = new BitstreamIn(compressed);

    // 1. albero Huffman dei tipi + tipi con RLE
    const decoder = new HuffmanRle16();
    decoder.importTreeRle(bits);
    const types: number[] = [];
    let lastcomp = 0;
    let repcount = 0;
    for (let hunknum = 0; hunknum < this.hunkCount; hunknum++) {
      if (repcount > 0) { types[hunknum] = lastcomp; repcount--; }
      else {
        const val = decoder.decode(bits);
        if (val === COMPRESSION.RLE_SMALL) { types[hunknum] = lastcomp; repcount = 2 + decoder.decode(bits); }
        else if (val === COMPRESSION.RLE_LARGE) {
          types[hunknum] = lastcomp;
          repcount = 2 + 16 + (decoder.decode(bits) << 4);
          repcount += decoder.decode(bits);
        } else { types[hunknum] = lastcomp = val; }
      }
    }

    // 2. campi per hunk (trascrizione del loop reale)
    let curoffset = firstoffs;
    let lastSelf = 0;
    let lastParent = 0;
    for (let hunknum = 0; hunknum < this.hunkCount; hunknum++) {
      let offset = curoffset;
      let length = 0;
      let crc = 0;
      switch (types[hunknum]) {
        case COMPRESSION.TYPE_0: case COMPRESSION.TYPE_1:
        case COMPRESSION.TYPE_2: case COMPRESSION.TYPE_3:
          length = this.readLen(bits);
          curoffset += length;
          crc = bits.read(16);
          break;
        case COMPRESSION.NONE:
          curoffset += length = this.hunkBytes;
          crc = bits.read(16);
          break;
        case COMPRESSION.SELF:
          lastSelf = offset = bits.read(this.selfBits);
          break;
        case COMPRESSION.PARENT:
          offset = bits.read(parentbits);
          lastParent = offset;
          break;
        case COMPRESSION.SELF_1: lastSelf++; types[hunknum] = COMPRESSION.SELF; offset = lastSelf; break;
        case COMPRESSION.SELF_0: types[hunknum] = COMPRESSION.SELF; offset = lastSelf; break;
        case COMPRESSION.PARENT_SELF:
          types[hunknum] = COMPRESSION.PARENT;
          lastParent = offset = Math.floor((hunknum * this.hunkBytes) / this.unitBytes);
          break;
        case COMPRESSION.PARENT_1: lastParent += Math.floor(this.hunkBytes / this.unitBytes); types[hunknum] = COMPRESSION.PARENT; offset = lastParent; break;
        case COMPRESSION.PARENT_0: types[hunknum] = COMPRESSION.PARENT; offset = lastParent; break;
        default: throw new Error(`Tipo compressione CHD ${types[hunknum]} non valido.`);
      }
      if (types[hunknum] === COMPRESSION.PARENT) throw new Error("Riferimenti parent non supportati (CHD senza parent richiesto).");
      this.map.push({ compression: types[hunknum], offset, length, crc });
    }
  }

  // bit-width dei campi mappa (dall'header della mappa compressa)
  private lenBits = 0;
  private selfBits = 0;
  private readLen(bits: BitstreamIn): number { return bits.read(this.lenBits); }

  // Layout reale dell'header metadata (16 byte, verificato contro
  // src/lib/util/chd.cpp di MAME — metadata_entry::metatag/flags/length/
  // next — DIVERSO da quanto assunto nella prima stesura, che leggeva
  // "next" a offset 0 e un "length" a 4 byte pieni a offset 12: qui il
  // layout reale è metatag(4)@0, flags(1)@4, length a 24 bit(3)@5,
  // next(8)@8. Con il layout sbagliato ogni entry veniva letta come
  // spazzatura (tag/length insensati, "next" preso da byte che in realtà
  // sono length+parte di next) — bug reale, mai eseguito su un CHD vero.
  private readMetadata(metaOffset: number): void {
    const HEADER_SIZE = 16;
    let off = metaOffset;
    while (off !== 0 && this.metadata.length < 64) {
      if (off + HEADER_SIZE > this.data.length) throw new Error("Metadata CHD troncato.");
      const tag = fourcc(be32(this.data, off));
      const length = be24(this.data, off + 5);
      const next = be64(this.data, off + 8);
      if (off + HEADER_SIZE + length > this.data.length) throw new Error("Metadata CHD oltre la fine del file.");
      const blob = this.data.slice(off + HEADER_SIZE, off + HEADER_SIZE + length);
      this.metadata.push({ tag, length, dataBase64: Buffer.from(blob).toString("base64") });
      off = next;
    }
  }

  /** Legge un hunk (cache dell'ultimo). */
  readHunk(index: number): Uint8Array {
    if (index < 0 || index >= this.hunkCount) throw new Error(`Hunk ${index} fuori range (${this.hunkCount}).`);
    if (this.hunkCache?.index === index) return this.hunkCache.data;
    const e = this.map[index];
    let out: Uint8Array;
    if (e.compression === COMPRESSION.NONE) {
      out = this.data.slice(e.offset, e.offset + this.hunkBytes);
      if (out.length < this.hunkBytes) { const p = new Uint8Array(this.hunkBytes); p.set(out); out = p; }
    } else if (e.compression === COMPRESSION.SELF) {
      out = this.readHunk(e.offset); // hunk duplicato
    } else {
      // codec 0 = zlib: inflate raw
      out = new Uint8Array(inflateRawSync(Buffer.from(this.data.slice(e.offset, e.offset + e.length))));
      if (out.length !== this.hunkBytes) throw new Error(`Hunk CHD ${index} decompresso a ${out.length} byte invece di ${this.hunkBytes}.`);
    }
    this.hunkCache = { index, data: out };
    return out;
  }

  /** Legge un intervallo logico di byte (attraversa gli hunk). */
  readLogical(offset: number, length: number): Uint8Array {
    if (offset + length > this.logicalBytes) throw new Error(`Lettura logica oltre la fine (${offset}+${length} > ${this.logicalBytes}).`);
    const out = new Uint8Array(length);
    let done = 0;
    while (done < length) {
      const pos = offset + done;
      const hunkIdx = Math.floor(pos / this.hunkBytes);
      const inHunk = pos % this.hunkBytes;
      const take = Math.min(this.hunkBytes - inHunk, length - done);
      out.set(this.readHunk(hunkIdx).slice(inHunk, inHunk + take), done);
      done += take;
    }
    return out;
  }

  get info(): ChdInfo {
    return {
      version: this.version,
      logicalBytes: this.logicalBytes,
      hunkBytes: this.hunkBytes,
      unitBytes: this.unitBytes,
      hunkCount: this.hunkCount,
      codecs: this.codecs,
      hasParent: this.hasParent,
      metadata: this.metadata,
    };
  }
}
