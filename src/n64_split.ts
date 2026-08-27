/**
 * 🔷 Splitter di ROM N64 — due livelli reali, entrambi onesti:
 *
 * 1) SCANNER NATIVO (nessuna dipendenza): scandisce la ROM cercando i magic
 *    dei formati di compressione generici N64 ("MIO0", "Yay0") e per ogni
 *    hit valida l'header (dimensioni plausibili, bounds) prima di
 *    segnalarlo. È un aiuto concreto per NON dover più "indovinare gli
 *    offset a mano", senza pretendere di capire la semantica del gioco.
 *
 * 2) ORCHESTRAZIONE SPLAT (subprocess, se installato): splat
 *    (github.com/ethteck/splat, MIT) è lo splitter REALE usato dai
 *    progetti di decompilazione sm64/oot/mm. Il flusso qui implementato
 *    segue la documentazione reale del progetto (letta direttamente dai
 *    sorgenti in questa sessione):
 *      a. `python -m splat create_config baserom.z64` — genera il config
 *         YAML autonomamente rilevando entrypoint, CIC, header encoding
 *         (meglio di qualunque config scritto a mano da noi);
 *      b. `python -m splat split <basename>.yaml` — separa la ROM.
 *    Tutto avviene in una directory temporanea cancellata subito dopo:
 *    la ROM fornita dal client non viene MAI salvata in modo permanente,
 *    coerentemente con la policy dichiarata del progetto.
 */

import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface ScannedSection {
  offset: number;
  format: "MIO0" | "Yay0";
  compressedSize: number; // dimensione del blocco compresso (per Yay0: stimata)
  decompressedSize: number;
}

function be32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/**
 * Scanner nativo: cerca blocchi MIO0/Yay0 con header valido.
 *
 * Layout header REALI (identici a quelli dei codec in src/n64_mio0.ts e
 * src/n64_yay0.ts, cross-checkati contro libmio0.c e n64decompress):
 *   MIO0: 0-3 "MIO0", 4-7 dimensione decompressa, 8-11 offset sezione
 *         compressa (link table), 12-15 offset sezione letterali. La
 *         dimensione TOTALE del blocco NON è nell'header: viene stimata
 *         con l'offset del blocco successivo o fine ROM.
 *   Yay0: 0-3 "Yay0", 4-7 dimensione decompressa, 8-11 offset link table,
 *         12-15 offset sezione chunk. Anche qui nessuna size totale.
 *
 * Bug storico corretto qui: la prima versione dello scanner leggeva MIO0
 * con un layout inesistente (size a 8-11, link a 16-19) — autoconsistente
 * coi propri test ma incompatibile coi blocchi reali prodotti dal nostro
 * stesso encoder MIO0. Il test di round-trip ora passa per costruzione
 * attraverso il codec reale.
 */
export function scanRomSections(rom: Uint8Array): ScannedSection[] {
  const sections: ScannedSection[] = [];
  const n = rom.length;

  for (let off = 0x400; off + 16 <= n; off += 4) { // blocchi sempre allineati a 4; 0x400 salta header+bootstrap
    const magic = String.fromCharCode(rom[off], rom[off + 1], rom[off + 2], rom[off + 3]);
    if (magic !== "MIO0" && magic !== "Yay0") continue;

    if (magic === "MIO0") {
      const decompressedSize = be32(rom, off + 4);
      const compOffset = be32(rom, off + 8);
      const uncompOffset = be32(rom, off + 12);
      // sanity reale: sezioni ordinate e dentro la ROM; la link table
      // (2 byte/token, 1 token ogni ≥3 byte decompressi) non può essere
      // più grande del doppio dei dati decompressi
      if (
        decompressedSize > 0 && decompressedSize < 0x8000000 &&
        compOffset >= 16 && uncompOffset > compOffset &&
        off + uncompOffset <= n &&
        uncompOffset - compOffset <= 2 * decompressedSize
      ) {
        sections.push({ offset: off, format: "MIO0", compressedSize: n - off, decompressedSize });
      }
    } else {
      const decompressedSize = be32(rom, off + 4);
      const linkTableOffset = be32(rom, off + 8);
      const chunkOffset = be32(rom, off + 12);
      if (
        decompressedSize > 0 && decompressedSize < 0x8000000 &&
        linkTableOffset >= 16 && chunkOffset > linkTableOffset &&
        off + chunkOffset <= n &&
        chunkOffset - linkTableOffset <= decompressedSize // link table ≤ 1 voce ogni 3 byte min
      ) {
        sections.push({ offset: off, format: "Yay0", compressedSize: n - off, decompressedSize });
      }
    }
  }

  // nessuno dei due formati memorizza la size totale: stimata con l'offset
  // del blocco successivo (o fine ROM) per l'ultimo
  const sorted = sections.sort((a, b) => a.offset - b.offset);
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1]?.offset ?? n;
    sorted[i].compressedSize = Math.min(sorted[i].compressedSize, next - sorted[i].offset);
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Orchestrazione splat
// ---------------------------------------------------------------------------

export interface SplatStatus {
  installed: boolean;
  pythonPath: string | null;
  version: string | null;
  installHint: string;
}

/** Rileva se splat è importabile da qualche interprete Python reale. */
export function detectSplat(): SplatStatus {
  const candidates = ["python3", "python"];
  for (const py of candidates) {
    const probe = spawnSync(py, ["-c", "import splat; print(splat.__version__)"], {
      encoding: "utf8",
      timeout: 15000,
    });
    if (probe.status === 0 && probe.stdout.trim()) {
      const which = spawnSync(py, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
      return {
        installed: true,
        pythonPath: which.stdout.trim() || py,
        version: probe.stdout.trim(),
        installHint: "",
      };
    }
  }
  return {
    installed: false,
    pythonPath: null,
    version: null,
    installHint: "Installa splat realmente con: pip install splat (richiede Python 3.9+). Nessun fallback simulato: senza splat resta disponibile lo scanner nativo di blocchi MIO0/Yay0.",
  };
}

export interface SplatSplitResult {
  success: boolean;
  logs: string;
  files: Array<{ name: string; size: number; base64: string }>;
  configYaml: string;
}

/**
 * Esegue splat REALMENTE (se installato) su una ROM fornita dal client:
 * 1. scrive la ROM in una dir temporanea (cancellata nel finally);
 * 2. `python -m splat create_config baserom.z64` (config generato da splat);
 * 3. `python -m splat split <basename>.yaml`;
 * 4. raccoglie i file prodotti (max 200, 2MB l'uno) e li restituisce.
 */
export function runSplatSplit(rom: Uint8Array): SplatSplitResult {
  const status = detectSplat();
  if (!status.installed) {
    return { success: false, logs: "splat non installato su questa macchina.\n" + status.installHint, files: [], configYaml: "" };
  }

  const dir = mkdtempSync(join(tmpdir(), "rcsb-splat-"));
  try {
    writeFileSync(join(dir, "baserom.z64"), rom);

    // a. config generato da splat stesso: rileva entrypoint/CIC/header
    const cc = spawnSync(status.pythonPath!, ["-m", "splat", "create_config", "baserom.z64"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60000,
    });
    const ccLogs = (cc.stdout || "") + (cc.stderr || "");
    if (cc.status !== 0) {
      return {
        success: false,
        logs: `create_config fallito (exit ${cc.status}):\n${ccLogs}`,
        files: [],
        configYaml: "",
      };
    }
    // il config viene scritto come <basename>.yaml nella cwd di splat
    const yamls = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    if (yamls.length === 0) {
      return { success: false, logs: "create_config non ha prodotto alcun .yaml.\n" + ccLogs, files: [], configYaml: "" };
    }
    const configYaml = readFileSync(join(dir, yamls[0]), "utf8");

    // b. split vero e proprio
    const proc = spawnSync(status.pythonPath!, ["-m", "splat", "split", yamls[0]], {
      cwd: dir,
      encoding: "utf8",
      timeout: 300000,
    });
    const logs = ccLogs + "\n--- split ---\n" + (proc.stdout || "") + (proc.stderr ? "\nSTDERR:\n" + proc.stderr : "") + (proc.status !== 0 ? `\n(exit code ${proc.status})` : "");
    if (proc.status !== 0) {
      return { success: false, logs, files: [], configYaml };
    }

    // c. raccolta dei prodotti
    const files: SplatSplitResult["files"] = [];
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

    return { success: true, logs, files, configYaml };
  } finally {
    rmSync(dir, { recursive: true, force: true }); // dir effimera: nessuna ROM persistita
  }
}
