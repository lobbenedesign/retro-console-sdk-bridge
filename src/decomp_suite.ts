/**
 * 🧩 Suite decompilazione + Fast64 — orchestrazione, non reimplementazione.
 *
 * Due pezzi reali, entrambi esterni a questo progetto:
 * 1. n64decomp/sm64 (e zeldaret/oot): il codice sorgente C reale, decompilato
 *    dalla community, di questi giochi — ogni funzione/asset con un nome
 *    leggibile. Richiede la ROM originale dell'utente come "baserom" per
 *    estrarre gli asset in locale: mai forniamo o distribuiamo asset.
 * 2. Fast64 (github.com/Fast-64/fast64): addon Blender per SM64/OoT — vive
 *    DENTRO Blender, un'applicazione 3D separata da ~200+ MB che non ha
 *    senso (e non è onesto) reimplementare o "incorporare" in una pagina
 *    web. Qui rileviamo se Blender+Fast64 sono già installati, diamo le
 *    istruzioni reali se mancano, e possiamo lanciare l'app vera — stesso
 *    pattern già usato per devkitPro/splat/N64Recomp in questo progetto.
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

export interface DecompProjectInfo {
  id: string;
  name: string;
  repoUrl: string;
  baseromHint: string;
}

export const DECOMP_PROJECTS: DecompProjectInfo[] = [
  {
    id: "sm64",
    name: "Super Mario 64",
    repoUrl: "https://github.com/n64decomp/sm64",
    baseromHint: "baserom.us.z64 (o .jp/.eu/.sh/.cn secondo la versione) nella root del progetto clonato — la TUA copia legale, mai fornita da noi.",
  },
  {
    id: "oot",
    name: "The Legend of Zelda: Ocarina of Time",
    repoUrl: "https://github.com/zeldaret/oot",
    baseromHint: "baserom.z64 nella root del progetto clonato, versione esatta documentata nel README del repo — la TUA copia legale.",
  },
];

export interface CloneResult {
  path: string;
  alreadyCloned: boolean;
  log: string;
}

/** Clona (shallow, --depth 1) uno dei progetti di decompilazione reali. */
export function cloneDecompProject(id: string, destParent: string): CloneResult {
  const proj = DECOMP_PROJECTS.find((p) => p.id === id);
  if (!proj) throw new Error(`Progetto decomp sconosciuto: ${id}`);

  const dest = join(destParent, id);
  if (existsSync(dest)) {
    return { path: dest, alreadyCloned: true, log: `Già presente in ${dest} — non riclonato.` };
  }
  mkdirSync(destParent, { recursive: true });

  const result = spawnSync("git", ["clone", "--depth", "1", proj.repoUrl, dest], {
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
  });
  if (result.status !== 0) {
    throw new Error(`git clone fallito: ${result.stderr || result.error?.message || "errore sconosciuto"}`);
  }
  return { path: dest, alreadyCloned: false, log: (result.stdout || "") + (result.stderr || "") };
}

export interface BlenderStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  installHint: string;
}

const BLENDER_INSTALL_HINT = "Scarica Blender (gratuito, open source) da https://www.blender.org/download/ e installalo normalmente.";

function parseBlenderVersion(stdout: string): string | null {
  const m = stdout.match(/Blender\s+([\d.]+)/);
  return m ? m[1] : null;
}

/** Rileva una vera installazione di Blender (percorsi reali per SO, mai un finto "trovato"). */
export function detectBlender(): BlenderStatus {
  if (process.platform === "darwin") {
    const appPath = "/Applications/Blender.app/Contents/MacOS/Blender";
    if (existsSync(appPath)) {
      const v = spawnSync(appPath, ["--version"], { encoding: "utf8", timeout: 20000 });
      return { installed: true, path: appPath, version: parseBlenderVersion(v.stdout || ""), installHint: "" };
    }
  } else if (process.platform === "win32") {
    const base = "C:\\Program Files\\Blender Foundation";
    if (existsSync(base)) {
      for (const d of readdirSync(base)) {
        const exe = join(base, d, "blender.exe");
        if (existsSync(exe)) return { installed: true, path: exe, version: d.replace(/^Blender\s*/, ""), installHint: "" };
      }
    }
  } else {
    const which = spawnSync("which", ["blender"], { encoding: "utf8" });
    if (which.status === 0 && which.stdout.trim()) {
      const path = which.stdout.trim();
      const v = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 20000 });
      return { installed: true, path, version: parseBlenderVersion(v.stdout || ""), installHint: "" };
    }
  }
  return { installed: false, path: null, version: null, installHint: BLENDER_INSTALL_HINT };
}

export interface Fast64Status {
  installed: boolean;
  addonPath: string | null;
  installHint: string;
}

const FAST64_INSTALL_HINT =
  "Installa Fast64 (addon Blender non ufficiale ma mantenuto dalla community, github.com/Fast-64/fast64) scaricando lo ZIP dell'ultima release e aggiungendolo da Blender → Edit → Preferences → Add-ons → Install. Richiede Blender già installato.";

/** Rileva Fast64 cercando la cartella addon reale nelle directory di config Blender per SO. */
export function detectFast64(): Fast64Status {
  const candidates: string[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || "";

  let addonsRoots: string[] = [];
  if (process.platform === "darwin") {
    const base = join(home, "Library", "Application Support", "Blender");
    if (existsSync(base)) addonsRoots = readdirSync(base).map((v) => join(base, v));
  } else if (process.platform === "win32") {
    const base = join(process.env.APPDATA || "", "Blender Foundation", "Blender");
    if (existsSync(base)) addonsRoots = readdirSync(base).map((v) => join(base, v));
  } else {
    const base = join(home, ".config", "blender");
    if (existsSync(base)) addonsRoots = readdirSync(base).map((v) => join(base, v));
  }

  for (const root of addonsRoots) {
    candidates.push(join(root, "scripts", "addons", "fast64_internal"));
    // Blender 4.2+ ha spostato gli addon a "extensions" (sistema nuovo):
    // Fast64 lì vivrebbe sotto extensions/user_default/fast64 o simile.
    candidates.push(join(root, "extensions", "user_default", "fast64"));
  }

  const found = candidates.find((c) => existsSync(c));
  if (found) return { installed: true, addonPath: found, installHint: "" };
  return { installed: false, addonPath: null, installHint: FAST64_INSTALL_HINT };
}

/** Lancia Blender per davvero (processo staccato: non blocca la risposta HTTP). */
export function launchBlender(blenderPath: string): void {
  if (!existsSync(blenderPath)) throw new Error(`Percorso Blender non valido: ${blenderPath}`);
  const child = spawn(blenderPath, [], { detached: true, stdio: "ignore" });
  child.unref();
}

/** Rivela una cartella nel file manager reale del SO (Finder/Explorer/xdg-open). */
export function revealInFileManager(path: string): void {
  if (!existsSync(path)) throw new Error(`Percorso non esistente: ${path}`);
  if (process.platform === "darwin") {
    spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "win32") {
    spawn("explorer", [path], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [path], { detached: true, stdio: "ignore" }).unref();
  }
}
