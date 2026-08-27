import { describe, expect, test } from "bun:test";
import { disassembleWord, disassembleMips } from "../src/mips_disasm";
import { parseSnesRomHeader } from "../src/snes_rom_header";
import { parseF3dDisplayList, extractF3dMesh, serializeF3dVertices, buildF3dDisplayList } from "../src/n64_f3d";

// --- Disassembler MIPS ---
describe("disassembleWord (encoding MIPS I/III standard)", () => {
  test("vettori noti: nop, jr $ra, addiu, lui, jal", () => {
    expect(disassembleWord(0x00000000)).toBe("nop");
    expect(disassembleWord(0x03e00008)).toBe("jr $ra");
    expect(disassembleWord(0x27bdffe0)).toBe("addiu $sp, $sp, -32");
    expect(disassembleWord(0x3c018024)).toBe("lui $at, 0x8024");
    expect(disassembleWord(0x0c009180)).toBe("jal 0x24600"); // target = imm26 << 2
  });

  test("SPECIAL: addu, or, slt, mult con registri giusti", () => {
    // addu $v0, $a0, $a1: op=0 rs=a0(4) rt=a1(5) rd=v0(2)
    expect(disassembleWord((4 << 21) | (5 << 16) | (2 << 11) | 0x21)).toBe("addu $v0, $a0, $a1");
    // or $t0, $t1, $t2: rs=9 rt=10 rd=8 fn=0x25
    expect(disassembleWord((9 << 21) | (10 << 16) | (8 << 11) | 0x25)).toBe("or $t0, $t1, $t2");
    // slt $s0, $zero, $v1
    expect(disassembleWord((0 << 21) | (3 << 16) | (16 << 11) | 0x2a)).toBe("slt $s0, $zero, $v1");
  });

  test("load/store con offset segnalato in parentesi", () => {
    // lw $t0, 0x20($sp): op=0x23 rs=29 rt=8 imm=0x20
    expect(disassembleWord((0x23 << 26) | (29 << 21) | (8 << 16) | 0x20)).toBe("lw $t0, 32($sp)");
    // sw $ra, 4($sp)
    expect(disassembleWord((0x2b << 26) | (29 << 21) | (31 << 16) | 0x4)).toBe("sw $ra, 4($sp)");
  });

  test("branch beq/bne con offset con segno", () => {
    expect(disassembleWord((4 << 26) | (8 << 21) | (9 << 16) | 0xfff8)).toBe("beq $t0, $t1, -8");
    expect(disassembleWord((5 << 26) | (0 << 21) | (0 << 16) | 0x0010)).toBe("bne $zero, $zero, +16");
  });

  test("FPU/COP1 non mappata → UNKNOWN onesto con word grezza", () => {
    const w = (0x11 << 26) | 0x1234; // COP1
    expect(disassembleWord(w)).toContain("UNKNOWN");
    expect(disassembleWord(w)).toContain(w.toString(16).toUpperCase());
  });

  test("disassembleMips: indirizzi crescenti dal base e limite max", () => {
    const bytes = new Uint8Array(24); // 6 word
    const instrs = disassembleMips(bytes, 0x80000000, 3);
    expect(instrs.length).toBe(3);
    expect(instrs[0].address).toBe(0x80000000);
    expect(instrs[2].address).toBe(0x80000008);
    expect(instrs.every((i) => i.text === "nop")).toBe(true);
  });
});

// --- Header SNES ---
describe("parseSnesRomHeader", () => {
  function buildSnesRom(mapping: "lORom" | "hirom", title: string, checksum: number): Uint8Array {
    const rom = new Uint8Array(mapping === "lORom" ? 0x8000 : 0x20000);
    const off = mapping === "lORom" ? 0x7fc0 : 0xffc0;
    const h = rom;
    for (let i = 0; i < title.length && i < 21; i++) h[off + i] = title.charCodeAt(i);
    h[off + 0x15] = 0x20; // map mode
    h[off + 0x16] = 0x00; // solo ROM
    h[off + 0x17] = 0x09; // 512KB
    h[off + 0x18] = 0x02; // SRAM 4KB? (1<<2 KB)
    h[off + 0x19] = 0x01; // USA
    h[off + 0x1b] = 0x00; // versione
    const comp = (0xffff - checksum) & 0xffff;
    h[off + 0x1c] = comp & 0xff; h[off + 0x1d] = comp >> 8;
    h[off + 0x1e] = checksum & 0xff; h[off + 0x1f] = checksum >> 8;
    return rom;
  }

  test("LoROM valida viene riconosciuta con checksum coerente", () => {
    const rom = buildSnesRom("lORom", "SUPER MARIO WORLD", 0x1c81);
    const hdr = parseSnesRomHeader(rom);
    expect(hdr.mapping).toBe("LoROM");
    expect(hdr.title).toBe("SUPER MARIO WORLD");
    expect(hdr.checksumConsistent).toBe(true);
    expect(hdr.romSize).toBe(512 * 1024);
    expect(hdr.sramSize).toBe(4 * 1024);
    expect(hdr.destination).toContain("USA");
  });

  test("HiROM valida viene riconosciuta all'offset 0xFFC0", () => {
    const rom = buildSnesRom("hirom", "TEST HIROM GAME", 0xbeef);
    const hdr = parseSnesRomHeader(rom);
    expect(hdr.mapping).toBe("HiROM");
    expect(hdr.headerOffset).toBe(0xffc0);
    expect(hdr.checksumConsistent).toBe(true);
  });

  test("ROM troppo corta → errore esplicito", () => {
    expect(() => parseSnesRomHeader(new Uint8Array(0x100))).toThrow(/troppo corta/);
  });

  test("ROM senza header plausibile → mappatura dichiarata sconosciuta (onestà)", () => {
    const rom = new Uint8Array(0x8000).fill(0xff); // tutti 0xff: complement+checksum = 0xFFFE+0xFFFF ≠ 0xFFFF... verifica
    const hdr = parseSnesRomHeader(rom);
    // 0xffff+0xfffe ≠ 0xffff → nessun candidato coerente
    expect(hdr.checksumConsistent).toBe(false);
    expect(hdr.mapping).toBe("sconosciuta");
  });
});

// --- F3D: serializzazione (round-trip editor 3D) ---
describe("serializeF3dVertices + buildF3dDisplayList (round-trip)", () => {
  function gfx(op: number, w0lo: number, w1: number): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setUint32(0, ((op << 24) | w0lo) >>> 0, false);
    new DataView(b.buffer).setUint32(4, w1 >>> 0, false);
    return b;
  }

  const dl = Buffer.concat([
    gfx(0x01, (2 << 20) | (3 * 16), 0),
    gfx(0x05, 0, (0 * 10 << 16) | (1 * 10 << 8) | (2 * 10)),
    gfx(0xdf, 0, 0),
  ]);
  const vtx = new Uint8Array(3 * 16);
  const dv = new DataView(vtx.buffer);
  dv.setInt16(0, 100, false); dv.setInt16(2, 50, false); dv.setInt16(4, 10, false);
  dv.setInt16(8, 0, false); dv.setInt16(10, 32, false);
  dv.setInt16(16, -100, false); dv.setInt16(18, 50, false); dv.setInt16(20, 10, false);
  dv.setInt16(24, 0, false); dv.setInt16(26, -32, false);
  dv.setInt16(32, 0, false); dv.setInt16(34, -50, false); dv.setInt16(36, 30, false);
  dv.setInt16(40, 16, false); dv.setInt16(42, -32, false);

  test("parse → serialize → parse: byte identici (round-trip senza modifiche)", () => {
    const { mesh } = extractF3dMesh(new Uint8Array(dl), vtx);
    const reBlob = serializeF3dVertices(mesh.vertices);
    expect(Buffer.from(reBlob).equals(Buffer.from(vtx))).toBe(true);
  });

  test("modifica delle posizioni sopravvive al round-trip", () => {
    const { mesh } = extractF3dMesh(new Uint8Array(dl), vtx);
    mesh.vertices[0].x = 321;
    mesh.vertices[1].z = -999;
    const reBlob = serializeF3dVertices(mesh.vertices);
    const { mesh: mesh2 } = extractF3dMesh(new Uint8Array(dl), reBlob);
    expect(mesh2.vertices[0].x).toBe(321);
    expect(mesh2.vertices[1].z).toBe(-999);
  });

  test("buildF3dDisplayList produce una DL che si riparsa con gli stessi triangoli", () => {
    const { mesh } = extractF3dMesh(new Uint8Array(dl), vtx);
    const newDl = buildF3dDisplayList(mesh, 0x07000000);
    const { commands, endedAt } = parseF3dDisplayList(newDl);
    expect(commands.map((c) => c.name)).toEqual(["VTX", "TRI1", "ENDDL"]);
    expect(endedAt).toBe(16);
    const { mesh: mesh2 } = extractF3dMesh(newDl, serializeF3dVertices(mesh.vertices));
    expect(mesh2.triangles).toEqual(mesh.triangles);
    expect(mesh2.vertices.length).toBe(3);
  });

  test("mesh > 16 vertici → errore esplicito (limite hardware VTX classico)", () => {
    const vertices = Array.from({ length: 17 }, (_, i) => ({ x: i, y: 0, z: 0, u: 0, v: 0, nx: 0, ny: 0, nz: 0, a: 255 }));
    expect(() => buildF3dDisplayList({ vertices, triangles: [], textureImages: [] })).toThrow(/max 16/);
  });

  test("valori fuori range int16 → errore onesto, nessun troncamento silenzioso", () => {
    expect(() => serializeF3dVertices([{ x: 40000, y: 0, z: 0, u: 0, v: 0, nx: 0, ny: 0, nz: 0, a: 255 }])).toThrow(/int16/);
  });
});
