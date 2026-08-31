import { describe, expect, test } from "bun:test";
import { ChdFile, isChd } from "../src/chd";

/**
 * 🛡️ Test di regressione per bug reali trovati in questa sessione nel
 * lettore CHD v5, scritto da una sessione precedente e mai eseguito con
 * successo prima d'ora:
 *
 * 1. `const repcount` decrementato con `repcount--` in importTreeRle:
 *    errore di compilazione reale (TS1332-equivalente), il file non
 *    veniva nemmeno transpilato. Corretto in `let`.
 * 2. readMetadata() assumeva il layout sbagliato dell'header metadata
 *    (leggeva "next" a offset 0 e "length" come 4 byte pieni a offset 12);
 *    il layout reale di MAME (verificato contro src/lib/util/chd.cpp) è
 *    metatag(4)@0, flags(1)@4, length a 24 bit@5, next(8)@8. Con
 *    l'assunzione sbagliata ogni entry sarebbe stata letta come
 *    spazzatura, rompendo esattamente la feature per cui il modulo
 *    esisteva (leggere i tag CHT2/traccia dei CHD Dreamcast/PSP).
 *
 * Costruiamo qui un CHD v5 sintetico byte-per-byte secondo lo header v5 e
 * il formato mappa compressa Huffman-RLE reali (nessun tool esterno
 * necessario: la mappa usa hunk COMPRESSION_NONE, che non richiede zlib),
 * poi lo leggiamo con la classe reale — non un mock.
 */

const NONE_TYPE = 4; // COMPRESSION_NONE

/** Scrittore bitstream MSB-first, simmetrico a BitstreamIn del modulo. */
class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private bitCount = 0;
  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      const bit = (value >>> i) & 1;
      this.cur = (this.cur << 1) | bit;
      this.bitCount++;
      if (this.bitCount === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.bitCount = 0;
      }
    }
  }
  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.cur <<= 8 - this.bitCount;
      this.bytes.push(this.cur);
    }
    return new Uint8Array(this.bytes);
  }
}

/** Costruisce la mappa compressa: un solo simbolo Huffman (NONE_TYPE, lunghezza 1), N hunk. */
function buildCompressedMap(hunkCount: number): Uint8Array {
  const w = new BitWriter();
  // albero RLE: per ogni nodo 0..15, se è NONE_TYPE emette la sequenza
  // di escape "1,1" (lunghezza=1), altrimenti il letterale 0 (lunghezza=0).
  for (let node = 0; node < 16; node++) {
    if (node === NONE_TYPE) {
      w.write(1, 4); // escape
      w.write(1, 4); // "lunghezza 1"
    } else {
      w.write(0, 4); // letterale: lunghezza 0 (simbolo inutilizzato)
    }
  }
  // stream dei tipi: essendo l'unico simbolo con lunghezza 1, il suo
  // codice canonico è "0" (un solo bit) — un bit per hunk.
  for (let i = 0; i < hunkCount; i++) w.write(0, 1);
  // campi per hunk di tipo NONE: solo un crc16 (non validato dal reader).
  for (let i = 0; i < hunkCount; i++) w.write(0, 16);
  return w.finish();
}

function be32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}
function be64(v: number): number[] {
  const hi = Math.floor(v / 0x100000000);
  const lo = v >>> 0;
  return [...be32(hi), ...be32(lo)];
}
function be48(v: number): number[] {
  return be64(v).slice(2); // solo i 6 byte bassi
}

/** Costruisce un CHD v5 sintetico completo con N hunk COMPRESSION_NONE + 1 metadata entry. */
function buildSyntheticChd(hunkBytes: number, hunkCount: number, metaTag: string, metaPayload: Uint8Array): Uint8Array {
  const logicalBytes = hunkBytes * hunkCount;
  const HEADER_SIZE = 124;
  const MAP_HEADER_SIZE = 16;

  const compressedMap = buildCompressedMap(hunkCount);
  const mapOffset = HEADER_SIZE;
  const hunkDataOffset = mapOffset + MAP_HEADER_SIZE + compressedMap.length;
  const metaOffset = hunkDataOffset + logicalBytes;

  const metaTagBytes = [...new TextEncoder().encode(metaTag)];
  const metaHeader = [
    ...metaTagBytes, // metatag @0
    0, // flags @4
    ...be32(metaPayload.length).slice(1), // length a 24 bit @5 (i 3 byte bassi di be32)
    ...be64(0), // next @8 (fine catena)
  ];

  const totalSize = metaOffset + metaHeader.length + metaPayload.length;
  const out = new Uint8Array(totalSize);

  // header v5
  out.set(new TextEncoder().encode("MComprHD"), 0);
  out.set(be32(HEADER_SIZE), 8);
  out.set(be32(5), 12); // version
  out.set(new TextEncoder().encode("zlib"), 16); // compressors[0] — dichiarato ma non usato (nessun hunk compresso qui)
  out.set(be64(logicalBytes), 32);
  out.set(be64(mapOffset), 40);
  out.set(be64(metaOffset), 48);
  out.set(be32(hunkBytes), 56);
  out.set(be32(hunkBytes), 60); // unitbytes = hunkbytes per semplicità

  // map header (16 byte): mapbytes(4) + firstoffs(6) + mapcrc(2) + lengthbits(1) + selfbits(1) + parentbits(1) + pad(1)
  out.set(be32(compressedMap.length), mapOffset);
  out.set(be48(hunkDataOffset), mapOffset + 4);
  // mapcrc @+10 non validato dal reader, lasciato a 0
  out[mapOffset + 12] = 8; // lengthbits (non usato: nessun hunk TYPE_0..3 qui)
  out[mapOffset + 13] = 8; // selfbits (non usato: nessun hunk SELF qui)
  out[mapOffset + 14] = 8; // parentbits
  out.set(compressedMap, mapOffset + MAP_HEADER_SIZE);

  // dati hunk grezzi (pattern riconoscibile per hunk)
  for (let h = 0; h < hunkCount; h++) {
    const hunk = new Uint8Array(hunkBytes).fill((h + 1) & 0xff);
    out.set(hunk, hunkDataOffset + h * hunkBytes);
  }

  // metadata entry
  out.set(metaHeader, metaOffset);
  out.set(metaPayload, metaOffset + metaHeader.length);

  return out;
}

describe("ChdFile (v5, hunk COMPRESSION_NONE, mappa Huffman-RLE reale)", () => {
  test("isChd riconosce il magic", () => {
    const chd = buildSyntheticChd(64, 2, "TEST", new TextEncoder().encode("hello"));
    expect(isChd(chd)).toBe(true);
    expect(isChd(new Uint8Array(200))).toBe(false);
  });

  test("legge header, hunk grezzi e metadata correttamente (bug reali corretti)", () => {
    const hunkBytes = 64;
    const hunkCount = 3;
    const metaPayload = new TextEncoder().encode("CDROM|1234/2352 MODE1/2048");
    const chd = buildSyntheticChd(hunkBytes, hunkCount, "CHT2", metaPayload);

    const f = new ChdFile(chd);
    expect(f.version).toBe(5);
    expect(f.hunkBytes).toBe(hunkBytes);
    expect(f.hunkCount).toBe(hunkCount);
    expect(f.logicalBytes).toBe(hunkBytes * hunkCount);
    expect(f.hasParent).toBe(false);

    // hunk grezzi: readHunk deve restituire esattamente il pattern scritto
    for (let h = 0; h < hunkCount; h++) {
      const data = f.readHunk(h);
      expect(data.length).toBe(hunkBytes);
      expect(data.every((b) => b === ((h + 1) & 0xff))).toBe(true);
    }

    // lettura logica cross-hunk
    const logical = f.readLogical(hunkBytes - 4, 8); // attraversa hunk 0 e 1
    expect(new Set(logical.slice(0, 4))).toEqual(new Set([1]));
    expect(new Set(logical.slice(4, 8))).toEqual(new Set([2]));

    // metadata: prima del fix leggeva tag/length/next dagli offset
    // sbagliati e avrebbe prodotto un tag spazzatura o lanciato un errore
    // di troncamento/oltre-la-fine.
    expect(f.metadata.length).toBe(1);
    expect(f.metadata[0].tag).toBe("CHT2");
    expect(f.metadata[0].length).toBe(metaPayload.length);
    const decoded = Buffer.from(f.metadata[0].dataBase64, "base64");
    expect(new Uint8Array(decoded)).toEqual(metaPayload);
  });

  test("rifiuta un file senza il magic MComprHD", () => {
    expect(() => new ChdFile(new Uint8Array(200))).toThrow();
  });

  test("readHunk rifiuta un indice fuori range", () => {
    const chd = buildSyntheticChd(64, 2, "TEST", new Uint8Array(0));
    const f = new ChdFile(chd);
    expect(() => f.readHunk(5)).toThrow();
  });
});
