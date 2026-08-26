import { describe, test, expect } from "bun:test";
import { parseN64RomHeader } from "../src/n64_rom_header";

/**
 * Costruisce un header ROM N64 sintetico ma format-corretto (64 byte,
 * offset 0x00-0x3F), secondo la specifica pubblica documentata in
 * src/n64_rom_header.ts.
 */
function buildSyntheticHeader(overrides: Partial<{
  clockRate: number;
  bootAddress: number;
  release: number;
  crc1: number;
  crc2: number;
  title: string;
  cartridgeFormat: string;
  cartridgeId: string;
  country: number;
  version: number;
}> = {}): Uint8Array {
  const rom = new Uint8Array(0x40);
  const v = new DataView(rom.buffer);

  // Magic reale a 0x00-0x03 (coincide anche coi 4 registri PI_BSD_DOM1).
  rom[0x00] = 0x80; rom[0x01] = 0x37; rom[0x02] = 0x12; rom[0x03] = 0x40;

  v.setUint32(0x04, overrides.clockRate ?? 0x0000000f, false);
  v.setUint32(0x08, overrides.bootAddress ?? 0x80246000, false);
  v.setUint32(0x0c, overrides.release ?? 0x00001444, false);
  v.setUint32(0x10, overrides.crc1 ?? 0xdeadbeef, false);
  v.setUint32(0x14, overrides.crc2 ?? 0xcafef00d, false);

  const title = (overrides.title ?? "SYNTHETIC TEST ROM").padEnd(0x14, " ").slice(0, 0x14);
  for (let i = 0; i < title.length; i++) rom[0x20 + i] = title.charCodeAt(i);

  rom[0x3b] = (overrides.cartridgeFormat ?? "N").charCodeAt(0);
  const cartId = overrides.cartridgeId ?? "ZL";
  rom[0x3c] = cartId.charCodeAt(0);
  rom[0x3d] = cartId.charCodeAt(1);
  rom[0x3e] = overrides.country ?? 0x45; // 'E' = USA (NTSC)
  rom[0x3f] = overrides.version ?? 0x01;

  return rom;
}

describe("parseN64RomHeader", () => {
  test("riconosce il magic reale come ROM N64 valida", () => {
    const rom = buildSyntheticHeader();
    const header = parseN64RomHeader(rom);
    expect(header.looksLikeValidN64Rom).toBe(true);
  });

  test("parsa correttamente i 4 registri PI_BSD_DOM1 (= magic)", () => {
    const rom = buildSyntheticHeader();
    const header = parseN64RomHeader(rom);
    expect(header.piBsdDom1LatReg).toBe(0x80);
    expect(header.piBsdDom1PgsReg).toBe(0x37);
    expect(header.piBsdDom1PwdReg).toBe(0x12);
    expect(header.piBsdDom1RlsReg).toBe(0x40);
  });

  test("parsa clockRate, bootAddress, release, crc1, crc2", () => {
    const rom = buildSyntheticHeader({
      clockRate: 0x0000000f,
      bootAddress: 0x80246000,
      release: 0x00001444,
      crc1: 0x12345678,
      crc2: 0x9abcdef0
    });
    const header = parseN64RomHeader(rom);
    expect(header.clockRate).toBe(0x0000000f);
    expect(header.bootAddress).toBe("0x80246000");
    expect(header.release).toBe("0x00001444");
    expect(header.crc1).toBe("0x12345678");
    expect(header.crc2).toBe("0x9abcdef0");
  });

  test("parsa il titolo (imageName) a 0x20-0x33, trimmato", () => {
    const rom = buildSyntheticHeader({ title: "SUPER TEST 64" });
    const header = parseN64RomHeader(rom);
    expect(header.imageName).toBe("SUPER TEST 64");
  });

  test("parsa cartridgeFormat a 0x3B (non 0x38 — bug storico corretto)", () => {
    const rom = buildSyntheticHeader({ cartridgeFormat: "N" });
    const header = parseN64RomHeader(rom);
    expect(header.cartridgeFormat).toBe("N");

    const romD = buildSyntheticHeader({ cartridgeFormat: "D" });
    expect(parseN64RomHeader(romD).cartridgeFormat).toBe("D");
  });

  test("parsa cartridgeId a 0x3C-0x3D", () => {
    const rom = buildSyntheticHeader({ cartridgeId: "SM" });
    const header = parseN64RomHeader(rom);
    expect(header.cartridgeId).toBe("SM");
  });

  test("parsa country a 0x3E e risolve il nome regione reale", () => {
    const rom = buildSyntheticHeader({ country: 0x4a }); // Japan
    const header = parseN64RomHeader(rom);
    expect(header.countryCode).toBe(0x4a);
    expect(header.countryName).toBe("Japanese (NTSC)");
  });

  test("country sconosciuto produce un fallback onesto, non un crash", () => {
    const rom = buildSyntheticHeader({ country: 0x99 });
    const header = parseN64RomHeader(rom);
    expect(header.countryName).toContain("Sconosciuto");
  });

  test("parsa version a 0x3F", () => {
    const rom = buildSyntheticHeader({ version: 0x05 });
    const header = parseN64RomHeader(rom);
    expect(header.version).toBe(0x05);
  });

  test("magic errato -> looksLikeValidN64Rom false, resto comunque parsato", () => {
    const rom = buildSyntheticHeader();
    rom[0x00] = 0x00; // rompe il magic
    const header = parseN64RomHeader(rom);
    expect(header.looksLikeValidN64Rom).toBe(false);
  });

  test("buffer troppo corto lancia un errore esplicito", () => {
    const shortRom = new Uint8Array(0x10);
    expect(() => parseN64RomHeader(shortRom)).toThrow();
  });
});
