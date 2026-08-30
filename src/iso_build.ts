/**
 * 📀 Builder ISO9660 — ricostruisce un'immagine da un albero di file.
 *
 * Inverso del parser src/psp_iso.ts (stesso standard, layout semplificato):
 *   - settori 0-15: preservati dall'originale (per il Dreamcast contengono
 *     l'IP.BIN di boot; per la PSP sono vuoti)
 *   - 16: Primary Volume Descriptor (system/volume id preservati)
 *   - 17: Volume Descriptor Terminator
 *   - 18+: path table L + M, poi le directory (BFS), poi i file
 *
 * Limiti dichiarati onestamente:
 *   - niente file multi-extent, interleaving, multi-sessione;
 *   - nomi file SENZA suffisso di versione ";1" (convenzione delle immagini
 *     PSP della pratica: Redump; il parser lo tollera comunque);
 *   - date dei record a zero (i driver di gioco non le usano);
 *   - validazione = round-trip col nostro parser + struttura standard:
 *     NON testato su giochi reali in sviluppo (policy del progetto).
 */

const SECTOR = 2048;

export interface BuildFile {
  path: string; // "DIR1/DIR2/NAME.EXT" (radice implicita)
  data: Uint8Array;
}

interface DirNode {
  name: string;
  dirs: Map<string, DirNode>;
  files: Map<string, Uint8Array>;
  lba: number; // assegnato in fase di layout
  extentSectors: number;
}

function newDir(name: string): DirNode {
  return { name, dirs: new Map(), files: new Map(), lba: 0, extentSectors: 1 };
}

/** Record di directory ISO9660 (inverso del parser). */
function dirRecord(name: number[] | string, lba: number, size: number, isDir: boolean): Uint8Array {
  const nameBytes = typeof name === "string" ? [...new TextEncoder().encode(name)] : name;
  let len = 33 + nameBytes.length;
  if (len % 2 !== 0) { nameBytes.push(0); len++; } // padding a pari come nello standard
  const rec = new Uint8Array(len);
  rec[0] = len;
  const dv = new DataView(rec.buffer);
  dv.setUint32(2, lba, true); dv.setUint32(6, lba, false);
  dv.setUint32(10, size, true); dv.setUint32(14, size, false);
  rec[25] = isDir ? 0x02 : 0x00;
  rec[32] = nameBytes.length === 1 && (nameBytes[0] === 0 || nameBytes[0] === 1) ? 1 : nameBytes.length;
  rec.set(nameBytes, 33);
  return rec;
}

function sectorCount(bytes: number): number {
  return Math.ceil(bytes / SECTOR) || 1;
}

export interface BuildIsoOptions {
  systemId?: string;
  volumeId?: string;
  preserveSectors0to15?: Uint8Array; // es. IP.BIN del Dreamcast (16 settori)
}

export function buildIso9660(files: BuildFile[], opts: BuildIsoOptions = {}): Uint8Array {
  if (files.length === 0) throw new Error("Nessun file da inserire nell'immagine.");

  // 1. albero
  const root = newDir("");
  for (const f of files) {
    const parts = f.path.toUpperCase().split("/").filter(Boolean);
    if (parts.length === 0) throw new Error("Percorso file vuoto.");
    const name = parts.pop()!;
    let dir = root;
    for (const p of parts) {
      if (!dir.dirs.has(p)) dir.dirs.set(p, newDir(p));
      dir = dir.dirs.get(p)!;
    }
    dir.files.set(name, f.data);
  }

  // 2. path table records (L e M): una voce per directory inclusa la radice
  const collectDirsBfs = (): DirNode[] => {
    const out: DirNode[] = [root];
    for (let i = 0; i < out.length; i++) {
      for (const d of out[i].dirs.values()) out.push(d);
    }
    return out;
  };
  const allDirs = collectDirsBfs();

  const pathTableEntry = (dir: DirNode, parentIndex: number): number[] => {
    const nameBytes = dir === root ? [0] : [...new TextEncoder().encode(dir.name)];
    const bytes: number[] = [];
    bytes.push(nameBytes.length, 0);
    const lbaLE = new Uint8Array(4); new DataView(lbaLE.buffer).setUint32(0, dir.lba, true);
    bytes.push(...lbaLE);
    const parentLE = new Uint8Array(2); new DataView(parentLE.buffer).setUint16(0, parentIndex, true);
    bytes.push(...parentLE);
    bytes.push(...nameBytes);
    if (bytes.length % 2 !== 0) bytes.push(0);
    return bytes;
  };
  // le voci hanno bisogno degli LBA: prima assegnamo gli LBA delle directory
  const dirIndex = new Map<DirNode, number>(); // indice path table (radice = 1)
  allDirs.forEach((d, i) => dirIndex.set(d, i + 1));

  // dimensione path table (per il layout serve prima degli LBA: due pass)
  const computePathTableSize = (): number => {
    let size = 0;
    for (const d of allDirs) {
      const nameBytes = d === root ? 1 : new TextEncoder().encode(d.name).length;
      size += 8 + nameBytes + ((8 + nameBytes) % 2 !== 0 ? 1 : 0);
    }
    return size;
  };
  const ptSize = computePathTableSize();
  const ptSectors = sectorCount(ptSize);

  // 3. layout: 16 + PVD + terminator + 2 path table + directory (BFS) + file
  let nextLba = 16 + 1 + 1 + 2 * ptSectors;
  for (const d of allDirs) {
    d.lba = nextLba;
    const records: Uint8Array[] = [
      dirRecord([0], 0, 0, true), // placeholder: self (size/lba riempiti sotto)
    ];
    void records;
    // dimensione stimata: somma dei record
    let size = 33 + 2 + 33 + 2; // self + parent approssimati
    for (const [name] of d.dirs) size += 33 + new TextEncoder().encode(name).length + 2;
    for (const [name, data] of d.files) size += 33 + new TextEncoder().encode(name).length + 2 + 0 * data.length;
    d.extentSectors = sectorCount(size + 64); // margine per padding dei record
    nextLba += d.extentSectors;
  }
  const fileEntries: Array<{ name: string; dirLba: number; data: Uint8Array; lba: number }> = [];
  for (const d of allDirs) {
    for (const [name, data] of d.files) {
      fileEntries.push({ name, dirLba: d.lba, data, lba: nextLba });
      nextLba += sectorCount(data.length);
    }
  }
  const totalSectors = nextLba;

  // 4. serializzazione
  const img = new Uint8Array(totalSectors * SECTOR);
  const put = (lba: number, bytes: Uint8Array) => img.set(bytes, lba * SECTOR);

  if (opts.preserveSectors0to15) {
    if (opts.preserveSectors0to15.length < 16 * SECTOR) throw new Error("preserveSectors0to15: servono 16 settori (32768 byte).");
    img.set(opts.preserveSectors0to15.slice(0, 16 * SECTOR), 0);
  }

  // directory content: ora con LBA reali
  for (const d of allDirs) {
    const parent = allDirs.find((x) => x.dirs.get(d.name) === d) ?? root; // BFS parent lookup
    // NB: lookup per mappa figli (robusta per nomi duplicati in dir diverse)
    let actualParent: DirNode | null = null;
    for (const cand of allDirs) { if (cand !== d && cand.dirs.get(d.name) === d) { actualParent = cand; break; } }
    if (!actualParent) actualParent = root; // d è la radice

    const size = d.extentSectors * SECTOR;
    const recs: Uint8Array[] = [
      dirRecord([0], d.lba, size, true),
      dirRecord([1], actualParent.lba, actualParent === root ? root.extentSectors * SECTOR : actualParent.extentSectors * SECTOR, true),
    ];
    for (const sub of d.dirs.values()) recs.push(dirRecord(sub.name, sub.lba, sub.extentSectors * SECTOR, true));
    for (const f of fileEntries.filter((f) => f.dirLba === d.lba)) recs.push(dirRecord(f.name, f.lba, f.data.length, false));
    const buf = new Uint8Array(size);
    let off = 0;
    for (const r of recs) { buf.set(r, off); off += r.length; }
    put(d.lba, buf);
  }

  // file data
  for (const f of fileEntries) put(f.lba, f.data);

  // path tables (L a 18, M subito dopo)
  const ptLba = 18;
  const ptMLba = 18 + ptSectors;
  for (const [which, lbaStart] of [["L", ptLba], ["M", ptMLba]] as const) {
    const table = new Uint8Array(ptSectors * SECTOR);
    let off = 0;
    for (const d of allDirs) {
      const nameBytes = d === root ? [0] : [...new TextEncoder().encode(d.name)];
      const parentIdx = dirIndex.get(d === root ? root : (allDirs.find((x) => x.dirs.get(d.name) === d) ?? root))!;
      table[off] = nameBytes.length; table[off + 1] = 0;
      const dv = new DataView(table.buffer, off);
      const le = which === "L"; // Type-L path table = little-endian, Type-M = big-endian (ECMA-119)
      dv.setUint32(2, d.lba, le);
      dv.setUint16(6, parentIdx, le);
      table.set(nameBytes, off + 8);
      off += 8 + nameBytes.length + ((8 + nameBytes.length) % 2 !== 0 ? 1 : 0);
    }
    put(lbaStart, table);
  }

  // PVD
  const pvd = new Uint8Array(SECTOR);
  pvd[0] = 1;
  pvd.set(new TextEncoder().encode("CD001"), 1);
  pvd[6] = 1;
  const pad32 = (s: string, off: number) => {
    const b = new TextEncoder().encode(s.toUpperCase().slice(0, 32));
    pvd.set(b, off);
    for (let i = b.length; i < 32; i++) pvd[off + i] = 0x20; // space padding
  };
  pad32(opts.systemId ?? "", 8);
  pad32(opts.volumeId ?? "RETROBUILD", 40);
  const dvP = new DataView(pvd.buffer);
  // Offset verificati contro ECMA-119/ISO 9660 (OSDev wiki, cross-check
  // indipendente): Volume Space Size 80/84, Volume Set Size 120/122,
  // Volume Sequence Number 124/126, Logical Block Size 128/130, Path
  // Table Size 132/136, Location of Type-L Path Table 140 (LE), Location
  // of Type-M Path Table 148 (BE). La versione precedente aveva questi
  // offset scalati in modo errato (partiva da 128 invece di 124 e
  // accumulava lo sfasamento), e scriveva la location Type-M in LE invece
  // che BE — bug reale trovato e corretto qui, mai coperto da un test.
  dvP.setUint32(80, totalSectors, true); dvP.setUint32(84, totalSectors, false);
  dvP.setUint16(120, 1, true); dvP.setUint16(122, 1, false); // volume set size
  dvP.setUint16(124, 1, true); dvP.setUint16(126, 1, false); // volume sequence number
  dvP.setUint16(128, SECTOR, true); dvP.setUint16(130, SECTOR, false); // logical block size
  dvP.setUint32(132, ptSize, true); dvP.setUint32(136, ptSize, false); // path table size
  dvP.setUint32(140, ptLba, true); // location of Type-L path table (LE)
  dvP.setUint32(148, ptMLba, false); // location of Type-M path table (BE)
  pvd.set(dirRecord([0], root.lba, root.extentSectors * SECTOR, true), 156);
  put(16, pvd);

  // terminator
  const term = new Uint8Array(SECTOR);
  term[0] = 255;
  term.set(new TextEncoder().encode("CD001"), 1);
  term[6] = 1;
  put(17, term);

  return img;
}
