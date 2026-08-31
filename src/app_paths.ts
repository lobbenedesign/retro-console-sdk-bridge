/**
 * 📁 Risoluzione percorsi reale per dev (bun server.ts) VS eseguibile
 * compilato ("bun build --compile").
 *
 * In sviluppo import.meta.dir è un percorso reale sul disco. In un
 * eseguibile compilato i moduli sono incorporati in un filesystem
 * virtuale di sola lettura e import.meta.dir diventa "/$bunfs/root" —
 * scriverci fallisce (EROFS) e i file reali distribuiti accanto
 * all'eseguibile (es. include/nintendo_hal.h, letto da un compilatore
 * C esterno che non può leggere dentro il bundle) non sono raggiungibili
 * da quel percorso. Bug reale, trovato eseguendo davvero l'eseguibile
 * compilato (non solo compilandolo): process.execPath resta invece il
 * percorso reale del binario anche da compilato, quindi lo usiamo come
 * radice per gli asset distribuiti accanto ad esso.
 */

import { join, dirname } from "path";
import { homedir } from "os";

export function isCompiledExecutable(): boolean {
  return import.meta.dir.includes("$bunfs");
}

/** Radice del progetto in dev, cartella dell'eseguibile se compilato. */
export function appRootDir(): string {
  return isCompiledExecutable() ? dirname(process.execPath) : join(import.meta.dir, "..");
}

/** Logica pura (platform/homedir/APPDATA passati esplicitamente) per poterla
 * testare per tutti e 3 i sistemi operativi senza dover eseguire su ciascuno. */
export function resolveUserDataDirFor(platform: string, home: string, appdataEnv: string | undefined): string {
  const appName = "RetroConsoleSDKBridge";
  if (platform === "darwin") return join(home, "Library", "Application Support", appName);
  if (platform === "win32") return join(appdataEnv || join(home, "AppData", "Roaming"), appName);
  return join(home, ".local", "share", "retro-console-sdk-bridge");
}

/** Cartella dati scrivibile: "data/" locale in dev, cartella dati utente del SO se compilato. */
export function userDataDir(): string {
  if (!isCompiledExecutable()) return join(import.meta.dir, "..", "data");
  return resolveUserDataDirFor(process.platform, homedir(), process.env.APPDATA);
}
