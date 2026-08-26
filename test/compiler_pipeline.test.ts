import { describe, test, expect } from "bun:test";
import { existsSync } from "fs";
import { CompilerPipeline } from "../src/compiler_pipeline";

/**
 * Test di integrazione REALE per il rilevamento toolchain (src/compiler_pipeline.ts).
 * Richiede devkitPro installato su questa macchina sotto /opt/devkitpro (o
 * $DEVKITPRO). Su una macchina/CI senza devkitPro il test viene saltato
 * onestamente (skip, non fail) invece di fingere un ambiente che non c'è.
 * Nessun compile-and-link completo qui (troppo lento per la test suite):
 * solo la rilevazione reale dei binari su disco.
 */
const devkitProPath = process.env.DEVKITPRO || "/opt/devkitpro";
const hasDevkitPro = existsSync(devkitProPath);

describe("CompilerPipeline.detectToolchains", () => {
  test.skipIf(!hasDevkitPro)("rileva realmente i toolchain devkitPro presenti su disco per Switch, GameCube, Wii", () => {
    const pipeline = new CompilerPipeline();
    const status = pipeline.detectToolchains();

    expect(status.switch.detected).toBe(true);
    expect(status.switch.path).toBeTruthy();
    expect(existsSync(status.switch.path!)).toBe(true);

    expect(status.gamecube.detected).toBe(true);
    expect(status.gamecube.path).toBeTruthy();
    expect(existsSync(status.gamecube.path!)).toBe(true);

    expect(status.wii.detected).toBe(true);
    expect(status.wii.path).toBeTruthy();
    expect(existsSync(status.wii.path!)).toBe(true);
  });

  test("non fallisce mai e ritorna sempre una struttura completa per tutte le piattaforme", () => {
    const pipeline = new CompilerPipeline();
    const status = pipeline.detectToolchains();

    for (const platform of ["snes", "n64", "gamecube", "wii", "switch"] as const) {
      expect(status[platform]).toHaveProperty("compiler");
      expect(status[platform]).toHaveProperty("detected");
      expect(typeof status[platform].detected).toBe("boolean");
      // Se non rilevato, non deve comunque restituire un path fasullo.
      if (!status[platform].detected) {
        expect(status[platform].path).toBeUndefined();
      }
    }
  });
});
