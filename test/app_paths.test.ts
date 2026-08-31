import { describe, expect, test } from "bun:test";
import { isCompiledExecutable, appRootDir, userDataDir, resolveUserDataDirFor } from "../src/app_paths";

/**
 * 🛡️ Test per app_paths.ts, il modulo che risolve i percorsi reali per
 * dev VS eseguibile compilato — nato da un bug reale (EROFS) trovato
 * eseguendo davvero "bun build --compile" e il binario prodotto, non solo
 * leggendo il codice. Il ramo "eseguibile compilato" (import.meta.dir
 * contiene "$bunfs") non è simulabile qui in modo pulito — import.meta.dir
 * non è mockabile — quindi resta verificato dal test end-to-end manuale
 * già fatto in sessione (avvio reale del binario, scrittura riuscita in
 * ~/Library/Application Support/...). La logica di scelta cartella per
 * sistema operativo, invece, è pura e testabile per tutti e 3 i rami.
 */

describe("app_paths", () => {
  test("in dev (bun test) non è rilevato come eseguibile compilato", () => {
    expect(isCompiledExecutable()).toBe(false);
  });

  test("appRootDir in dev punta alla radice reale del progetto (contiene package.json)", async () => {
    const root = appRootDir();
    expect(root.includes("$bunfs")).toBe(false);
    expect(await Bun.file(root + "/package.json").exists()).toBe(true);
  });

  test("userDataDir in dev è 'data/' accanto al sorgente", () => {
    const dir = userDataDir();
    expect(dir.endsWith("/data")).toBe(true);
    expect(dir.includes("$bunfs")).toBe(false);
  });

  test("resolveUserDataDirFor: macOS usa Application Support", () => {
    const dir = resolveUserDataDirFor("darwin", "/Users/test", undefined);
    expect(dir).toBe("/Users/test/Library/Application Support/RetroConsoleSDKBridge");
  });

  test("resolveUserDataDirFor: Windows usa APPDATA quando presente", () => {
    const dir = resolveUserDataDirFor("win32", "C:\\Users\\test", "C:\\Users\\test\\AppData\\Roaming");
    expect(dir.replace(/\\/g, "/")).toBe("C:/Users/test/AppData/Roaming/RetroConsoleSDKBridge");
  });

  test("resolveUserDataDirFor: Windows ricostruisce APPDATA se assente", () => {
    const dir = resolveUserDataDirFor("win32", "C:\\Users\\test", undefined);
    expect(dir.replace(/\\/g, "/")).toBe("C:/Users/test/AppData/Roaming/RetroConsoleSDKBridge");
  });

  test("resolveUserDataDirFor: Linux/altro usa XDG-style ~/.local/share", () => {
    const dir = resolveUserDataDirFor("linux", "/home/test", undefined);
    expect(dir).toBe("/home/test/.local/share/retro-console-sdk-bridge");
  });
});
