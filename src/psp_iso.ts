/**
 * 📀 Parser ISO9660 per dischi PSP (ISO o CSO via SectorReader).
 *
 * Layout secondo lo standard ISO9660 (pubblico): settore 2048 byte,
 * Volume Descriptor a LBA 16 ("CD001"), directory record radice a offset
 * 156 del PVD. Ogni directory record:
 *   0     lunghezza record
 *   1     lunghezza extended attributes
 *   2-9   LBA (LE+BE u32)
 *   10-17 dimensione (LE+BE u32)
 *   25    flags (bit 1 = directory)
 *   32    lunghezza nome
 *   33+   nome (0x00 = self, 0x01 = parent; suffisso ";version" da trimmare)
 *
 * I dischi PSP (come letti da PPSSPP e UMDGen) sono ISO9660 con i nomi
 * reali del gioco sotto PSP_GAME/. La lettura dei settori passa dal
 * SectorReader: funziona identica su ISO nuda e CSO compresso.
 */

import type { SectorReader } from "./psp_cso";

export interface IsoEntry {
  path: string; // percorso completo, es. "PSP_GAME/USRDIR/DATA.BIN"
  name: string;
  isDir: boolean;
  size: number;
  lba: number;
}

const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | b[o + 3] * 0x10000) >>> 0;

function decodeName(raw: Uint8Array): string | null {
  if (raw.length === 1 && (raw[0] === 0x00 || raw[0] === 0x01)) return null; // self/parent
  let s = "";
  for (const b of raw) if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
  // rimuove il suffisso di versione ";1" standard ISO9660
  s = s.replace(/;\d+$/, "");
  return s.length ? s : null;
}

/** Parsa i record di una directory (i suoi byte = uno o più settori). */
function parseDirRecords(dirData: Uint8Array): Array<Omit<IsoEntry, "path">> {
  const out: Array<Omit<IsoEntry, "path">> = [];
  let off = 0;
  while (off < dirData.length) {
    const len = dirData[off];
    if (len === 0) { off = (Math.floor(off / 2048) + 1) * 2048; continue; } // padding a settore
    const lba = le32(dirData, off + 2);
    const size = le32(dirData, off + 10);
    const flags = dirData[off + 25];
    const nameLen = dirData[off + 32];
    const name = decodeName(dirData.slice(off + 33, off + 33 + nameLen));
    if (name) out.push({ name, isDir: (flags & 0x02) !== 0, size, lba });
    off += len;
  }
  return out;
}

function readExtent(reader: SectorReader, lba: number, size: number): Uint8Array {
  if (size === 0) return new Uint8Array(0);
  const sectorCount = Math.ceil(size / 2048);
  const out = new Uint8Array(sectorCount * 2048);
  for (let i = 0; i < sectorCount; i++) out.set(reader.readSector(lba + i), i * 2048);
  return out.slice(0, size);
}

export interface IsoListing {
  systemId: string;
  volumeId: string;
  entries: IsoEntry[];
  isLikelyPsp: boolean; // PSP_GAME presente nella radice
}

/**
 * Cammina l'albero delle directory di un'immagine. Limiti onesti per non
 * esplodere su immagini avvelenate: max 5000 voci, profondità 12.
 */
export function listIsoFiles(reader: SectorReader): IsoListing {
  // Volume Descriptor a LBA 16
  let pvd: Uint8Array | null = null;
  for (let lba = 16; lba < 20; lba++) {
    const sec = reader.readSector(lba);
    if (String.fromCharCode(sec[1], sec[2], sec[3], sec[4], sec[5]) === "CD001" && sec[0] === 1) { pvd = sec; break; }
  }
  if (!pvd) throw new Error("Primary Volume Descriptor ISO9660 non trovato (LBA 16-19): non sembra un'immagine ISO valida.");

  // i campi ISO9660 sono space-padded sullo standard, ma alcune immagini
  // della pratica usano zero-padding: ripuliamo entrambi
  const clean = (s: string) => s.replace(/[\0\s]+$/, "");
  const systemId = clean(String.fromCharCode(...pvd.slice(8, 40)));
  const volumeId = clean(String.fromCharCode(...pvd.slice(40, 72)));

  // directory record radice a offset 156 del PVD: LBA a 158, size a 166
  // (letti direttamente dai byte: il record radice è il record "self"
  // col nome 0x00, che parseDirRecords scarta per progettazione)
  if (pvd[156] < 34) throw new Error("Directory record radice ISO9660 troppo corto.");
  const rootLba = le32(pvd, 158);
  const rootSize = le32(pvd, 166);

  const entries: IsoEntry[] = [];
  const walk = (lba: number, size: number, prefix: string, depth: number) => {
    if (entries.length >= 5000 || depth > 12) return;
    for (const rec of parseDirRecords(readExtent(reader, lba, size))) {
      const path = prefix ? prefix + "/" + rec.name : rec.name;
      if (entries.length >= 5000) return;
      if (rec.isDir) {
        entries.push({ ...rec, path });
        walk(rec.lba, rec.size, path, depth + 1);
      } else {
        entries.push({ ...rec, path });
      }
    }
  };
  walk(rootLba, rootSize, "", 0);

  return {
    systemId,
    volumeId,
    entries,
    isLikelyPsp: entries.some((e) => e.path.toUpperCase() === "PSP_GAME" && e.isDir),
  };
}

/** Estrae un file per percorso completo (case-insensitive, come ISO9660). */
export function extractIsoFile(reader: SectorReader, entries: IsoEntry[], path: string): Uint8Array {
  const e = entries.find((x) => !x.isDir && x.path.toUpperCase() === path.toUpperCase().replace(/^\/+|\/+$/g, ""));
  if (!e) throw new Error(`File "${path}" non trovato nell'immagine.`);
  return readExtent(reader, e.lba, e.size);
}
