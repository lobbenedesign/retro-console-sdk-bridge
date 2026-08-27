/**
 * ♻️ Orchestrazione N64Recomp (github.com/N64Recomp/N64Recomp, MIT)
 *
 * N64Recomp ricompila staticamente il codice MIPS di una ROM in un
 * eseguibile nativo (la tecnologia dietro "Zelda 64: Recompiled" e
 * "Banjo-Kazooie: Recompiled"). È un tool C++ con dipendenze pesanti
 * (rabbitizer, ELFIO, toml11, fmt) che gira OFFLINE su ROM+ELF locali:
 * qui NON lo reimplementiamo, lo ORCHESTRIAMO con lo stesso pattern già
 * usato per i toolchain devkitPro:
 *   - rilevamento reale del binario installato (PATH + percorsi comuni);
 *   - generazione di un recomp.toml REALE (schema letto direttamente
 *     dall'esempio ufficiale Zelda64Recomp/us.rev1.toml: sezioni [input]
 *     e [patches], array stubs/ignored, [[patches.instruction]]);
 *   - esecuzione reale in dir temporanea se il binario esiste, con
 *     raccolta dei file prodotti e pulizia immediata (nessuna ROM
 *     persistita, stessa policy del resto del progetto).
 */

import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface RecompStatus {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  installHint: string;
}

/** Cerca il binario N64Recomp reale: PATH, poi percorsi comuni. */
export function detectN64Recomp(): RecompStatus {
  const which = spawnSync("which", ["N64Recomp"], { encoding: "utf8" });
  let path: string | null = null;
  if (which.status === 0 && which.stdout.trim()) {
    path = which.stdout.trim();
  } else {
    const candidates = [
      "/usr/local/bin/N64Recomp",
      "/opt/N64Recomp/N64Recomp",
      join(process.env.HOME || "", ".local/bin/N64Recomp"),
      join(process.env.HOME || "", "N64Recomp/build/N64Recomp"),
    ];
    for (const c of candidates) {
      const probe = spawnSync("test", ["-x", c]);
      if (probe.status === 0) { path = c; break; }
    }
  }
  if (!path) {
    return {
      installed: false,
      binaryPath: null,
      version: null,
      installHint:
        "Costruisci e installa N64Recomp realmente: git clone --recurse-submodules https://github.com/N64Recomp/N64Recomp && cmake -B build -S N64Recomp && cmake --build build (serve CMake 3.20+ e un compilatore C++20). Il recomp.toml generato qui resta comunque valido e scaricabile.",
    };
  }
  // -h esiste davvero nel tool reale? Non documentato: proviamo invocazione
  // senza argomenti, che stampa l'usage (stderr) senza fare danni.
  const probe = spawnSync(path, { encoding: "utf8", timeout: 10000 });
  const versionMatch = (probe.stdout + probe.stderr).match(/version[:\s]+([\d.]+)/i);
  return {
    installed: true,
    binaryPath: path,
    version: versionMatch ? versionMatch[1] : "sconosciuta",
    installHint: "",
  };
}

export interface RecompTomlParams {
  gameName: string;
  entrypoint?: number;       // es. 0x80080000 per MM; SM64 US: 0x80246000
  romFileName?: string;      // default "baserom.z64"
  elfFileName?: string;      // ELF con simboli (da decomp/splat), es. "game.elf"
  symbolsFileName?: string;  // syms.toml opzionale
  outputFuncPath?: string;   // default "RecompiledFuncs"
  stubs?: string[];
  ignored?: string[];
}

/**
 * Genera un recomp.toml REALE secondo lo schema dell'esempio ufficiale
 * Zelda64Recomp (le sezioni sotto sono esattamente quelle consumate dal
 * tool: [input] con i path relativi al toml, [patches] con stubs/ignored).
 */
export function generateRecompToml(p: RecompTomlParams): string {
  const entry = p.entrypoint ?? 0x80000400; // default: inizio segmento codice tipico
  const rom = p.romFileName ?? "baserom.z64";
  const out = p.outputFuncPath ?? "RecompiledFuncs";
  const lines: string[] = [
    `# Config generato da retro-console-sdk-bridge per: ${p.gameName}`,
    `# Schema: https://github.com/Mr-Wiseguy/Zelda64Recomp/blob/dev/us.rev1.toml`,
    ``,
    `[input]`,
    `entrypoint = 0x${entry.toString(16).toUpperCase()}`,
    `# I path sono relativi alla posizione di questo file di config.`,
    `output_func_path = "${out}"`,
  ];
  if (p.elfFileName) lines.push(`elf_path = "${p.elfFileName}"`);
  if (p.symbolsFileName) lines.push(`symbols_file_path = "${p.symbolsFileName}"`);
  lines.push(`rom_file_path = "${rom}"`, ``);

  const stubs = p.stubs ?? [];
  const ignored = p.ignored ?? [];
  if (stubs.length || ignored.length) {
    lines.push(`[patches]`);
    if (stubs.length) {
      lines.push(`stubs = [`);
      stubs.forEach((s, i) => lines.push(`    "${s}"${i < stubs.length - 1 ? "," : ""}`));
      lines.push(`]`);
    }
    if (ignored.length) {
      lines.push(`ignored = [`);
      ignored.forEach((s, i) => lines.push(`    "${s}"${i < ignored.length - 1 ? "," : ""}`));
      lines.push(`]`);
    }
  }
  return lines.join("\n") + "\n";
}

export interface RecompRunResult {
  success: boolean;
  logs: string;
  files: Array<{ name: string; size: number; base64: string }>;
}

/**
 * Esegue N64Recomp REALMENTE (se installato) su ROM+ELF forniti dal
 * client, in dir temporanea cancellata subito dopo.
 */
export function runN64Recomp(
  toml: string,
  rom: Uint8Array,
  elf?: Uint8Array,
  symbolsToml?: string,
): RecompRunResult {
  const status = detectN64Recomp();
  if (!status.installed) {
    return { success: false, logs: "N64Recomp non installato su questa macchina.\n" + status.installHint, files: [] };
  }

  const dir = mkdtempSync(join(tmpdir(), "rcsb-recomp-"));
  try {
    const tomlName = "recomp.toml";
    writeFileSync(join(dir, tomlName), toml);
    writeFileSync(join(dir, "baserom.z64"), rom);
    if (elf) writeFileSync(join(dir, "game.elf"), elf);
    if (symbolsToml) writeFileSync(join(dir, "symbols.syms.toml"), symbolsToml);

    const proc = spawnSync(status.binaryPath!, [tomlName], {
      cwd: dir,
      encoding: "utf8",
      timeout: 600000, // la ricompilazione è pesante: 10 minuti di budget
    });
    const logs = (proc.stdout || "") + (proc.stderr ? "\nSTDERR:\n" + proc.stderr : "") + (proc.status !== 0 ? `\n(exit code ${proc.status})` : "");
    if (proc.status !== 0) return { success: false, logs, files: [] };

    const files: RecompRunResult["files"] = [];
    const collect = (d: string) => {
      for (const entry of readdirSync(d)) {
        if (files.length >= 200) return;
        const p = join(d, entry);
        const st = statSync(p);
        if (st.isDirectory()) collect(p);
        else if (st.size > 0 && st.size <= 2 * 1024 * 1024) {
          files.push({
            name: p.slice(dir.length + 1),
            size: st.size,
            base64: Buffer.from(readFileSync(p)).toString("base64"),
          });
        }
      }
    };
    collect(dir);
    return { success: true, logs, files };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
