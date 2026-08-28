import { describe, expect, test } from "bun:test";
import { DASHBOARD_HTML } from "../src/dashboard_html";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * 🛡️ Test di regressione della UI servita.
 *
 * Origine (bug reale trovato dall'utente, 2026-08-28): una stringa JS con
 * a-capo letterali dentro apici doppi rendeva l'INTERO <script> illeggibile
 * dal browser → nessun pulsante rispondeva ("carico lo zip e non accade
 * nulla"). Le verifiche fatte finora controllavano solo marker HTML via
 * testo, mai che il JS fosse sintatticamente valido.
 *
 * Ora estraiamo lo script dalla dashboard servita e lo compiliamo davvero:
 * se non parsa, questo test fallisce.
 */
describe("dashboard UI servita (DASHBOARD_HTML)", () => {
  const scriptMatch = DASHBOARD_HTML.match(/<script>([\s\S]*?)<\/script>/);
  test("contiene uno <script> client", () => {
    expect(scriptMatch).not.toBeNull();
    expect(scriptMatch![1].length).toBeGreaterThan(1000);
  });

  test("il JavaScript client è sintatticamente valido (compilazione reale)", async () => {
    // Scrive lo script in un vero file temporaneo invece di affidarsi a
    // /dev/stdin + Bun.spawnSync({stdin: new Response(...)}): quella
    // combinazione dipende dal fatto che /dev/stdin sia effettivamente
    // collegato allo stdin del processo figlio, il che su alcuni runner
    // Linux/CI non è garantito con spawnSync (bug trovato: passava in
    // locale su macOS, falliva in CI con exitCode!=0 pur essendo il JS
    // sintatticamente valido — un file reale è portabile su qualunque piattaforma).
    const dir = mkdtempSync(join(tmpdir(), "dashboard-ui-test-"));
    const file = join(dir, "dashboard-script.js");
    writeFileSync(file, scriptMatch![1]);
    try {
      const proc = Bun.spawnSync(["bun", "build", "--no-bundle", file], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = new TextDecoder().decode(proc.stderr);
      expect(proc.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("i punti di ingresso principali sono collegati", () => {
    for (const marker of [
      "function loadRom",
      "rom-input",
      "dropzone",
      "checkOnboarding",
      "function scanUI",
      "function f3dParseUI",
      "function lsParseUI",
      "function mipsUI",
      "function crcFixUI",
      "function patchApplyUI",
      "function compileUI",
    ]) {
      expect(DASHBOARD_HTML.includes(marker)).toBe(true);
    }
  });

  test("nessuna stringa JS multilinea illegale (a-capo dentro apici semplici)", () => {
    // heuristica realistica: cerca '"..."\n' senza chiusura sulla stessa riga
    // nei punti noti di rischio — DEFAULT_CODE è ora costruito con join
    expect(DASHBOARD_HTML).toContain('].join("\\n");');
    expect(DASHBOARD_HTML).not.toMatch(/const DEFAULT_CODE = "[^"]*\n/);
  });
});
