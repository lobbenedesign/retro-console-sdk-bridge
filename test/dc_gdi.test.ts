import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { parseGdi, listGdiFiles, extractGdiFile } from "../src/dc_gdi";
import { identifyConsole } from "../src/rom_identify";

// --- zip builder (come psp_iso.test.ts) ---
function crc32(bytes: Uint8Array): number {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let c = 0xffffffff;
  for (const b of bytes) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nb = new TextEncoder().encode(f.name);
    const payload = new Uint8Array(deflateRawSync(Buffer.from(f.data)));
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + nb.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, payload.length, true); lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nb.length, true); local.set(nb, 30);
    locals.push(local, payload);
    const central = new Uint8Array(46 + nb.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, payload.length, true); cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true); central.set(nb, 46);
    centrals.push(central);
    offset += local.length + payload.length;
  }
  const cdStart = offset, cdLen = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdLen, true); ev.setUint32(16, cdStart, true);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

// --- ISO9660 sintetica (traccia dati) con IP.BIN ---
const S = 2048;
function drec(name: string, lba: number, size: number, isdir: boolean): Uint8Array {
  const nb = name === "self" ? [0] : name === "parent" ? [1] : [...new TextEncoder().encode(name + ";1")];
  const ln = 33 + nb.length;
  const rec = new Uint8Array(ln);
  rec[0] = ln;
  new DataView(rec.buffer).setUint32(2, lba, true);
  new DataView(rec.buffer).setUint32(10, size, true);
  rec[25] = isdir ? 0x02 : 0x00; rec[32] = nb.length; rec.set(nb, 33);
  return rec;
}
const fileContent = Uint8Array.from(Array.from({ length: 3000 }, (_, i) => i & 0xff));
const flba = 18, fsectors = Math.ceil(fileContent.length / S);
const iso = new Uint8Array((flba + fsectors) * S);
const pvd = new Uint8Array(S);
pvd[0] = 1; pvd.set(new TextEncoder().encode("CD001"), 1); pvd[6] = 1;
pvd.set(new TextEncoder().encode("SEGA DREAMCAST"), 8); // system id dei dischi DC
pvd.set(new TextEncoder().encode("DCVOL"), 40);
const root = new Uint8Array(S);
let ro = 0;
for (const r of [drec("self", 17, S, true), drec("parent", 17, S, true), drec("1ST_READ.BIN", flba, fileContent.length, false)]) {
  root.set(r, ro); ro += r.length;
}
pvd.set(drec("self", 17, S, true), 156);
// IP.BIN: boot header SEGA SEGAKATANA nei primi 16 settori (semplificato: solo firma)
iso.set(new TextEncoder().encode("SEGA SEGAKATANA"), 0);
iso.set(pvd, 16 * S); iso.set(root, 17 * S); iso.set(fileContent, flba * S);

const GDI_5FIELD = "3\n1 0 0 track01.raw 2352\n2 11700 0 track02.raw 2352\n3 45000 4 track03.bin 2048\n";
const GDI_8FIELD = "3\n1 0 0 2352 1 0 0 0 track01.raw\n2 11700 0 2352 1 0 11700 0 track02.raw\n3 45000 0 2048 1 0 45000 0 track03.bin\n";

const zip = buildZip([
  { name: "game.gdi", data: new TextEncoder().encode(GDI_8FIELD) },
  { name: "track01.raw", data: new Uint8Array(1000) },
  { name: "track02.raw", data: new Uint8Array(1000) },
  { name: "track03.bin", data: iso },
]);

describe("parseGdi (entrambi i layout di riga documentati)", () => {
  test("layout a 5 campi", () => {
    const info = parseGdi(GDI_5FIELD);
    expect(info.trackCount).toBe(3);
    expect(info.tracks.length).toBe(3);
    expect(info.dataTrackFile).toBe("track03.bin");
    expect(info.tracks.filter((t) => t.isData).length).toBe(1);
  });

  test("layout a 8 campi", () => {
    const info = parseGdi(GDI_8FIELD);
    expect(info.dataTrackFile).toBe("track03.bin");
  });

  test("GDI senza tracce dati → errore onesto", () => {
    expect(() => parseGdi("2\n1 0 0 a.raw 2352\n2 100 0 b.raw 2352\n")).toThrow(/Nessuna traccia dati/);
  });
});

describe("listGdiFiles / extractGdiFile (ZIP reale)", () => {
  test("traccia dati ISO9660 elencata con IP.BIN riconosciuto", () => {
    const l = listGdiFiles(zip);
    expect(l.isLikelyDreamcast).toBe(true);
    expect(l.volumeId).toBe("DCVOL");
    expect(l.entries.map((e) => e.path)).toContain("1ST_READ.BIN");
    expect(l.dataTrackSize).toBe(iso.length);
  });

  test("estrazione byte-identica", () => {
    const out = extractGdiFile(zip, "1ST_READ.BIN");
    expect(Buffer.from(out).equals(Buffer.from(fileContent))).toBe(true);
  });

  test("ZIP senza .gdi → errore esplicito", () => {
    expect(() => listGdiFiles(buildZip([{ name: "x.bin", data: new Uint8Array(32) }]))).toThrow(/Nessun file \.gdi/);
  });
});

describe("identificazione Dreamcast (IP.BIN)", () => {
  test("firma SEGA SEGAKATANA → console DC con confidence magic", () => {
    const r = identifyConsole(iso);
    expect(r.console).toBe("Sega Dreamcast");
    expect(r.confidence).toBe("magic");
  });
});
