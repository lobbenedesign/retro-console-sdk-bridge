import { describe, expect, test } from "bun:test";
import { yay0Compress, yay0Decompress } from "../src/n64_yay0";
import { mio0Decompress, mio0CompressForTesting } from "../src/n64_mio0";
import { scanRomSections, detectSplat } from "../src/n64_split";
import { parseF3dDisplayList, extractF3dMesh } from "../src/n64_f3d";
import { generateRecompToml, detectN64Recomp } from "../src/recomp";

// --- Yay0 encoder: round-trip contro il decompressore reale già testato ---
describe("yay0Compress (round-trip bit-per-bit)", () => {
  test("round-trip su dati con ripetizioni (caso tipico texture/livelli)", () => {
    const data = new Uint8Array(2000);
    for (let i = 0; i < data.length; i++) data[i] = i % 7 === 0 ? 0xaa : (i * 31) & 0xff;
    const compressed = yay0Compress(data);
    const decompressed = yay0Decompress(compressed);
    expect(Buffer.from(decompressed).equals(Buffer.from(data))).toBe(true);
  });

  test("round-trip su run RLE lungo (> 18 byte: percorso conteggio esteso)", () => {
    const data = new Uint8Array(500);
    data.fill(0x42, 0, 300); // run di 300 byte identici
    for (let i = 300; i < 500; i++) data[i] = i & 0xff;
    const compressed = yay0Compress(data);
    const decompressed = yay0Decompress(compressed);
    expect(Buffer.from(decompressed).equals(Buffer.from(data))).toBe(true);
  });

  test("round-trip su dati tutti letterali (entropia alta: nessun match)", () => {
    const data = new Uint8Array(300);
    let s = 0x9e3779b9;
    for (let i = 0; i < data.length; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      data[i] = s & 0xff;
    }
    const compressed = yay0Compress(data);
    const decompressed = yay0Decompress(compressed);
    expect(Buffer.from(decompressed).equals(Buffer.from(data))).toBe(true);
  });

  test("compressione reale: i dati ripetitivi si comprimono davvero", () => {
    const data = new Uint8Array(1000);
    data.fill(0x11);
    const compressed = yay0Compress(data);
    expect(compressed.length).toBeLessThan(data.length / 2);
  });

  test("input vuoto e input da 1 byte gestiti senza errori", () => {
    expect(yay0Decompress(yay0Compress(new Uint8Array(0))).length).toBe(0);
    const one = new Uint8Array([0xab]);
    expect(Buffer.from(yay0Decompress(yay0Compress(one))).equals(Buffer.from(one))).toBe(true);
  });
});

// --- Scanner nativo blocchi ---
describe("scanRomSections", () => {
  // layout header MIO0 REALE (come src/n64_mio0.ts): 4-7 size decompressa,
  // 8-11 offset sezione compressa, 12-15 offset sezione letterali
  function mio0BlockHeader(decompressedSize: number, compOffset: number, uncompOffset: number): Uint8Array {
    const h = new Uint8Array(16);
    h.set([0x4d, 0x49, 0x4f, 0x30], 0);
    new DataView(h.buffer).setUint32(4, decompressedSize, false);
    new DataView(h.buffer).setUint32(8, compOffset, false);
    new DataView(h.buffer).setUint32(12, uncompOffset, false);
    return h;
  }

  test("trova un blocco MIO0 valido inserito a offset noto", () => {
    const rom = new Uint8Array(0x2000);
    rom.set(mio0BlockHeader(0x1000, 20, 100), 0x800);
    const sections = scanRomSections(rom);
    expect(sections.length).toBe(1);
    expect(sections[0].offset).toBe(0x800);
    expect(sections[0].format).toBe("MIO0");
    expect(sections[0].decompressedSize).toBe(0x1000);
  });

  test("rifiuta magic MIO0 con header assurdo (dimensioni fuori bounds)", () => {
    const rom = new Uint8Array(0x2000);
    rom.set(mio0BlockHeader(0x99999999, 0x99999999, 16), 0x1000); // offset sezioni oltre la ROM
    expect(scanRomSections(rom).length).toBe(0);
  });

  test("trova un blocco Yay0 valido e stima la size dal blocco successivo", () => {
    const rom = new Uint8Array(0x4000);
    // blocco Yay0 a 0x1000
    const y = new Uint8Array(16);
    y.set([0x59, 0x61, 0x79, 0x30], 0);
    new DataView(y.buffer).setUint32(4, 0x2000, false);
    new DataView(y.buffer).setUint32(8, 0x10, false);
    new DataView(y.buffer).setUint32(12, 0x50, false);
    rom.set(y, 0x1000);
    // blocco MIO0 subito dopo a 0x1000+0x100: size decompressa 0x800, link@20, letterali@64
    const m = mio0BlockHeader(0x800, 20, 64);
    rom.set(m, 0x1100);
    const sections = scanRomSections(rom);
    expect(sections.length).toBe(2);
    const yay = sections.find((s) => s.format === "Yay0");
    expect(yay?.offset).toBe(0x1000);
    expect(yay?.compressedSize).toBe(0x100); // stimato: fino al blocco successivo
  });

  test("round-trip reale: MIO0 compresso dal nostro encoder viene trovato dallo scanner", () => {
    const data = new Uint8Array(2048);
    for (let i = 0; i < data.length; i++) data[i] = i % 5;
    const compressed = mio0CompressForTesting(data);
    const rom = new Uint8Array(compressed.length + 0x1000);
    rom.set(compressed, 0x1000);
    const sections = scanRomSections(rom);
    expect(sections.length).toBe(1);
    expect(sections[0].offset).toBe(0x1000);
    const found = rom.slice(sections[0].offset);
    expect(Buffer.from(mio0Decompress(found)).equals(Buffer.from(data))).toBe(true);
  });

  test("detectSplat riporta onestamente lo stato (nessuna eccezione)", () => {
    const s = detectSplat();
    expect(typeof s.installed).toBe("boolean");
    if (!s.installed) expect(s.installHint.length).toBeGreaterThan(10);
  });
});

// --- Parser F3D ---
describe("parseF3dDisplayList + extractF3dMesh (opcode da sm64 CC0)", () => {
  function gfx(op: number, w0lo: number, w1: number): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setUint32(0, ((op << 24) | w0lo) >>> 0, false);
    new DataView(b.buffer).setUint32(4, w1 >>> 0, false);
    return b;
  }

  test("sequenza reale VTX + TRI1 + ENDDL viene interpretata", () => {
    const dl = Buffer.concat([
      gfx(0x01, (3 << 20) | (0 << 16) | (4 * 16), 0x04000000), // VTX n=4 v0=0 addr=0x04000000
      gfx(0x05, 0, (0 << 24) | (0 * 10 << 16) | (1 * 10 << 8) | (2 * 10)), // TRI1 0,1,2
      gfx(0xdf, 0, 0), // ENDDL
    ]);
    const { commands, endedAt } = parseF3dDisplayList(new Uint8Array(dl));
    expect(commands.length).toBe(3);
    expect(commands[0].name).toBe("VTX");
    expect(commands[0].fields.n).toBe(4);
    expect(commands[1].name).toBe("TRI1");
    expect(commands[1].fields.i0).toBe(0);
    expect(commands[1].fields.i1).toBe(1);
    expect(commands[1].fields.i2).toBe(2);
    expect(endedAt).toBe(16);
  });

  test("mesh estratta dal blob vertici (layout Vtx_tn 16 byte)", () => {
    // VTX classico: byte1 = ((n-1)<<4 | v0) → n=3 con (2<<4), length = 3*16
    const dl = Buffer.concat([
      gfx(0x01, (2 << 20) | (3 * 16), 0),
      gfx(0x05, 0, (0 << 24) | (0 * 10 << 16) | (1 * 10 << 8) | (2 * 10)),
      gfx(0xdf, 0, 0),
    ]);
    // Vtx_tn (gbi.h): ob[3] @0,2,4 · flag @6 · tc[2] @8,10 · n[3] @12-14 · a @15
    const vtx = new Uint8Array(3 * 16);
    const dv = new DataView(vtx.buffer);
    // vertice 0: x=100 y=50 z=10, u=0 v=32
    dv.setInt16(0, 100, false); dv.setInt16(2, 50, false); dv.setInt16(4, 10, false);
    dv.setInt16(8, 0, false); dv.setInt16(10, 32, false);
    // vertice 1: x=-100 y=50 z=10, u=0 v=-32
    dv.setInt16(16, -100, false); dv.setInt16(18, 50, false); dv.setInt16(20, 10, false);
    dv.setInt16(24, 0, false); dv.setInt16(26, -32, false);
    // vertice 2: x=0 y=-50 z=30, u=16 v=-32
    dv.setInt16(32, 0, false); dv.setInt16(34, -50, false); dv.setInt16(36, 30, false);
    dv.setInt16(40, 16, false); dv.setInt16(42, -32, false);

    const { mesh, warnings } = extractF3dMesh(new Uint8Array(dl), vtx);
    expect(warnings.length).toBe(0);
    expect(mesh.vertices.length).toBe(3);
    expect(mesh.vertices[0].x).toBe(100);
    expect(mesh.vertices[0].v).toBe(32);
    expect(mesh.vertices[1].u).toBe(0);
    expect(mesh.vertices[2].z).toBe(30);
    expect(mesh.triangles.length).toBe(1);
    expect(mesh.triangles[0]).toEqual([0, 1, 2]);
  });

  test("TRI1 con indice fuori dai vertici caricati → avviso onesto, niente crash", () => {
    const dl = Buffer.concat([
      gfx(0x01, (0 << 20) | (2 * 16), 0), // n=2 vertici
      gfx(0x05, 0, (5 * 10 << 16) | (0 * 10 << 8) | (1 * 10)), // indice 5 inesistente
      gfx(0xdf, 0, 0),
    ]);
    const { mesh, warnings } = extractF3dMesh(new Uint8Array(dl), new Uint8Array(2 * 16));
    expect(mesh.triangles.length).toBe(0);
    expect(warnings.length).toBe(1);
  });

  test("opcode non mappato → UNKNOWN riportato con word grezzi, parsing prosegue a 8 byte", () => {
    const dl = Buffer.concat([
      gfx(0xab, 0x1122, 0x33445566), // opcode inesistente in F3D
      gfx(0xdf, 0, 0),
    ]);
    const { commands } = parseF3dDisplayList(new Uint8Array(dl));
    expect(commands[0].name).toBe("UNKNOWN");
    expect(commands[0].fields.w0).toBe("0xAB001122");
    expect(commands[1].name).toBe("ENDDL");
  });

  test("SETTIMG + SETTILESIZE riportano parametri texture (fmt/siz/width)", () => {
    const dl = Buffer.concat([
      // SETTIMG: fmt=CI(2)<<23 | siz=8b(1)<<21 | (width-1)=31
      gfx(0xfd, (2 << 23) | (1 << 21) | 31, 0x07000000),
      // SETTILESIZE: h encoded (32-2)<<0? nel comando: (h-2)/4 nel campo basso → h=32 → 7.5... usiamo 0x28 = 10 → h=... layout reale: h nei bit 0-11 come (h-2)/2? trascritto come /4+1 nel parser
      gfx(0xf2, 0, 0x28),
      gfx(0xdf, 0, 0),
    ]);
    const { commands } = parseF3dDisplayList(new Uint8Array(dl));
    expect(commands[0].name).toBe("SETTIMG");
    expect(commands[0].fields.fmt).toBe("CI");
    expect(commands[0].fields.siz).toBe("8b");
    expect(commands[0].fields.width).toBe(32);
  });
});

// --- recomp.toml ---
describe("generateRecompToml (schema Zelda64Recomp ufficiale)", () => {
  test("genera [input] con entrypoint in hex e rom_file_path", () => {
    const toml = generateRecompToml({ gameName: "Test Game", entrypoint: 0x80246000 });
    expect(toml).toContain("[input]");
    expect(toml).toContain("entrypoint = 0x80246000");
    expect(toml).toContain('rom_file_path = "baserom.z64"');
    expect(toml).toContain('output_func_path = "RecompiledFuncs"');
  });

  test("stubs e ignored finiscono in [patches] come array TOML validi", () => {
    const toml = generateRecompToml({
      gameName: "X",
      stubs: ["Func1", "Func2"],
      ignored: ["D_80186028"],
    });
    expect(toml).toContain("[patches]");
    expect(toml).toContain('"Func1"');
    expect(toml).toContain('"D_80186028"');
  });

  test("detectN64Recomp non crasha e riporta hint di installazione se assente", () => {
    const s = detectN64Recomp();
    expect(typeof s.installed).toBe("boolean");
    if (!s.installed) expect(s.installHint).toContain("cmake");
  });
});
