/**
 * 🦔 Codec Kosinski (Sega Mega Drive) — decompressione + ricompressione.
 *
 * Formato usato dai titoli Sega (Sonic in testa) per layout di livello e
 * dati. Semantica trascritta da DUE fonti reali e concordanti:
 *  - il decompressore 68000 CHE I GIOCHI ESEGUONO, src/asm/Kosinski.asm di
 *    flamewing/mdcomp (licenza 0BSD: public domain) — da qui l'ordine dei
 *    bit del descriptor;
 *  - la semantica dei token da src/lib/kosinski.cc dello stesso repo
 *    (LGPL-3: usato SOLO come riferimento di formato, nessun codice
 *    copiato; la specifica è pubblica, documentata su
 *    segaretro.org/Kosinski_compression).
 *
 * Descrittori: u16 little-endian, bit consumati LSB-prima (verificato
 * dalla LUT di inversione bit nel codice ASM reale). Il campo descriptor
 * precede i byte dei token che consumano i suoi bit (early descriptor).
 *
 * Token (dal decode reale):
 *   1                → letterale (1 byte)
 *   0 1 High Low     → dizionario separato: Count = High&7; se 0 →
 *                      extra=getbyte: 0=terminatore, 1=nuovo descriptor
 *                      (padding modulare), Count=extra+1; se !=0 →
 *                      Count+=2. distance = 0x2000-(((High&0xF8)<<5)|Low)
 *   0 0 (2 bit) byte → dizionario inline: Count = 2bit+2 (2..5),
 *                      distance = 0x100-byte (1..256)
 * Terminatore: 0 1 00 00 00.
 */

/** Reader di bit LSB-prima su u16 little-endian, early-descriptor. */
class DescReader {
  private bitsLeft = 0;
  private value = 0;
  private refillCount = 0;
  constructor(private data: Uint8Array, private pos: number) {
    // il primo descriptor va letto subito (early)
    this.reload();
  }
  get position(): number {
    return this.pos - (this.refillCount > 0 ? 0 : 0);
  }
  private reload(): void {
    if (this.pos + 2 > this.data.length) {
      this.value = 0;
      this.bitsLeft = 16; // esaurito: bit 0 a fine stream (honest padding)
      return;
    }
    this.value = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 2;
    this.bitsLeft = 16;
    this.refillCount++;
  }
  bit(): number {
    if (this.bitsLeft === 0) this.reload();
    const b = this.value & 1;
    this.value >>>= 1;
    this.bitsLeft--;
    return b;
  }
  byte(): number {
    if (this.pos >= this.data.length) throw new Error("Stream Kosinski troncato (byte richiesto oltre la fine).");
    return this.data[this.pos++];
  }
}

export function kosinskiDecompress(data: Uint8Array, maxOutput = 0x100000): Uint8Array {
  const src = new DescReader(data, 0);
  const out: number[] = [];

  outer: while (out.length < maxOutput) {
    if (src.bit() !== 0) {
      out.push(src.byte());
      continue;
    }

    if (src.bit() !== 0) {
      // dizionario separato
      const low = src.byte();
      const high = src.byte();
      let count = high & 0x07;
      if (count === 0) {
        count = src.byte();
        if (count === 0) break; // terminatore
        if (count === 1) continue outer; // nuovo descriptor (padding modulare)
        count += 1; // forma a 3 byte: 2..256
      } else {
        count += 2; // forma a 2 byte: 2..9
      }
      const distance = 0x2000 - (((high & 0xf8) << 5) | low);
      if (distance < 1 || distance > out.length) throw new Error(`Distanza Kosinski invalida (${distance}) con ${out.length} byte prodotti.`);
      for (let i = 0; i < count; i++) out.push(out[out.length - distance]);
    } else {
      // dizionario inline
      const high = src.bit();
      const low = src.bit();
      const count = ((high << 1) | low) + 2;
      const distance = 0x100 - src.byte();
      if (distance < 1 || distance > out.length) throw new Error(`Distanza inline Kosinski invalida (${distance}) con ${out.length} byte prodotti.`);
      for (let i = 0; i < count; i++) out.push(out[out.length - distance]);
    }
  }

  return new Uint8Array(out);
}

/**
 * Compressore Kosinski greedy (non size-ottimale, corretto per il
 * decompressore dei giochi): ricerca match più lungo nella finestra 8192,
 * lookahead 256; sceglie il token più economico tra inline (dist ≤ 256,
 * len 2..5), separato 2 byte (len 2..9) e separato 3 byte (len 2..256).
 */
class DescWriter {
  private bits: number[] = [];
  private out: number[] = [];
  private descPos = 0;
  constructor() {
    this.out.push(0, 0); // slot del primo descriptor (early)
    this.descPos = 0;
  }
  private flushDescriptor(): void {
    while (this.bits.length < 16) this.bits.push(0); // padding (mai letto: c'è il terminatore)
    let v = 0;
    // primo bit consumato = LSB del u16 LE
    for (let i = 0; i < 16; i++) v |= (this.bits[i] & 1) << i;
    this.out[this.descPos] = v & 0xff;
    this.out[this.descPos + 1] = (v >> 8) & 0xff;
  }
  private startNewDescriptor(): void {
    this.flushDescriptor();
    this.descPos = this.out.length;
    this.out.push(0, 0);
    this.bits = [];
  }
  token(bits: number[], bytes: number[]): void {
    // i bit di un token POSSONO attraversare due descriptor consecutivi
    // (il decompressore reale ricarica il descriptor tra una lettura di bit
    // e l'altra): si spingono bit per bit, e quando il descriptor è pieno
    // si fa flush e si riserva il nuovo slot PRIMA dei byte del token
    for (const b of bits) {
      if (this.bits.length === 16) {
        this.flushDescriptor();
        this.descPos = this.out.length;
        this.out.push(0, 0);
        this.bits = [];
      }
      this.bits.push(b);
    }
    this.out.push(...bytes);
  }
  finish(): Uint8Array {
    this.flushDescriptor();
    return new Uint8Array(this.out);
  }
}

export function kosinskiCompress(input: Uint8Array): Uint8Array {
  const w = new DescWriter();
  const MAX_DIST = 0x2000;
  let pos = 0;

  while (pos < input.length) {
    // match più lungo greedy nella finestra
    let bestLen = 0;
    let bestDist = 0;
    const windowStart = Math.max(0, pos - MAX_DIST);
    const maxLen = Math.min(256, input.length - pos);
    for (let start = windowStart; start < pos; start++) {
      let len = 0;
      while (len < maxLen && input[start + len] === input[pos + len]) len++;
      if (len > bestLen) {
        bestLen = len;
        bestDist = pos - start;
        if (bestLen === maxLen) break;
      }
    }

    if (bestLen < 2) {
      // letterale
      w.token([1], [input[pos]]);
      pos += 1;
      continue;
    }

    // LIMITE REALE DEL FORMATO (adattatore mdcomp: inline 2..5 con dist
    // <=256; separato 2-byte 3..9; separato 3-byte 10..256): un match di
    // lunghezza 2 con distanza > 256 NON è codificabile (il campo count
    // high&7 non può essere 0 nella forma a 2 byte). Ripiego onesto su
    // letterali invece di corrompere lo stream.
    if (bestLen === 2 && bestDist > 0x100) {
      // non codificabile: ripiego su letterale singolo (avanza SEMPRE)
      w.token([1], [input[pos]]);
      pos += 1;
      continue;
    }

    if (bestLen >= 2 && bestLen <= 5 && bestDist <= 0x100) {
      // inline: 2 bit descriptor (0,0) + 2 bit count-2 + dist-1 byte? NO:
      // count in 2 bit del descriptor, dist in un byte (0x100-dist)
      const countBits = bestLen - 2; // 0..3
      w.token([0, 0, (countBits >> 1) & 1, countBits & 1], [(0x100 - bestDist) & 0xff]);
      pos += bestLen;
    } else if (bestLen <= 9) {
      // separato 2 byte: High = (len-2) | stored13>>8, Low
      const stored = (0x2000 - bestDist) & 0x1fff;
      const high = ((bestLen - 2) & 7) | ((stored >> 5) & 0xf8); // dist 13-bit nei bit 3-7 di High
      const low = stored & 0xff;
      w.token([0, 1], [low, high]);
      pos += bestLen;
    } else {
      // separato 3 byte: count bits 0, extra = len-1
      const stored = (0x2000 - bestDist) & 0x1fff;
      const high = (stored >> 5) & 0xf8; // count field = 0, dist nei bit 3-7
      const low = stored & 0xff;
      w.token([0, 1], [low, high, bestLen - 1]);
      pos += bestLen;
    }
  }

  // terminatore: 0 1 + 00 00 00
  w.token([0, 1], [0x00, 0x00, 0x00]);
  return w.finish();
}
