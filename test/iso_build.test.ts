import { describe, expect, test } from "bun:test";
import { buildIso9660 } from "../src/iso_build";
import { IsoReader } from "../src/psp_cso";
import { listIsoFiles, extractIsoFile } from "../src/psp_iso";

/**
 * 🛡️ Test di regressione per un bug reale trovato in questa sessione:
 * i campi della coda del PVD (Volume Sequence Number, Logical Block Size,
 * Path Table Size, Location dei path table Type-L/Type-M) erano scritti
 * a offset sbagliati (scalati progressivamente a partire da 128 invece
 * di 124), e la location del path table Type-M era scritta little-endian
 * invece di big-endian come richiesto da ECMA-119/ISO 9660. Il parser
 * interno del progetto (psp_iso.ts) non legge questi campi — solo il
 * root directory entry a 156 — quindi il round-trip con il nostro stesso
 * lettore non l'avrebbe mai rivelato: qui i field vengono letti a mano
 * e confrontati con gli offset noti dello standard, indipendentemente
 * dal nostro parser.
 */

const SECTOR = 2048;

describe("buildIso9660", () => {
  test("i campi della coda del PVD sono agli offset corretti (ECMA-119)", () => {
    const files = [
      { path: "README.TXT", data: new TextEncoder().encode("hello") },
      { path: "DATA/LEVEL1.BIN", data: new Uint8Array(3000).fill(0xab) },
    ];
    const img = buildIso9660(files, { systemId: "TEST", volumeId: "MYVOL" });
    const pvd = img.slice(16 * SECTOR, 17 * SECTOR);
    const dv = new DataView(pvd.buffer, pvd.byteOffset);

    expect(pvd[0]).toBe(1); // type code
    expect(String.fromCharCode(...pvd.slice(1, 6))).toBe("CD001");

    const totalSectors = img.length / SECTOR;
    expect(dv.getUint32(80, true)).toBe(totalSectors); // volume space size (LE)
    expect(dv.getUint32(84, false)).toBe(totalSectors); // volume space size (BE)
    expect(dv.getUint16(120, true)).toBe(1); // volume set size (LE)
    expect(dv.getUint16(124, true)).toBe(1); // volume sequence number (LE)
    expect(dv.getUint16(126, false)).toBe(1); // volume sequence number (BE)
    expect(dv.getUint16(128, true)).toBe(SECTOR); // logical block size (LE)
    expect(dv.getUint16(130, false)).toBe(SECTOR); // logical block size (BE)

    const ptSizeLe = dv.getUint32(132, true);
    const ptSizeBe = dv.getUint32(136, false);
    expect(ptSizeLe).toBeGreaterThan(0);
    expect(ptSizeLe).toBe(ptSizeBe); // path table size: stesso valore in entrambi gli ordini

    const ptLLba = dv.getUint32(140, true); // location Type-L (LE)
    const ptMLba = dv.getUint32(148, false); // location Type-M (BE)
    expect(ptLLba).toBeGreaterThan(0);
    expect(ptMLba).toBeGreaterThan(ptLLba); // il path table M segue L nel nostro layout

    // Il Type-L path table deve essere leggibile come little-endian: il
    // primo entry (radice) ha LBA del suo settore = root.lba, verificabile
    // solo indirettamente qui via il root directory entry (vedi sotto),
    // ma controlliamo almeno che il settore non sia tutto zero (path table
    // realmente scritto, non solo l'offset del campo location).
    const ptLSector = img.slice(ptLLba * SECTOR, ptLLba * SECTOR + SECTOR);
    expect(ptLSector.some((b) => b !== 0)).toBe(true);
    const ptMSector = img.slice(ptMLba * SECTOR, ptMLba * SECTOR + SECTOR);
    expect(ptMSector.some((b) => b !== 0)).toBe(true);

    // Root directory entry a 156 non deve essere stato corrotto da una
    // scrittura successiva che si sovrappone (bug originale: la location
    // del path table M finiva a offset 160, dentro il range 156-189 del
    // root directory entry, e veniva silenziosamente sovrascritta/
    // sovrascriveva).
    expect(pvd[156]).toBeGreaterThanOrEqual(34); // lunghezza record valida
  });

  test("round-trip: i file scritti sono rileggibili byte-per-byte dal parser reale", () => {
    const files = [
      { path: "README.TXT", data: new TextEncoder().encode("ciao mondo") },
      { path: "DATA/LEVEL1.BIN", data: new Uint8Array(5000).fill(0x42) },
      { path: "DATA/SUB/DEEP.BIN", data: new TextEncoder().encode("nested file content") },
    ];
    const img = buildIso9660(files, { systemId: "TEST", volumeId: "MYVOL" });

    const reader = new IsoReader(img);
    const listing = listIsoFiles(reader);
    expect(listing.systemId).toBe("TEST");
    expect(listing.volumeId).toBe("MYVOL");

    for (const f of files) {
      const entry = listing.entries.find((e) => e.path.toUpperCase() === f.path.toUpperCase() && !e.isDir);
      expect(entry).toBeDefined();
      const data = extractIsoFile(reader, listing.entries, entry!.path);
      expect(new Uint8Array(data)).toEqual(f.data);
    }
  });

  test("preserveSectors0to15 copia i settori di boot senza alterarli", () => {
    const bootSectors = new Uint8Array(16 * SECTOR);
    for (let i = 0; i < bootSectors.length; i++) bootSectors[i] = i % 256;

    const files = [{ path: "IP.TXT", data: new TextEncoder().encode("x") }];
    const img = buildIso9660(files, { preserveSectors0to15: bootSectors });
    expect(img.slice(0, 16 * SECTOR)).toEqual(bootSectors);
  });

  test("rifiuta un'immagine boot più corta di 16 settori", () => {
    const files = [{ path: "IP.TXT", data: new TextEncoder().encode("x") }];
    expect(() => buildIso9660(files, { preserveSectors0to15: new Uint8Array(1000) })).toThrow();
  });

  test("rifiuta una lista di file vuota", () => {
    expect(() => buildIso9660([])).toThrow();
  });
});
