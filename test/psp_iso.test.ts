import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { IsoReader, CsoReader, openSectorReader } from "../src/psp_cso";
import { listIsoFiles, extractIsoFile } from "../src/psp_iso";
import { identifyConsole } from "../src/rom_identify";

const SECTOR = 2048;

/** Costruisce un directory record ISO9660. */
function dirRecord(name: string, lba: number, size: number, isDir: boolean): Uint8Array {
  const nameBytes = name === "\x00" ? [0] : name === "\x01" ? [1] : [...new TextEncoder().encode(name + ";1")];
  const len = 33 + nameBytes.length + (1 - ((33 + nameBytes.length) % 2 === 0 ? 1 : 0));
  const rec = new Uint8Array(len);
  rec[0] = len;
  rec[1] = 0; // ext attr len
  new DataView(rec.buffer).setUint32(2, lba, true);
  new DataView(rec.buffer).setUint32(10, size, true);
  rec[25] = isDir ? 0x02 : 0x00;
  rec[32] = nameBytes.length;
  rec.set(nameBytes, 33);
  return rec;
}

/** Costruisce un'ISO9660 sintetica con PVD e pochi file reali. */
function buildTestIso(files: Array<{ path: string; content: Uint8Array }>): Uint8Array {
  // layout: [16 settori vuoti][PVD][root dir][file data...]
  const sectors: Uint8Array[] = [];
  for (let i = 0; i < 16; i++) sectors.push(new Uint8Array(SECTOR));

  // PVD a LBA 16
  const pvd = new Uint8Array(SECTOR);
  pvd[0] = 1; // type
  pvd.set(new TextEncoder().encode("CD001"), 1);
  pvd[2 + 5] = 1; // version
  pvd.set(new TextEncoder().encode("PLAYSTATION"), 8); // system id (come i dischi PSP)
  pvd.set(new TextEncoder().encode("TESTVOL"), 40); // volume id

  // alloca i file a settori consecutivi dopo la root dir
  const rootLba = 17;
  let nextLba = 18;
  const fileEntries = files.map((f) => {
    const sectorCount = Math.ceil(f.content.length / SECTOR);
    const lba = nextLba;
    nextLba += sectorCount;
    return { ...f, lba, sectorCount };
  });

  // directory radice: record self + parent + un record per file
  const rootRecords = Buffer.concat([
    dirRecord("\x00", rootLba, SECTOR, true),
    dirRecord("\x01", rootLba, SECTOR, true),
    ...fileEntries.map((f) => dirRecord(f.path, f.lba, f.content.length, false)),
  ]);
  pvd.set(dirRecord("\x00", rootLba, SECTOR, true), 156); // root record nel PVD

  const totalSectors = nextLba;
  const iso = new Uint8Array(totalSectors * SECTOR);
  const put = (lba: number, data: Uint8Array) => iso.set(data, lba * SECTOR);
  put(16, pvd);
  const rootSector = new Uint8Array(SECTOR);
  rootSector.set(rootRecords, 0);
  put(rootLba, rootSector);
  for (const f of fileEntries) put(f.lba, f.content);
  return iso;
}

/** Comprime un ISO in CSO secondo la specifica (frame 2048, zlib raw). */
function buildCsoFromIso(iso: Uint8Array, plainBlock?: number): Uint8Array {
  const numFrames = Math.ceil(iso.length / SECTOR);
  const headerSize = 24;
  const indexOffset = headerSize;
  const bodyOffset = indexOffset + (numFrames + 1) * 4;

  // comprime i frame
  const frames: Array<{ data: Uint8Array; plain: boolean }> = [];
  let cursor = bodyOffset;
  const indexEntries: number[] = [];
  const frameDataBlocks: Uint8Array[] = [];
  for (let i = 0; i < numFrames; i++) {
    const raw = iso.slice(i * SECTOR, (i + 1) * SECTOR);
    const plain = i === plainBlock;
    const payload = plain ? raw : new Uint8Array(deflateRawSync(Buffer.from(raw)));
    // se la compressione non comprime, memorizza plain (comportamento dei tool reali)
    const usePlain = plain || payload.length >= SECTOR;
    indexEntries.push((cursor | (usePlain ? 0x80000000 : 0)) >>> 0);
    frameDataBlocks.push(usePlain ? raw : payload);
    cursor += (usePlain ? raw : payload).length;
  }
  indexEntries.push(cursor >>> 0); // terminatore

  const total = cursor;
  const cso = new Uint8Array(total);
  const dv = new DataView(cso.buffer);
  cso.set(new TextEncoder().encode("CISO"), 0);
  dv.setUint32(4, headerSize, true);
  dv.setUint32(8, iso.length, true); // total_bytes (LE u64, parte bassa)
  dv.setUint32(12, 0, true); // parte alta
  dv.setUint32(16, SECTOR, true); // block_size
  cso[20] = 1; // ver
  cso[21] = 0; // align bits
  indexEntries.forEach((e, i) => dv.setUint32(indexOffset + i * 4, e, true));
  let off = bodyOffset;
  frameDataBlocks.forEach((b) => { cso.set(b, off); off += b.length; });
  return cso;
}

const FILES = [
  { path: "PSP_GAME", content: new Uint8Array(0) }, // marker (non usato come file)
];
const iso = buildTestIso([
  { path: "DATA.BIN", content: new Uint8Array(5000).fill(0xab) },
  { path: "EBOOT.BIN", content: new Uint8Array(3000).fill(0xcd) },
]);

describe("ISO9660 (letture su ISO nuda)", () => {
  test("PVD riconosciuto: system id PLAYSTATION, volume, file elencati", () => {
    const listing = listIsoFiles(new IsoReader(iso));
    expect(listing.systemId).toBe("PLAYSTATION");
    expect(listing.volumeId).toBe("TESTVOL");
    const paths = listing.entries.map((e) => e.path);
    expect(paths).toContain("DATA.BIN");
    expect(paths).toContain("EBOOT.BIN");
  });

  test("estrazione: i byte sono identici all'originale", () => {
    const reader = new IsoReader(iso);
    const listing = listIsoFiles(reader);
    const out = extractIsoFile(reader, listing.entries, "data.bin"); // case-insensitive
    expect(out.length).toBe(5000);
    expect(out.every((b) => b === 0xab)).toBe(true);
  });

  test("percorso inesistente → errore esplicito", () => {
    const reader = new IsoReader(iso);
    expect(() => extractIsoFile(reader, listIsoFiles(reader).entries, "NOPE.BIN")).toThrow(/non trovato/);
  });

  test("identificazione console: system id PLAYSTATION → PSP (magic)", () => {
    const r = identifyConsole(iso);
    expect(r.console).toBe("Sony PlayStation Portable");
    expect(r.format).toContain("ISO");
  });
});

describe("CSO (spec trascritta da ppsspp BlockDevices)", () => {
  test("lettore CSO: i settori decompressi sono identici all'ISO originale", () => {
    const reader = new CsoReader(buildCsoFromIso(iso));
    expect(reader.numSectors()).toBe(new IsoReader(iso).numSectors());
    for (let s = 0; s < reader.numSectors(); s += 3) {
      expect(Buffer.from(reader.readSector(s)).equals(Buffer.from(iso.slice(s * SECTOR, (s + 1) * SECTOR)))).toBe(true);
    }
  });

  test("frame memorizzato plain (bit 31) letto correttamente", () => {
    const reader = new CsoReader(buildCsoFromIso(iso, 17)); // PVD plain
    const sector = reader.readSector(16);
    expect(String.fromCharCode(sector[1], sector[2], sector[3], sector[4], sector[5])).toBe("CD001");
  });

  test("filesystem via CSO == filesystem via ISO (list + extract identici)", () => {
    const viaIso = listIsoFiles(new IsoReader(iso));
    const viaCso = listIsoFiles(new CsoReader(buildCsoFromIso(iso)));
    expect(viaCso.entries.map((e) => e.path + ":" + e.size)).toEqual(viaIso.entries.map((e) => e.path + ":" + e.size));
    const a = extractIsoFile(new IsoReader(iso), viaIso.entries, "EBOOT.BIN");
    const b = extractIsoFile(new CsoReader(buildCsoFromIso(iso)), viaCso.entries, "EBOOT.BIN");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test("CSO rifiutato con indice non monotono (sanità del formato)", () => {
    const cso = buildCsoFromIso(iso);
    // corrompi l'indice: voce 0 con offset enorme
    new DataView(cso.buffer).setUint32(24, 0x7ffffff0, true);
    expect(() => new CsoReader(cso)).toThrow(/monotono|Header CSO incoerente/);
  });

  test("openSectorReader: dispatch trasparente ISO vs CSO", () => {
    expect(openSectorReader(iso)).toBeInstanceOf(IsoReader);
    expect(openSectorReader(buildCsoFromIso(iso))).toBeInstanceOf(CsoReader);
  });
});
