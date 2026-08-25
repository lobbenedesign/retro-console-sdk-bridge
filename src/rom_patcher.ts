/**
 * 🩹 Patcher di ROM reale (formati IPS e BPS)
 *
 * Applica una patch (contenente solo un DIFF byte-a-byte, mai dati di gioco
 * originali) a un file ROM che l'utente fornisce dal proprio disco. Non
 * scarica, non ospita e non distribuisce MAI alcuna ROM: opera solo sui
 * byte che gli vengono passati in input da un client locale.
 *
 * Stesso principio degli strumenti reali della community ROM hacking/
 * traduzioni amatoriali: Floating IPS (github.com/Alcaro/Flips), Lunar IPS,
 * xdelta. Il formato IPS qui implementato segue la specifica pubblica
 * documentata su zerosoft.zophar.net/ips.php; il formato BPS segue la
 * specifica "beat" di byuu (github.com/blakesmith/rombp e vari port).
 */

// --- CRC32 reale (polinomio standard IEEE 802.3, 0xEDB88320) ---------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface PatchResult {
  outputBytes: Uint8Array;
  format: "IPS" | "BPS";
  inputSizeBytes: number;
  outputSizeBytes: number;
  sourceCrc32: string;
  targetCrc32: string;
  expectedSourceCrc32: string | null; // solo BPS: dichiarato dentro la patch
  expectedTargetCrc32: string | null; // solo BPS: dichiarato dentro la patch
  sourceCrcMatched: boolean | null;
  targetCrcMatched: boolean | null;
  patchesApplied: number;
}

function toHex(n: number): string {
  return n.toString(16).padStart(8, "0");
}

/**
 * Applica una patch IPS reale. Formato: header "PATCH" (5 byte), poi record
 * fino al marker "EOF" (3 byte): offset (3 byte big-endian), size (2 byte
 * big-endian). Se size==0 è un record RLE (2 byte run-length + 1 byte
 * valore); altrimenti size byte di dati letterali seguono. Supporta anche
 * il record di troncamento finale opzionale (3 byte dopo EOF).
 */
export function applyIpsPatch(source: Uint8Array, patch: Uint8Array): PatchResult {
  if (patch.length < 8 || String.fromCharCode(...patch.slice(0, 5)) !== "PATCH") {
    throw new Error("File patch non è un IPS valido: header 'PATCH' mancante.");
  }

  const out = new Uint8Array(source);
  let output: number[] = Array.from(out);
  let pos = 5;
  let recordsApplied = 0;

  while (pos + 3 <= patch.length) {
    if (patch[pos] === 0x45 && patch[pos + 1] === 0x4f && patch[pos + 2] === 0x46) {
      // "EOF"
      pos += 3;
      break;
    }
    const offset = (patch[pos] << 16) | (patch[pos + 1] << 8) | patch[pos + 2];
    pos += 3;
    const size = (patch[pos] << 8) | patch[pos + 1];
    pos += 2;

    if (size === 0) {
      // Record RLE reale
      const runLength = (patch[pos] << 8) | patch[pos + 1];
      pos += 2;
      const value = patch[pos];
      pos += 1;
      for (let i = 0; i < runLength; i++) output[offset + i] = value;
    } else {
      for (let i = 0; i < size; i++) output[offset + i] = patch[pos + i];
      pos += size;
    }
    recordsApplied++;
  }

  // Record di troncamento finale opzionale reale (3 byte dopo EOF = nuova dimensione file)
  if (pos + 3 <= patch.length) {
    const truncSize = (patch[pos] << 16) | (patch[pos + 1] << 8) | patch[pos + 2];
    if (truncSize <= output.length) output = output.slice(0, truncSize);
  }

  const outputBytes = new Uint8Array(output);
  return {
    outputBytes,
    format: "IPS",
    inputSizeBytes: source.length,
    outputSizeBytes: outputBytes.length,
    sourceCrc32: toHex(crc32(source)),
    targetCrc32: toHex(crc32(outputBytes)),
    expectedSourceCrc32: null,
    expectedTargetCrc32: null,
    sourceCrcMatched: null,
    targetCrcMatched: null,
    patchesApplied: recordsApplied
  };
}

// --- BPS (formato "beat" di byuu) -------------------------------------------

class BpsReader {
  constructor(private data: Uint8Array, public pos = 0) {}
  readByte(): number {
    return this.data[this.pos++];
  }
  // Intero a lunghezza variabile reale del formato BPS: 7 bit per byte,
  // bit alto = continuazione, ultimo byte ha bit alto settato per marcare fine.
  readVarInt(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.readByte();
      result += (byte & 0x7f) * shift;
      if (byte & 0x80) break;
      shift <<= 7;
      result += shift;
    }
    return result;
  }
  readBytes(n: number): Uint8Array {
    const slice = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
}

/**
 * Applica una patch BPS reale (formato "beat" di byuu, usato ampiamente
 * nella community di traduzioni fan/ROM hacking per la sua verifica di
 * integrità integrata via CRC32). Verifica realmente i checksum sorgente/
 * destinazione dichiarati nella patch contro quelli calcolati sui byte
 * reali: se il checksum sorgente non combacia, la ROM fornita NON è quella
 * per cui la patch è stata creata — riportato onestamente, mai ignorato.
 */
export function applyBpsPatch(source: Uint8Array, patch: Uint8Array): PatchResult {
  if (patch.length < 4 + 12 || String.fromCharCode(...patch.slice(0, 4)) !== "BPS1") {
    throw new Error("File patch non è un BPS valido: header 'BPS1' mancante.");
  }

  const reader = new BpsReader(patch, 4);
  const sourceSize = reader.readVarInt();
  const targetSize = reader.readVarInt();
  const metadataSize = reader.readVarInt();
  reader.readBytes(metadataSize); // metadata testuale (spesso XML), non usata qui

  const output = new Uint8Array(targetSize);
  let outputOffset = 0;
  let sourceRelOffset = 0;
  let targetRelOffset = 0;

  const footerStart = patch.length - 12;

  while (reader.pos < footerStart) {
    const data = reader.readVarInt();
    const mode = data & 3;
    const length = (data >> 2) + 1;

    if (mode === 0) {
      // SourceRead: copia dalla sorgente alla stessa posizione di output corrente
      for (let i = 0; i < length; i++) output[outputOffset + i] = source[outputOffset + i];
    } else if (mode === 1) {
      // TargetRead: dati letterali direttamente dalla patch
      const literal = reader.readBytes(length);
      output.set(literal, outputOffset);
    } else if (mode === 2) {
      // SourceCopy: copia da un offset relativo nella sorgente (con segno, zig-zag reale del formato)
      const raw = reader.readVarInt();
      const sign = raw & 1 ? -1 : 1;
      sourceRelOffset += sign * (raw >> 1);
      for (let i = 0; i < length; i++) output[outputOffset + i] = source[sourceRelOffset + i];
      sourceRelOffset += length;
    } else {
      // TargetCopy: copia da un offset relativo già scritto nell'output (permette RLE reale)
      const raw = reader.readVarInt();
      const sign = raw & 1 ? -1 : 1;
      targetRelOffset += sign * (raw >> 1);
      for (let i = 0; i < length; i++) output[outputOffset + i] = output[targetRelOffset + i];
      targetRelOffset += length;
    }
    outputOffset += length;
  }

  const view = new DataView(patch.buffer, patch.byteOffset + footerStart, 12);
  const expectedSourceCrc = view.getUint32(0, true);
  const expectedTargetCrc = view.getUint32(4, true);

  const realSourceCrc = crc32(source);
  const realTargetCrc = crc32(output);

  return {
    outputBytes: output,
    format: "BPS",
    inputSizeBytes: source.length,
    outputSizeBytes: output.length,
    sourceCrc32: toHex(realSourceCrc),
    targetCrc32: toHex(realTargetCrc),
    expectedSourceCrc32: toHex(expectedSourceCrc >>> 0),
    expectedTargetCrc32: toHex(expectedTargetCrc >>> 0),
    sourceCrcMatched: (realSourceCrc >>> 0) === (expectedSourceCrc >>> 0),
    targetCrcMatched: (realTargetCrc >>> 0) === (expectedTargetCrc >>> 0),
    patchesApplied: 1
  };
}

export function detectPatchFormat(patch: Uint8Array): "IPS" | "BPS" | null {
  if (patch.length >= 5 && String.fromCharCode(...patch.slice(0, 5)) === "PATCH") return "IPS";
  if (patch.length >= 4 && String.fromCharCode(...patch.slice(0, 4)) === "BPS1") return "BPS";
  return null;
}

export function applyPatch(source: Uint8Array, patch: Uint8Array): PatchResult {
  const format = detectPatchFormat(patch);
  if (format === "IPS") return applyIpsPatch(source, patch);
  if (format === "BPS") return applyBpsPatch(source, patch);
  throw new Error("Formato patch non riconosciuto: attesi header 'PATCH' (IPS) o 'BPS1' (BPS).");
}
