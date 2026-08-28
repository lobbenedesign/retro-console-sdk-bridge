import { describe, expect, test } from "bun:test";
import { DASHBOARD_HTML } from "../src/dashboard_html";

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
    const proc = Bun.spawnSync(["bun", "build", "--no-bundle", "/dev/stdin"], {
      stdin: new Response(scriptMatch![1]),
      stdout: "pipe",
      stderr: "pipe",
    });
    // bun build scrive l'output su stdout se ok; in errore exitCode != 0
    const stderr = new TextDecoder().decode(proc.stderr);
    expect(proc.exitCode).toBe(0);
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
