/**
 * 🦔 Decompressore Nemesis (Sega Mega Drive) — formato delle art/tile.
 *
 * Algoritmo trascritto fedelmente (variabili rinominate, nessun codice
 * copiato) da flamewing/mdcomp src/lib/nemesis.cc (LGPL-3: usato SOLO come
 * riferimento di formato; la specifica è pubblica, documentata su
 * segaretro.org/Nemesis_compression).
 *
 * Struttura:
 *   u16 BE iniziale: bit15 = modalità "alternating output" (XOR cascade),
 *                    bit0-14 = numero di tile da produrre (1 tile = 32 byte)
 *   Tabella codici (terminata da 0xFF): per ogni voce
 *     byte con bit80 settato → cambia il nibble corrente (byte & 0xF);
 *     poi: run_count = ((b & 0x70) >> 4) + 1; code_len = b & 0xF;
 *     il byte seguente è il codice → mappa [code, len] = (nibble, count)
 *   Stream di bit (LSB-prima per byte): codici letti accumulando
 *   MSB-prima (code = (code<<1)|bit). Pattern 0b111111 a len 6 = RLE
 *   inline (3 bit conteggio-1 + 4 bit nibble). Ogni run emette `count`
 *   copie del nibble. Fine: bits_written raggiunge tiles×256 bit.
 *   Uscita alternating: XOR progressivo di word u32 LE.
 *
 * Onestà dichiarata: SOLO decompressione. L'encoder Nemesis (costruzione
 * della tabella codici ottimale) non è implementato in questa versione.
 */

export function isNemesis(_data: Uint8Array): boolean {
  // il formato non ha un magic: l'header è interpretato sempre (il chiamante
  // sa dal contesto, es. offset noti nella ROM, che il blob è Nemesis)
  return _data.length >= 4;
}

/** Bit reader LSB-prima per byte (come ibitstream<uint8_t,true>). */
class BitReader {
  private byte = 0;
  private bitsLeft = 0;
  constructor(private data: Uint8Array, private pos: number) {}
  bit(): number {
    if (this.bitsLeft === 0) {
      if (this.pos >= this.data.length) throw new Error("Stream Nemesis troncato (bit richiesto oltre la fine).");
      this.byte = this.data[this.pos++];
      this.bitsLeft = 8;
    }
    const b = this.byte & 1;
    this.byte >>>= 1;
    this.bitsLeft--;
    return b;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit(); // MSB-first field
    return v;
  }
  raw(): number {
    if (this.pos >= this.data.length) throw new Error("Stream Nemesis troncato.");
    return this.data[this.pos++];
  }
}

/** Writer di nibble → byte. */
class NibbleWriter {
  private bytes: number[] = [];
  private high = false;
  writeNibble(n: number): void {
    if (!this.high) {
      this.bytes.push((n & 0xf) << 4);
      this.high = true;
    } else {
      this.bytes[this.bytes.length - 1] |= n & 0xf;
      this.high = false;
    }
  }
  get length(): number { return this.bytes.length; }
  toBytes(): Uint8Array { return new Uint8Array(this.bytes); }
}

export function nemesisDecompress(data: Uint8Array): Uint8Array {
  if (data.length < 3) throw new Error(`Dati Nemesis troppo corti (${data.length} byte).`);

  let pos = 0;
  const be16 = () => { const v = (data[pos] << 8) | data[pos + 1]; pos += 2; return v >>> 0; };
  const raw = () => { if (pos >= data.length) throw new Error("Header Nemesis troncato."); return data[pos++]; };

  const first = be16();
  const altOut = (first & 0x8000) !== 0;
  const rtiles = first & 0x7fff;
  if (rtiles === 0) throw new Error("Nemesis con 0 tile dichiarati: niente da decomprimere.");

  // --- tabella codici ---
  const codemap = new Map<string, { nibble: number; count: number }>();
  let outVal = 0;
  for (let inVal = raw(); inVal !== 0xff; inVal = raw()) {
    if (inVal & 0x80) {
      outVal = inVal & 0xf;
      inVal = raw();
    }
    const count = ((inVal & 0x70) >> 4) + 1;
    const code = raw();
    const len = inVal & 0xf;
    codemap.set(code + ":" + len, { nibble: outVal, count });
  }

  // --- stream ---
  const bits = new BitReader(data, pos);
  const out = new NibbleWriter();
  const totalBits = rtiles << 8; // tiles × 32 byte × 8 bit
  let bitsWritten = 0;

  let code = bits.bit();
  let len = 1;

  while (bitsWritten < totalBits) {
    let nibble: number;
    let cnt: number;

    if (code === 0x3f && len === 6) {
      // RLE inline: 3 bit conteggio-1 + 4 bit nibble
      cnt = bits.bits(3) + 1;
      nibble = bits.bits(4);
    } else {
      const hit = codemap.get(code + ":" + len);
      if (hit === undefined) {
        code = ((code << 1) | bits.bit()) & 0xff;
        len++;
        if (len > 8) throw new Error("Codice Nemesis più lungo di 8 bit senza match: stream corrotto o non Nemesis.");
        continue;
      }
      nibble = hit.nibble;
      cnt = hit.count;
    }

    bitsWritten += cnt * 4;
    for (let i = 0; i < cnt; i++) out.writeNibble(nibble);

    if (bitsWritten >= totalBits) break;
    code = bits.bit();
    len = 1;
  }

  const tileBytes = out.toBytes().slice(0, rtiles << 5);

  if (!altOut) return tileBytes;

  // modalità alternating: XOR progressivo di word u32 LE (da in_val^prev)
  const result = new Uint8Array(tileBytes.length);
  const dvIn = new DataView(tileBytes.buffer);
  const dvOut = new DataView(result.buffer);
  let prev = 0;
  for (let o = 0; o + 4 <= tileBytes.length; o += 4) {
    const cur = dvIn.getUint32(o, true);
    prev = (cur ^ prev) >>> 0;
    dvOut.setUint32(o, prev, true);
  }
  return result;
}
