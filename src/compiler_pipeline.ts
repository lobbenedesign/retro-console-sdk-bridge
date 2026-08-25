import { existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

export interface ToolchainStatus {
  snes: { compiler: string; detected: boolean; path?: string };
  n64: { compiler: string; detected: boolean; path?: string };
  gamecube: { compiler: string; detected: boolean; path?: string };
  wii: { compiler: string; detected: boolean; path?: string };
  switch: { compiler: string; detected: boolean; path?: string };
}

export interface BuildParams {
  platform: "snes" | "n64" | "gamecube" | "wii" | "switch";
  sourceCode: string;
}

export interface BuildResult {
  success: boolean;
  elfSize: number;
  outputBinaryName: string;
  outputBinaryBase64?: string;
  logs: string;
  compilerUsed: string;
  packaged: boolean; // true solo se il tool di packaging reale (elf2nro/elf2dol/n64tool) ha prodotto il formato finale reale
  installHint?: string;
}

// devkitPro è il toolchain reale, open-source e gratuito per homebrew su console
// Nintendo (github.com/devkitPro). Rileva sia i binari sul PATH sia l'installazione
// standard sotto $DEVKITPRO, invece di indovinare nomi di comando generici.
const DEVKITPRO = process.env.DEVKITPRO || "/opt/devkitpro";

function which(cmd: string): string | null {
  try {
    const proc = Bun.spawnSync(["which", cmd]);
    const out = new TextDecoder().decode(proc.stdout).trim();
    return proc.exitCode === 0 && out ? out : null;
  } catch {
    return null;
  }
}

function findBin(candidates: string[]): { detected: boolean; path?: string } {
  for (const c of candidates) {
    if (existsSync(c)) return { detected: true, path: c };
    const w = which(c);
    if (w) return { detected: true, path: w };
  }
  return { detected: false };
}

export class CompilerPipeline {
  /**
   * Rileva i toolchain reali: prima sul PATH, poi nei percorsi standard di
   * installazione devkitPro ($DEVKITPRO/devkitA64, devkitPPC, ecc). Nessun
   * finto "detected: true": se il binario non esiste su disco, è false.
   */
  public detectToolchains(): ToolchainStatus {
    return {
      snes: { compiler: "wla-65816 (WLA-DX)", ...findBin(["wla-65816"]) },
      n64: { compiler: "mips64-elf-gcc (n64chain / libdragon toolchain)", ...findBin(["mips64-elf-gcc", `${DEVKITPRO}/../n64chain/bin/mips64-elf-gcc`]) },
      gamecube: { compiler: "powerpc-eabi-gcc (devkitPPC)", ...findBin(["powerpc-eabi-gcc", `${DEVKITPRO}/devkitPPC/bin/powerpc-eabi-gcc`]) },
      wii: { compiler: "powerpc-eabi-gcc (devkitPPC)", ...findBin(["powerpc-eabi-gcc", `${DEVKITPRO}/devkitPPC/bin/powerpc-eabi-gcc`]) },
      switch: { compiler: "aarch64-none-elf-gcc (devkitA64)", ...findBin(["aarch64-none-elf-gcc", `${DEVKITPRO}/devkitA64/bin/aarch64-none-elf-gcc`]) }
    };
  }

  private packagingTool(platform: BuildParams["platform"]): { tool: string; ext: string } {
    switch (platform) {
      case "switch": return { tool: "elf2nro", ext: ".nro" };
      case "wii": case "gamecube": return { tool: "elf2dol", ext: ".dol" };
      case "n64": return { tool: "n64tool", ext: ".z64" };
      case "snes": return { tool: "", ext: ".sfc" }; // WLA-DX produce già il .sfc direttamente
    }
  }

  private installInstructions(platform: BuildParams["platform"]): string {
    const base = "devkitPro è il toolchain reale gratuito per homebrew Nintendo (github.com/devkitPro/pacman): installa devkitPro pacman, poi esegui";
    switch (platform) {
      case "switch": return `${base} 'sudo dkp-pacman -S switch-dev' per ottenere aarch64-none-elf-gcc + libnx.`;
      case "wii": case "gamecube": return `${base} 'sudo dkp-pacman -S wii-dev' (o gamecube-dev) per ottenere powerpc-eabi-gcc + libogc.`;
      case "n64": return `Installa un toolchain N64 reale come libdragon (github.com/DragonMinded/libdragon) o n64chain per ottenere mips64-elf-gcc.`;
      case "snes": return `Installa WLA-DX (github.com/vhelin/wla-dx) per ottenere l'assembler wla-65816 reale.`;
    }
  }

  /**
   * Compila con un vero cross-compiler se disponibile. Se il toolchain o il
   * tool di packaging finale non sono installati, ritorna SEMPRE
   * success:false con istruzioni reali — mai un binario o un log fabbricato
   * che finga una compilazione riuscita.
   */
  public async compile(params: BuildParams): Promise<BuildResult> {
    const toolchains = this.detectToolchains();
    const status = toolchains[params.platform];
    const { tool: packTool, ext } = this.packagingTool(params.platform);

    if (!status.detected || !status.path) {
      return {
        success: false,
        elfSize: 0,
        outputBinaryName: "",
        logs: `✗ Toolchain reale non trovato: '${status.compiler}' non è installato su questa macchina (verificato sia sul PATH sia nei percorsi standard $DEVKITPRO).\n` +
          `Nessun binario è stato generato: questo studio non fabbrica mai un finto ROM "riuscito" quando il compilatore reale manca.\n` +
          `${this.installInstructions(params.platform)}`,
        compilerUsed: status.compiler,
        packaged: false,
        installHint: this.installInstructions(params.platform)
      };
    }

    const tempDir = "/tmp";
    const stamp = Date.now();
    const sourceFile = join(tempDir, `nintendo_game_${stamp}.c`);
    const objFile = join(tempDir, `nintendo_game_${stamp}.o`);
    const elfFile = join(tempDir, `nintendo_game_${stamp}.elf`);
    writeFileSync(sourceFile, params.sourceCode);

    const archFlags: Record<BuildParams["platform"], string[]> = {
      switch: ["-march=armv8-a", "-mtune=cortex-a57", "-mtp=soft", "-fPIE"],
      wii: ["-mhard-float"],
      gamecube: ["-mhard-float"],
      n64: ["-march=vr4300"],
      snes: []
    };

    // 1. Compilazione reale del sorgente C in un vero object file.
    const compileArgs = [status.path, ...archFlags[params.platform], "-O2", "-c", sourceFile, "-o", objFile, `-I${join(import.meta.dir, "..", "include")}`];
    if (params.platform === "switch") compileArgs.push(`-I${DEVKITPRO}/libnx/include`);
    const proc = Bun.spawn(compileArgs, { stdout: "pipe", stderr: "pipe" });
    const stderr = await new Response(proc.stderr).text();
    const compileCode = await proc.exited;

    if (compileCode !== 0 || !existsSync(objFile)) {
      return {
        success: false,
        elfSize: 0,
        outputBinaryName: "",
        logs: `✗ Compilazione reale fallita con ${status.compiler}:\n${stderr.slice(-1500)}`,
        compilerUsed: status.compiler,
        packaged: false
      };
    }

    let linkLog = "";
    let linkedElf = false;

    // 1b. Per Switch, link reale contro libnx (switch.specs reale di devkitPro)
    // per produrre un ELF eseguibile vero, non solo un object file isolato.
    if (params.platform === "switch" && existsSync(`${DEVKITPRO}/libnx/switch.specs`)) {
      const linkArgs = [
        status.path, "-specs=" + `${DEVKITPRO}/libnx/switch.specs`,
        "-march=armv8-a", "-mtune=cortex-a57", "-mtp=soft", "-fPIE", "-Wl,-pie",
        "-o", elfFile, objFile,
        `-L${DEVKITPRO}/libnx/lib`, `-L${DEVKITPRO}/devkitA64/aarch64-none-elf/lib`,
        "-lnx"
      ];
      const linkProc = Bun.spawn(linkArgs, { stdout: "pipe", stderr: "pipe", env: { ...process.env, DEVKITPRO } });
      const linkErr = await new Response(linkProc.stderr).text();
      const linkCode = await linkProc.exited;
      linkedElf = linkCode === 0 && existsSync(elfFile);
      linkLog = linkedElf
        ? `✓ Link reale contro libnx (switch.specs): OK`
        : `⚠ Compilazione a object file riuscita, ma il link reale contro libnx è fallito: ${linkErr.slice(-500)}`;
    }

    // 2. Packaging reale nel formato finale della console, se il tool esiste davvero.
    const packagingBin = packTool ? which(packTool) : "n/a (WLA-DX produce già il formato finale)";
    let finalFile = linkedElf ? elfFile : objFile;
    let packaged = params.platform === "snes"; // WLA-DX produce direttamente il .sfc, nessun secondo passo
    let packagingLog = "";

    if (packTool && packagingBin && linkedElf) {
      const outFile = join(tempDir, `nintendo_game_${stamp}${ext}`);
      const packProc = Bun.spawn([packagingBin, elfFile, outFile], { stdout: "pipe", stderr: "pipe" });
      const packErr = await new Response(packProc.stderr).text();
      const packCode = await packProc.exited;
      if (packCode === 0 && existsSync(outFile)) {
        finalFile = outFile;
        packaged = true;
        packagingLog = `✓ Packaging reale con ${packTool}: OK`;
      } else {
        packagingLog = `⚠ Link riuscito, ma il packaging con ${packTool} è fallito: ${packErr.slice(-500)}\nViene restituito l'ELF linkato grezzo, NON un ${ext} funzionante.`;
      }
    } else if (packTool && !linkedElf) {
      packagingLog = `⚠ Nessun ELF linkato disponibile: viene restituito l'object file grezzo (.o), NON un ${ext} funzionante.`;
    } else if (packTool && !packagingBin) {
      packagingLog = `⚠ Il tool di packaging '${packTool}' non è installato: viene restituito l'ELF grezzo, NON un ${ext} funzionante.`;
    }
    packagingLog = [linkLog, packagingLog].filter(Boolean).join("\n");

    const binaryData = readFileSync(finalFile);
    return {
      success: true,
      elfSize: binaryData.length,
      outputBinaryName: `game_${params.platform}${packaged ? ext : linkedElf ? ".elf" : ".o"}`,
      outputBinaryBase64: binaryData.toString("base64"),
      logs: `✓ Compilato realmente con ${status.compiler} (${status.path})\n${packagingLog}`,
      compilerUsed: status.compiler,
      packaged
    };
  }
}
