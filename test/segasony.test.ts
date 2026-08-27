import { describe, expect, test } from "bun:test";
import { parseGenesisRomHeader, fixGenesisChecksum, genesisChecksum, genesisChecksumSgdk } from "../src/genesis_rom_header";
import { detectExtraToolchains, scaffoldExtra } from "../src/segasony_scaffold";
import { identifyConsole } from "../src/rom_identify";

/** ROM Genesis sintetica con header reale a 0x100. */
function buildGenesisRom(opts: { title?: string; region?: string; badChecksum?: boolean } = {}): Uint8Array {
  const rom = new Uint8Array(0x40000);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) rom[off + i] = s.charCodeAt(i); };
  w(0x100, "SEGA MEGA DRIVE ");
  w(0x110, "(C)RETRO 2026    ");
  w(0x150, (opts.title || "RETRO STUDIO TEST").padEnd(48, " "));
  w(0x180, "GM 00001051-00");
  rom[0x190] = 0x4a; // J = joypad 3 bottoni
  rom[0x191] = 0x36; // 6 = joypad 6 bottoni
  // ROM start/end dichiarati
  new DataView(rom.buffer).setUint32(0x1a0, 0, false);
  new DataView(rom.buffer).setUint32(0x1a4, rom.length - 1, false);
  // dati oltre 0x200 con un pattern reale (influenzano il checksum)
  for (let i = 0x200; i < rom.length; i += 2) {
    new DataView(rom.buffer).setUint16(i, (i * 13) & 0xffff, false);
  }
  w(0x1f0, opts.region || "JUE");

  if (!opts.badChecksum) {
    const ck = genesisChecksum(rom);
    rom[0x18e] = (ck >> 8) & 0xff;
    rom[0x18f] = ck & 0xff;
  }
  return rom;
}

describe("parseGenesisRomHeader (layout header Sega documentato)", () => {
  test("parsa titolo, seriale, regioni, dispositivi, ROM range", () => {
    const h = parseGenesisRomHeader(buildGenesisRom());
    expect(h.looksLikeGenesisRom).toBe(true);
    expect(h.consoleName).toContain("SEGA MEGA DRIVE");
    expect(h.overseasTitle).toBe("RETRO STUDIO TEST");
    expect(h.serial).toBe("GM 00001051-00");
    expect(h.regionCodes).toBe("JUE");
    expect(h.regions.some((r) => r.includes("Giappone"))).toBe(true);
    expect(h.devices.some((d) => d.includes("3 bottoni"))).toBe(true);
    expect(h.devices.some((d) => d.includes("6 bottoni"))).toBe(true);
    expect(h.romEnd).toBe(0x3ffff);
  });

  test("ROM troppo corta → errore esplicito", () => {
    expect(() => parseGenesisRomHeader(new Uint8Array(0x100))).toThrow(/troppo corta/);
  });
});

describe("checksum Genesis (doppio formato reale)", () => {
  test("algoritmo Sega (somma word da 0x200): valido su ROM coerente", () => {
    const h = parseGenesisRomHeader(buildGenesisRom());
    expect(h.checksumValid).toBe(true);
    expect(h.checksumFormat).toBe("sega");
  });

  test("un byte cambiato dopo 0x200 → checksum non più valido (sensibilità reale)", () => {
    const rom = buildGenesisRom();
    rom[0x2000] ^= 1;
    const h = parseGenesisRomHeader(rom);
    expect(h.checksumValid).toBe(false);
  });

  test("variante SGDK (XOR, dal sorgente sizebnd): il fix sgdk produce checksum verificato", () => {
    const rom = buildGenesisRom({ badChecksum: true });
    const { rom: fixed } = fixGenesisChecksum(rom, true);
    expect(fixed[0x18e]).toBe((genesisChecksumSgdk(fixed) >> 8) & 0xff);
    const h = parseGenesisRomHeader(fixed);
    expect(h.checksumValid).toBe(true);
    expect(h.checksumFormat).toBe("sgdk");
  });

  test("fix formato Sega: round-trip verifica come valido, input non mutato", () => {
    const rom = buildGenesisRom({ badChecksum: true });
    const snapshot = Buffer.from(rom).toString("base64");
    const { rom: fixed, checksum } = fixGenesisChecksum(rom, false);
    expect(Buffer.from(rom).toString("base64")).toBe(snapshot); // copia difensiva
    const h = parseGenesisRomHeader(fixed);
    expect(h.checksumValid).toBe(true);
    expect(h.computedChecksum).toBe(checksum);
  });

  test("i due algoritmi danno valori diversi sullo stesso input (formati distinti)", () => {
    const rom = buildGenesisRom();
    expect(genesisChecksum(rom)).not.toBe(genesisChecksumSgdk(rom));
  });
});

describe("scaffoldExtra (SGDK / KOS / PSP)", () => {
  test("genesis: Makefile che include makefile.gen reale di SGDK + main.c", () => {
    const r = scaffoldExtra("genesis");
    if ("error" in r) throw new Error(r.error);
    expect(r.files["Makefile"]).toContain("$(GDK)/makefile.gen");
    expect(r.files["src/main.c"]).toContain("#include <genesis.h>");
    expect(r.notes).toContain("NON compila"); // onestà dichiarata
  });

  test("dreamcast: struttura Makefile KOS reale (kos-cc + Makefile.rules)", () => {
    const r = scaffoldExtra("dreamcast");
    if ("error" in r) throw new Error(r.error);
    expect(r.files["Makefile"]).toContain("$(KOS_BASE)/Makefile.rules");
    expect(r.files["Makefile"]).toContain("kos-cc");
    expect(r.files["main.c"]).toContain("#include <kos.h>");
  });

  test("psp: Makefile standard build.mak + pattern callback ufficiale PSPSDK", () => {
    const r = scaffoldExtra("psp");
    if ("error" in r) throw new Error(r.error);
    expect(r.files["Makefile"]).toContain("$(PSPSDK)/lib/build.mak");
    expect(r.files["Makefile"]).toContain("EBOOT.PBP");
    expect(r.files["src/main.c"]).toContain("PSP_MODULE_INFO");
    expect(r.files["src/main.c"]).toContain("sceKernelExitGame");
  });

  test("detectExtraToolchains onesto: nessun detected finto su questa macchina", () => {
    const s = detectExtraToolchains();
    for (const k of ["genesis", "dreamcast", "psp"] as const) {
      expect(typeof s[k].detected).toBe("boolean");
      expect(s[k].installHint.length).toBeGreaterThan(30);
      if (!s[k].detected) expect(s[k].path).toBeUndefined();
    }
  });
});

describe("identificazione PBP (PSP)", () => {
  test("EBOOT.PBP sintetica riconosciuta dal magic \\0PBP", () => {
    const pbp = new Uint8Array(64);
    pbp.set([0x00, 0x50, 0x42, 0x50], 0);
    const r = identifyConsole(pbp);
    expect(r.console).toBe("Sony PlayStation Portable");
    expect(r.confidence).toBe("magic");
  });
});
