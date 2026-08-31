import { describe, expect, test } from "bun:test";
import { rebuildPspImage, rebuildDcGdi, rebuildZip } from "../src/image_rebuild";
import { buildIso9660 } from "../src/iso_build";
import { IsoReader, CsoReader } from "../src/psp_cso";
import { listIsoFiles, extractIsoFile } from "../src/psp_iso";
import { unzip } from "../src/zip_reader";

/**
 * 🛡️ image_rebuild.ts era l'unico modulo "vivo" (usato da un endpoint API
 * reale, /api/psp/iso/build e /api/dc/gdi/build) rimasto senza test in
 * tutto il progetto — trovato durante un audit sistematico end-to-end
 * (ogni modulo src/ incrociato con la sua copertura test), non solo
 * lettura del codice. Qui il round-trip reale: costruisci un'immagine con
 * iso_build.ts (già testato), sostituisci un file, rileggi col parser
 * reale (psp_iso.ts) e verifica contenuto byte-per-byte.
 */

describe("rebuildPspImage", () => {
  test("sostituisce il file indicato, lascia intatti gli altri", () => {
    const fileA = new TextEncoder().encode("contenuto originale A");
    const fileB = new TextEncoder().encode("contenuto originale B, più lungo dell'altro");
    const original = buildIso9660(
      [
        { path: "DATA/FILEA.BIN", data: fileA },
        { path: "DATA/FILEB.BIN", data: fileB },
      ],
      { systemId: "PLAYSTATION", volumeId: "TESTGAME" }
    );

    const newFileA = new TextEncoder().encode("contenuto MODIFICATO, di lunghezza diversa dall'originale!");
    const result = rebuildPspImage(original, [{ name: "FILEA.BIN", data: newFileA }], false);

    expect(result.unmatched).toEqual([]);
    expect(result.applied.length).toBe(1);
    expect(result.cso).toBeUndefined();

    const reader = new IsoReader(result.iso);
    const listing = listIsoFiles(reader);
    expect(listing.volumeId).toBe("TESTGAME");

    const a = listing.entries.find((e) => e.path.toUpperCase() === "DATA/FILEA.BIN")!;
    const b = listing.entries.find((e) => e.path.toUpperCase() === "DATA/FILEB.BIN")!;
    expect(new Uint8Array(extractIsoFile(reader, listing.entries, a.path))).toEqual(newFileA);
    expect(new Uint8Array(extractIsoFile(reader, listing.entries, b.path))).toEqual(fileB);
  });

  test("segnala i file di sostituzione senza corrispondenza", () => {
    const original = buildIso9660([{ path: "REAL.BIN", data: new Uint8Array(10) }]);
    const result = rebuildPspImage(original, [{ name: "NONESISTE.BIN", data: new Uint8Array(5) }], false);
    expect(result.unmatched).toEqual(["NONESISTE.BIN"]);
    expect(result.applied).toEqual([]);
  });

  test("alsoCso=true produce un CSO che decomprime esattamente all'ISO rebuilt", () => {
    const original = buildIso9660([{ path: "GAME.BIN", data: new Uint8Array(4096).fill(0x7a) }]);
    const result = rebuildPspImage(original, [{ name: "GAME.BIN", data: new Uint8Array(4096).fill(0x11) }], true);
    expect(result.cso).toBeDefined();

    const cso = new CsoReader(result.cso!);
    const rebuiltFromCso = new Uint8Array(result.iso.length);
    for (let s = 0; s < result.iso.length / 2048; s++) rebuiltFromCso.set(cso.readSector(s), s * 2048);
    expect(rebuiltFromCso).toEqual(result.iso);
  });
});

describe("rebuildDcGdi", () => {
  const S = 2048;
  function bootTrack(fileContent: Uint8Array): Uint8Array {
    const flba = 18;
    const fsectors = Math.ceil(fileContent.length / S);
    const iso = new Uint8Array((flba + fsectors) * S);
    // riusa direttamente iso_build.ts per il PVD/root/file, poi impronta l'IP.BIN
    const built = buildIso9660([{ path: "1ST_READ.BIN", data: fileContent }], {
      systemId: "SEGA DREAMCAST",
      volumeId: "DCVOL",
    });
    iso.set(built.slice(0, Math.min(built.length, iso.length)));
    iso.set(new TextEncoder().encode("SEGA SEGAKATANA"), 0); // firma IP.BIN nei settori di boot
    return built.length >= iso.length ? built : iso;
  }

  test("sostituisce un file nella traccia dati preservando l'IP.BIN di boot", () => {
    const original = new TextEncoder().encode("contenuto originale del readme");
    const dataTrack = bootTrack(original);

    const GDI = "3\n1 0 0 2352 1 0 0 0 track01.raw\n2 11700 0 2352 1 0 11700 0 track02.raw\n3 45000 0 2048 1 0 45000 0 track03.bin\n";
    const zip = rebuildZip([
      { name: "game.gdi", data: new TextEncoder().encode(GDI) },
      { name: "track01.raw", data: new Uint8Array(100) },
      { name: "track02.raw", data: new Uint8Array(100) },
      { name: "track03.bin", data: dataTrack },
    ]);

    const replaced = new TextEncoder().encode("readme modificato, più lungo del testo originale di prima");
    const result = rebuildDcGdi(zip, [{ name: "1ST_READ.BIN", data: replaced }]);

    expect(result.applied.length).toBe(1);
    expect(result.unmatched).toEqual([]);

    const newEntries = unzip(result.zip);
    const track01 = newEntries.find((e) => e.name === "track01.raw")!;
    const track03 = newEntries.find((e) => e.name === "track03.bin")!;
    expect(new Uint8Array(track01.data)).toEqual(new Uint8Array(100)); // traccia audio invariata

    // IP.BIN (primi 16 settori) preservato byte-per-byte
    expect(new Uint8Array(track03.data.slice(0, 16 * S))).toEqual(new Uint8Array(dataTrack.slice(0, 16 * S)));

    // il file sostituito è leggibile col contenuto nuovo dal parser reale
    const reader = new IsoReader(track03.data);
    const listing = listIsoFiles(reader);
    const entry = listing.entries.find((e) => e.path.toUpperCase() === "1ST_READ.BIN")!;
    expect(new Uint8Array(extractIsoFile(reader, listing.entries, entry.path))).toEqual(replaced);
  });

  test("rifiuta uno ZIP senza file .gdi", () => {
    const zip = rebuildZip([{ name: "not_a_gdi.txt", data: new Uint8Array(4) }]);
    expect(() => rebuildDcGdi(zip, [])).toThrow(/\.gdi/);
  });
});
