import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { unzip, isZip } from "../src/zip_reader";
import { identifyConsole, identifyRomFile, v64ToZ64, n64leToZ64 } from "../src/rom_identify";

// --- Costruttore ZIP reale (locale header + central directory + EOCD) ---
function crc32(bytes: Uint8Array): number {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let c = 0xffffffff;
  for (const b of bytes) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(files: Array<{ name: string; data: Uint8Array; deflate?: boolean }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const payload = f.deflate ? new Uint8Array(deflateRawSync(Buffer.from(f.data))) : f.data;
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);         // version needed
    lv.setUint16(6, 0, true);          // flags
    lv.setUint16(8, f.deflate ? 8 : 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    locals.push(local, payload);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, f.deflate ? 8 : 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + payload.length;
  }
  const cdStart = offset;
  const cdLen = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdLen, true);
  ev.setUint32(16, cdStart, true);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

describe("unzip (lettura ZIP standard, nessuna dipendenza)", () => {
  test("round-trip stored (metodo 0)", () => {
    const zip = buildZip([{ name: "rom.z64", data: new Uint8Array([0x80, 0x37, 0x12, 0x40, 1, 2, 3, 4]) }]);
    const entries = unzip(zip);
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("rom.z64");
    expect(Array.from(entries[0].data)).toEqual([0x80, 0x37, 0x12, 0x40, 1, 2, 3, 4]);
    expect(entries[0].compressed).toBe(false);
  });

  test("round-trip deflate (metodo 8) con CRC coerente", () => {
    const data = new Uint8Array(5000);
    for (let i = 0; i < data.length; i++) data[i] = i % 7;
    const zip = buildZip([{ name: "big.bin", data, deflate: true }]);
    const entries = unzip(zip);
    expect(entries[0].compressed).toBe(true);
    expect(Buffer.from(entries[0].data).equals(Buffer.from(data))).toBe(true);
  });

  test("più voci e una directory (saltata onestamente)", () => {
    const zip = buildZip([
      { name: "dir/" , data: new Uint8Array(0) },
      { name: "a.bin", data: new Uint8Array([1, 2, 3]) },
      { name: "b.bin", data: new Uint8Array([4, 5]) },
    ]);
    const entries = unzip(zip);
    expect(entries.map((e) => e.name)).toEqual(["a.bin", "b.bin"]);
  });

  test("file non-ZIP → errore esplicito", () => {
    expect(() => unzip(new Uint8Array([1, 2, 3, 4]))).toThrow(/non è uno ZIP/);
  });

  test("isZip riconosce la firma PK", () => {
    expect(isZip(buildZip([{ name: "x", data: new Uint8Array([1]) }]))).toBe(true);
    expect(isZip(new Uint8Array([0x80, 0x37, 0x12, 0x40]))).toBe(false);
  });
});

describe("identifyConsole (magic header reali)", () => {
  test("N64 z64", () => {
    const r = identifyConsole(new Uint8Array([0x80, 0x37, 0x12, 0x40, ...Array(60).fill(0)]));
    expect(r.console).toBe("Nintendo 64");
    expect(r.format).toContain("z64");
    expect(r.confidence).toBe("magic");
    expect(r.convertedZ64).toBeUndefined();
  });

  test("N64 v64 riconosciuta E convertita in z64 correttamente", () => {
    const z64 = new Uint8Array([0x80, 0x37, 0x12, 0x40, 0xaa, 0xbb, 0xcc, 0xdd, ...Array(56).fill(0)]);
    const v64 = new Uint8Array(z64.length);
    for (let i = 0; i + 1 < z64.length; i += 2) { v64[i] = z64[i + 1]; v64[i + 1] = z64[i]; }
    const r = identifyConsole(v64);
    expect(r.console).toBe("Nintendo 64");
    expect(r.format).toContain("v64");
    expect(Buffer.from(r.convertedZ64!).equals(Buffer.from(z64))).toBe(true);
  });

  test("N64 n64 (little-endian) riconosciuta E convertita", () => {
    const z64 = new Uint8Array([0x80, 0x37, 0x12, 0x40, 1, 2, 3, 4, ...Array(56).fill(0)]);
    const le = new Uint8Array(z64.length);
    for (let i = 0; i + 3 < z64.length; i += 4) { le[i] = z64[i + 3]; le[i + 1] = z64[i + 2]; le[i + 2] = z64[i + 1]; le[i + 3] = z64[i]; }
    const r = identifyConsole(le);
    expect(r.format).toContain("n64");
    expect(Buffer.from(r.convertedZ64!).equals(Buffer.from(z64))).toBe(true);
  });

  test("round-trip dei convertitori puri v64/n64 → z64", () => {
    const z = [0x80, 0x37, 0x12, 0x40, 0xde, 0xad, 0xbe, 0xef];
    const v = [0x37, 0x80, 0x40, 0x12, 0xad, 0xde, 0xef, 0xbe];
    expect(Array.from(v64ToZ64(new Uint8Array(v)))).toEqual(z);
    const l = [0x40, 0x12, 0x37, 0x80, 0xef, 0xbe, 0xad, 0xde];
    expect(Array.from(n64leToZ64(new Uint8Array(l)))).toEqual(z);
  });

  test("NES, GB, GBA, NDS, Mega Drive, GameCube, Wii dai magic", () => {
    expect(identifyConsole(new Uint8Array([0x4e, 0x45, 0x53, 0x1a, ...Array(12).fill(0)])).console).toContain("Entertainment System");
    const gbLogo = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x37, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0d, 0x00];
    const gb = new Uint8Array(0x120); gb.set(gbLogo, 0x104);
    expect(identifyConsole(gb).console).toContain("Game Boy");
    const gba = new Uint8Array(0x100);
    gba.set([0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a, 0x84, 0xe4, 0x09, 0xad], 0x04);
    expect(identifyConsole(gba).console).toBe("Game Boy Advance");
    const nds = new Uint8Array(0x200);
    nds.set([0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a, 0x84, 0xe4, 0x09, 0xad], 0xc0);
    expect(identifyConsole(nds).console).toBe("Nintendo DS");
    const md = new Uint8Array(0x200); md.set([0x53, 0x45, 0x47, 0x41], 0x100);
    expect(identifyConsole(md).console).toContain("Mega Drive");
    const gc = new Uint8Array(0x100); gc.set([0xc2, 0x33, 0x9f, 0x3d], 0x1c);
    expect(identifyConsole(gc).console).toContain("GameCube");
    const wii = new Uint8Array(0x100); wii.set([0x5d, 0x1c, 0x9e, 0xa3], 0x18);
    expect(identifyConsole(wii).console).toContain("Wii");
  });

  test("SNES LoROM con checksum coerente identificata (confidenza dichiarata euristica)", () => {
    const rom = new Uint8Array(0x8000);
    rom.set(new TextEncoder().encode("TEST SNES ROM"), 0x7fc0);
    rom[0x7fd7] = 0x09;
    rom[0x7fde] = 0x81; rom[0x7fdf] = 0x1c; rom[0x7fdc] = 0x7e; rom[0x7fdd] = 0xe3; // 0x1C81 + complement
    const r = identifyConsole(rom);
    expect(r.console).toBe("Super Nintendo");
    expect(r.confidence).toBe("euristica");
  });

  test("byte random → sconosciuta onesta", () => {
    const r = identifyConsole(new Uint8Array(64).fill(0xab));
    expect(r.console).toBe("sconosciuta");
  });
});

describe("identifyRomFile (ZIP-aware)", () => {
  test("ZIP con dentro una v64: entry identificata e convertita", () => {
    const z64 = new Uint8Array([0x80, 0x37, 0x12, 0x40, ...Array(0x100).fill(0x55)]);
    const v64 = new Uint8Array(z64.length);
    for (let i = 0; i + 1 < z64.length; i += 2) { v64[i] = z64[i + 1]; v64[i + 1] = z64[i]; }
    const zip = buildZip([{ name: "game.v64", data: v64, deflate: true }]);
    const result = identifyRomFile(zip);
    expect(result.isArchive).toBe(true);
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].console).toBe("Nintendo 64");
    expect(result.entries[0].format).toContain("v64");
  });

  test("ROM nuda non-ZIP identificata direttamente", () => {
    const result = identifyRomFile(new Uint8Array([0x80, 0x37, 0x12, 0x40, ...Array(60).fill(0)]));
    expect(result.isArchive).toBe(false);
    expect(result.entries[0].console).toBe("Nintendo 64");
  });

  test("voci non-ROM dentro lo ZIP (readme.txt piccola) non bloccano l'identificazione", () => {
    const z64 = new Uint8Array([0x80, 0x37, 0x12, 0x40, ...Array(0x100).fill(0x33)]);
    const zip = buildZip([
      { name: "readme.txt", data: new TextEncoder().encode("non una rom") }, // 11 byte < 16
      { name: "game.z64", data: z64, deflate: true },
    ]);
    const result = identifyRomFile(zip);
    expect(result.entries.length).toBe(2);
    expect(result.entries[0].console).toBe("ignorata");
    expect(result.entries[1].console).toBe("Nintendo 64");
  });
});
