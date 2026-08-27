/**
 * 🗜️ Lettore ZIP minimale reale (nessuna dipendenza esterna)
 *
 * Legge gli archivi ZIP leggendo la struttura binaria standard
 * (PKWARE APPNOTE): End of Central Directory (PK\x05\x06) → Central
 * Directory (PK\x01\x02) → Local File Header (PK\x03\x04). Supporta i due
 * metodi standard: 0 (stored, dati copiati tal quali) e 8 (deflate raw,
 * decompresso con zlib). Le dimensioni autoritative sono quelle della
 * Central Directory (i local header possono avere size=0 con data
 * descriptor quando il bit 3 è attivo).
 *
 * Non supporta (dichiarato onestamente): ZIP64, crittografia, metodi di
 * compressione non standard — in quei casi l'entry viene riportata con
 * errore esplicito invece di essere saltata in silenzio.
 */

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  compressed: boolean;
}

function findEocd(b: Uint8Array): number {
  // EOCD: scan dagli ultimi 64KB (commento max 65535 byte)
  const start = Math.max(0, b.length - 0xffff - 22);
  for (let i = b.length - 22; i >= start; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
  }
  return -1;
}

const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function isZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07);
}

/**
 * Estrae tutte le entry di uno ZIP. Lancia errore esplicito per archivi
 * ZIP64 o con voci crittografate (flag bit 0), mai fallback silenziosi.
 */
export function unzip(data: Uint8Array): ZipEntry[] {
  if (!isZip(data)) throw new Error("Il file non è uno ZIP (firma 'PK' mancante).");
  const eocd = findEocd(data);
  if (eocd < 0) throw new Error("Struttura ZIP non riconosciuta: End of Central Directory non trovato.");

  const entryCount = le16(data, eocd + 10);
  let cdOffset = le32(data, eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error("Archivio ZIP64 non supportato da questo lettore (usa uno ZIP standard).");

  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (le32(data, cdOffset) !== 0x02014b50) throw new Error(`Central Directory corrotta alla voce ${i}.`);
    const flags = le16(data, cdOffset + 8);
    if (flags & 0x1) throw new Error(`Voce ${i}: ZIP crittografato non supportato.`);
    const method = le16(data, cdOffset + 10);
    const compSize = le32(data, cdOffset + 20);
    const nameLen = le16(data, cdOffset + 28);
    const extraLen = le16(data, cdOffset + 30);
    const commentLen = le16(data, cdOffset + 32);
    const localOffset = le32(data, cdOffset + 42);
    const name = new TextDecoder().decode(data.slice(cdOffset + 46, cdOffset + 46 + nameLen));

    // salta directory (terminano con /)
    if (!name.endsWith("/")) {
      // local header: nome ed extra possono differire da quelli del CD
      if (le32(data, localOffset) !== 0x04034b50) throw new Error(`Local header non valido per la voce "${name}".`);
      const lNameLen = le16(data, localOffset + 26);
      const lExtraLen = le16(data, localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = data.slice(dataStart, dataStart + compSize);

      if (method === 0) {
        entries.push({ name, data: new Uint8Array(raw), compressed: false });
      } else if (method === 8) {
        entries.push({ name, data: new Uint8Array(inflateRawSync(Buffer.from(raw))), compressed: true });
      } else {
        throw new Error(`Voce "${name}": metodo di compressione ${method} non supportato (attesi 0 stored o 8 deflate).`);
      }
    }
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
