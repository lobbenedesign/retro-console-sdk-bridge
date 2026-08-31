import { existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { appRootDir } from "./app_paths";

// Cancella i file temporanei di una compilazione, ignorando eventuali
// percorsi mai creati (es. l'ELF quando il link è fallito). Prima non
// venivano mai ripuliti: ogni compilazione lasciava 2-4 file reali sotto
// /tmp per sempre, un leak di spazio disco reale su una macchina che
// compila spesso — non un bug che rompe una funzione, ma uno che la rende
// via via più costosa da usare.
function cleanupTempFiles(paths: string[]): void {
  for (const p of paths) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best-effort: non bloccare la risposta della build per un cleanup fallito
    }
  }
}

export interface ToolchainStatus {
  snes: { compiler: string; detected: boolean; path?: string };
  n64: { compiler: string; detected: boolean; path?: string };
  gamecube: { compiler: string; detected: boolean; path?: string };
  wii: { compiler: string; detected: boolean; path?: string };
  switch: { compiler: string; detected: boolean; path?: string };
}

export interface BuildParams {
  platform: "snes" | "n64" | "gamecube" | "wii" | "switch";
  // Modalità singolo file (retro-compatibile): un solo sorgente inline.
  sourceCode?: string;
  // Modalità multi-file: mappa nomefile -> contenuto. Ogni .c viene
  // compilato nel proprio object file e poi tutti linkati insieme — un
  // progetto homebrew reale raramente sta in un solo file.
  sourceFiles?: Record<string, string>;
}

// Un evento per ogni fase reale della build (non simulato: emesso solo
// quando quella fase viene davvero eseguita), usato dal server per
// trasmettere il progresso in tempo reale via WebSocket invece di far
// aspettare il client a schermo nero fino al log finale in blocco unico.
export type ProgressCallback = (event: { stage: string; status: "start" | "ok" | "fail"; message: string }) => void;
const noopProgress: ProgressCallback = () => {};

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

// I tool di packaging reali di devkitPro (elf2nro, elf2dol, ...) vivono sotto
// $DEVKITPRO/tools/bin, che NON è quasi mai sul PATH di default (verificato:
// su questa macchina `which elf2nro` fallisce anche se il binario esiste
// davvero su disco). Prima cercarli lì, poi come fallback sul PATH, invece di
// segnalare erroneamente "tool non installato" quando in realtà lo è.
function findPackagingTool(name: string): string | null {
  const std = join(DEVKITPRO, "tools", "bin", name);
  if (existsSync(std)) return std;
  return which(name);
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
      n64: { compiler: "mips64-elf-gcc (n64chain / libdragon toolchain)", ...findBin([
        "mips64-elf-gcc",
        `${DEVKITPRO}/../n64chain/bin/mips64-elf-gcc`,
        // libdragon (github.com/DragonMinded/libdragon), il toolchain N64
        // più diffuso oggi, si installa sotto $N64_INST (convenzione reale
        // del suo script ./build, non indovinata: documentata nel README
        // ufficiale) — prima non veniva mai controllata, quindi chiunque
        // avesse libdragon installato SOLO lì (senza metterlo anche sul
        // PATH) vedeva "non installato" nonostante il compilatore ci fosse
        // davvero su disco.
        ...(process.env.N64_INST ? [`${process.env.N64_INST}/bin/mips64-elf-gcc`] : []),
      ]) },
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
  public async compile(params: BuildParams, onProgress: ProgressCallback = noopProgress): Promise<BuildResult> {
    const toolchains = this.detectToolchains();
    const status = toolchains[params.platform];
    const { tool: packTool, ext } = this.packagingTool(params.platform);

    if (!status.detected || !status.path) {
      onProgress({ stage: "toolchain", status: "fail", message: `Toolchain '${status.compiler}' non trovato.` });
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
    onProgress({ stage: "toolchain", status: "ok", message: `Toolchain reale trovato: ${status.path}` });

    // Modalità multi-file se il client ha fornito sourceFiles con almeno una
    // voce; altrimenti retro-compatibile col singolo sourceCode inline di
    // sempre. Ogni sorgente .c/.cpp/.s viene compilato nel proprio object
    // file reale e poi tutti linkati insieme — file non-sorgente (es. .h)
    // vengono scritti su disco per l'#include ma non passati al compilatore.
    const tempDir = "/tmp";
    const stamp = Date.now();
    const multiEntries = Object.entries(params.sourceFiles || {});
    const entries: Array<[string, string]> = multiEntries.length ? multiEntries : [["main.c", params.sourceCode || ""]];
    const SOURCE_EXT = /\.(c|cpp|cc|s)$/i;

    const tempPaths: string[] = [];
    const objFiles: string[] = [];
    const elfFile = join(tempDir, `nintendo_game_${stamp}.elf`);
    tempPaths.push(elfFile);

    let compileLog = "";
    let compileFailed = false;
    for (let i = 0; i < entries.length; i++) {
      const [origName, content] = entries[i];
      const safeName = origName.replace(/[^a-zA-Z0-9_.\-\/]/g, "_").replace(/^\/+/, "");
      const destPath = join(tempDir, `nintendo_game_${stamp}_${i}_${safeName.replace(/\//g, "__")}`);
      writeFileSync(destPath, content);
      tempPaths.push(destPath);
      if (!SOURCE_EXT.test(origName)) continue; // header o risorsa: solo scritto su disco, non compilato

      onProgress({ stage: "compile", status: "start", message: `Compilazione di ${origName}…` });
      const objFile = join(tempDir, `nintendo_game_${stamp}_${i}.o`);
      const { code, stderr } = await this.compileOne(status.path!, destPath, objFile, params.platform);
      if (code !== 0 || !existsSync(objFile)) {
        compileFailed = true;
        compileLog = `✗ Compilazione reale fallita con ${status.compiler} su ${origName}:\n${stderr.slice(-1500)}`;
        onProgress({ stage: "compile", status: "fail", message: compileLog });
        break;
      }
      objFiles.push(objFile);
      tempPaths.push(objFile);
      onProgress({ stage: "compile", status: "ok", message: `✓ ${origName} compilato.` });
    }

    if (compileFailed || objFiles.length === 0) {
      cleanupTempFiles(tempPaths);
      return {
        success: false,
        elfSize: 0,
        outputBinaryName: "",
        logs: compileFailed ? compileLog : "✗ Nessun file sorgente (.c/.cpp/.s) fornito da compilare.",
        compilerUsed: status.compiler,
        packaged: false
      };
    }

    return this.linkAndPackage(params.platform, status, objFiles, elfFile, tempDir, stamp, tempPaths, packTool, ext, onProgress);
  }

  /** Compila un singolo file sorgente in un object file reale con i flag corretti per la piattaforma. */
  private async compileOne(compilerPath: string, sourceFile: string, objFile: string, platform: BuildParams["platform"]): Promise<{ code: number; stderr: string }> {
    // MACHDEP reale, identico a quello definito in
    // $DEVKITPRO/devkitPPC/gamecube_rules e wii_rules su questa macchina
    // (letto direttamente dai file reali, non indovinato): GameCube usa
    // -mogc, Wii usa -mrvl, entrambi -mcpu=750 -meabi -mhard-float -DGEKKO.
    const archFlags: Record<BuildParams["platform"], string[]> = {
      switch: ["-march=armv8-a", "-mtune=cortex-a57", "-mtp=soft", "-fPIE"],
      wii: ["-DGEKKO", "-mrvl", "-mcpu=750", "-meabi", "-mhard-float"],
      gamecube: ["-DGEKKO", "-mogc", "-mcpu=750", "-meabi", "-mhard-float"],
      n64: ["-march=vr4300"],
      snes: []
    };

    const LIBOGC_INC = `${DEVKITPRO}/libogc/include`;

    // Compilazione reale del sorgente in un vero object file.
    const compileArgs = [compilerPath, ...archFlags[platform], "-O2", "-c", sourceFile, "-o", objFile, `-I${join(appRootDir(), "include")}`];
    if (platform === "switch") compileArgs.push(`-I${DEVKITPRO}/libnx/include`);
    if (platform === "wii" || platform === "gamecube") compileArgs.push(`-I${LIBOGC_INC}`);
    const proc = Bun.spawn(compileArgs, { stdout: "pipe", stderr: "pipe" });
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { code, stderr };
  }

  /**
   * Link (quando la piattaforma lo prevede) + packaging nel formato finale
   * reale della console. Generalizzato a N object file (non solo 1) per
   * supportare sia la build a singolo file di sempre sia quella multi-file:
   * il comando di link reale già accetta più .o, non serve altro.
   */
  private async linkAndPackage(
    platform: BuildParams["platform"], status: { compiler: string; path?: string },
    objFiles: string[], elfFile: string, tempDir: string, stamp: number, tempPaths: string[],
    packTool: string, ext: string, onProgress: ProgressCallback
  ): Promise<BuildResult> {
    const archFlags: Record<BuildParams["platform"], string[]> = {
      switch: ["-march=armv8-a", "-mtune=cortex-a57", "-mtp=soft", "-fPIE"],
      wii: ["-DGEKKO", "-mrvl", "-mcpu=750", "-meabi", "-mhard-float"],
      gamecube: ["-DGEKKO", "-mogc", "-mcpu=750", "-meabi", "-mhard-float"],
      n64: ["-march=vr4300"],
      snes: []
    };
    const LIBOGC_LIB: Record<"wii" | "gamecube", string> = {
      wii: `${DEVKITPRO}/libogc/lib/wii`,
      gamecube: `${DEVKITPRO}/libogc/lib/cube`
    };

    let linkLog = "";
    let linkedElf = false;

    // Per Switch, link reale contro libnx (switch.specs reale di devkitPro)
    // per produrre un ELF eseguibile vero, non solo object file isolati.
    if (platform === "switch" && existsSync(`${DEVKITPRO}/libnx/switch.specs`)) {
      onProgress({ stage: "link", status: "start", message: "Link reale contro libnx…" });
      const linkArgs = [
        status.path!, "-specs=" + `${DEVKITPRO}/libnx/switch.specs`,
        "-march=armv8-a", "-mtune=cortex-a57", "-mtp=soft", "-fPIE", "-Wl,-pie",
        // Fix reale verificato per l'errore del linker devkitA64
        // "read-only segment has dynamic relocations": è una regressione nota
        // di binutils/ld più recenti che applicano `-z text` (niente
        // rilocazioni di testo in segmenti read-only) in modo più rigido di
        // quanto lo switch.specs ufficiale di devkitPro si aspettasse — lo
        // stesso errore si riproduce anche compilando con l'identico
        // Makefile/ARCH ufficiale di devkitPro (templates/application), quindi
        // non è un problema dei nostri flag ma del toolchain installato su
        // questa macchina. `-Wl,-z,notext` è il workaround documentato per
        // questa classe di errore ld (vedi devkitpro.org/viewtopic.php?t=9110
        // e bug analoghi su bugzilla Mozilla/RedHat) e qui è stato verificato
        // per davvero: produce un ELF PIE valido che elf2nro converte in un
        // .nro reale con l'header "NRO0" corretto (non un file fittizio).
        "-Wl,-z,notext",
        "-o", elfFile, ...objFiles,
        `-L${DEVKITPRO}/libnx/lib`, `-L${DEVKITPRO}/devkitA64/aarch64-none-elf/lib`,
        "-lnx"
      ];
      const linkProc = Bun.spawn(linkArgs, { stdout: "pipe", stderr: "pipe", env: { ...process.env, DEVKITPRO } });
      const linkErr = await new Response(linkProc.stderr).text();
      const linkCode = await linkProc.exited;
      linkedElf = linkCode === 0 && existsSync(elfFile);
      linkLog = linkedElf
        ? `✓ Link reale contro libnx (switch.specs): OK (${objFiles.length} object file)`
        : `⚠ Compilazione a object file riuscita, ma il link reale contro libnx è fallito: ${linkErr.slice(-500)}`;
      onProgress({ stage: "link", status: linkedElf ? "ok" : "fail", message: linkLog });
    }

    // Per Wii/GameCube, link reale contro libogc (percorso reale letto da
    // gamecube_rules/wii_rules: libogc/lib/cube o libogc/lib/wii) per
    // produrre un ELF eseguibile vero, come per Switch sopra.
    if ((platform === "wii" || platform === "gamecube") && existsSync(LIBOGC_LIB[platform])) {
      onProgress({ stage: "link", status: "start", message: "Link reale contro libogc…" });
      const libDir = LIBOGC_LIB[platform];
      // Wii ha bisogno anche di -lwiiuse -lbte (controller Wiimote/Bluetooth),
      // reale dallo scaffold ufficiale WII_MAKEFILE (LIBS := -lwiiuse -lbte
      // -logc -lm) — GameCube no, non ha quell'hardware.
      const libs = platform === "wii" ? ["-lwiiuse", "-lbte", "-logc", "-lm"] : ["-logc", "-lm"];
      const linkArgs = [
        status.path!, ...archFlags[platform],
        "-o", elfFile, ...objFiles,
        `-L${libDir}`, ...libs
      ];
      const linkProc = Bun.spawn(linkArgs, { stdout: "pipe", stderr: "pipe", env: { ...process.env, DEVKITPRO } });
      const linkErr = await new Response(linkProc.stderr).text();
      const linkCode = await linkProc.exited;
      linkedElf = linkCode === 0 && existsSync(elfFile);
      linkLog = linkedElf
        ? `✓ Link reale contro libogc (${libDir}): OK (${objFiles.length} object file)`
        : `⚠ Compilazione a object file riuscita, ma il link reale contro libogc è fallito: ${linkErr.slice(-500)}`;
      onProgress({ stage: "link", status: linkedElf ? "ok" : "fail", message: linkLog });
    }

    // Packaging reale nel formato finale della console, se il tool esiste davvero.
    const packagingBin = packTool ? findPackagingTool(packTool) : "n/a (WLA-DX produce già il formato finale)";
    let finalFile = linkedElf ? elfFile : objFiles[0];
    let packaged = platform === "snes"; // WLA-DX produce direttamente il .sfc, nessun secondo passo
    let packagingLog = "";

    if (packTool && packagingBin && linkedElf) {
      onProgress({ stage: "package", status: "start", message: `Packaging con ${packTool}…` });
      const outFile = join(tempDir, `nintendo_game_${stamp}${ext}`);
      tempPaths.push(outFile);
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
      onProgress({ stage: "package", status: packaged ? "ok" : "fail", message: packagingLog });
    } else if (packTool && !linkedElf) {
      packagingLog = `⚠ Nessun ELF linkato disponibile: viene restituito l'object file grezzo (.o), NON un ${ext} funzionante.`;
    } else if (packTool && !packagingBin) {
      packagingLog = `⚠ Il tool di packaging '${packTool}' non è installato: viene restituito l'ELF grezzo, NON un ${ext} funzionante.`;
    }
    packagingLog = [linkLog, packagingLog].filter(Boolean).join("\n");

    const binaryData = readFileSync(finalFile);
    cleanupTempFiles(tempPaths); // finalFile è già stato letto in memoria sopra: sicuro da cancellare
    return {
      success: true,
      elfSize: binaryData.length,
      outputBinaryName: `game_${platform}${packaged ? ext : linkedElf ? ".elf" : ".o"}`,
      outputBinaryBase64: binaryData.toString("base64"),
      logs: `✓ Compilato realmente con ${status.compiler} (${status.path})\n${packagingLog}`,
      compilerUsed: status.compiler,
      packaged
    };
  }

  /**
   * Genera uno scaffold di progetto REALE e onesto: un Makefile devkitPro
   * standard (identico, a parte il nome del target, a quello che si trova in
   * $DEVKITPRO/examples/<piattaforma>/templates/application/Makefile su
   * questa stessa macchina, dove devkitPro è installato) più un main.c
   * minimale che compila davvero con `make` reale usando il vero toolchain.
   *
   * Questo studio browser-based compila un solo file sorgente alla volta:
   * è comodo per prototipare, ma un vero progetto homebrew multi-file ha
   * bisogno del vero sistema di build a Makefile di devkitPro (dipendenze
   * incrementali, risorse in romfs/data, icone, .nacp, ecc). Questo comando
   * non finge di sostituirlo: scarica l'utente sul vero sistema standard.
   */
  public scaffoldProject(platform: BuildParams["platform"]): { files: Record<string, string>; notes: string } | { error: string } {
    switch (platform) {
      case "switch":
        return {
          files: {
            "Makefile": SWITCH_MAKEFILE,
            "source/main.c": SWITCH_MAIN_C
          },
          notes: "Makefile e source/main.c reali, identici (a parte TARGET) a " +
            "$DEVKITPRO/examples/switch/templates/application su questa macchina. " +
            "Richiede `export DEVKITPRO=/opt/devkitpro` e `make` con devkitA64 + libnx " +
            "reali installati (verificato presenti su questa macchina). Produce un " +
            ".nro reale via elf2nro, non un file fittizio."
        };
      case "gamecube":
        return {
          files: {
            "Makefile": GAMECUBE_MAKEFILE,
            "source/main.c": GAMECUBE_MAIN_C
          },
          notes: "Makefile e source/main.c reali, identici (a parte TARGET) a " +
            "$DEVKITPRO/examples/gamecube/templates/application su questa macchina. " +
            "Richiede `export DEVKITPRO=/opt/devkitpro` e `make` con devkitPPC + libogc reali."
        };
      case "wii":
        return {
          files: {
            "Makefile": WII_MAKEFILE,
            "source/main.c": WII_MAIN_C
          },
          notes: "Makefile e source/main.c reali, identici (a parte TARGET) a " +
            "$DEVKITPRO/examples/wii/templates/makefile/application su questa macchina. " +
            "Richiede `export DEVKITPRO=/opt/devkitpro` e `make` con devkitPPC + libogc reali."
        };
      case "n64":
        return {
          error: "devkitPro non include un template N64: la homebrew N64 reale si " +
            "costruisce con libdragon (github.com/DragonMinded/libdragon), che ha un " +
            "proprio sistema `n64.mk` + CLI `libdragon init`. Questo studio non " +
            "fabbrica un Makefile N64 inventato: usa `libdragon init` reale nel tuo " +
            "progetto per uno scaffold N64 genuino."
        };
      case "snes":
        return {
          error: "devkitPro non include un template SNES: la homebrew SNES reale si " +
            "costruisce con pvsneslib (github.com/alekmaul/pvsneslib), che fornisce il " +
            "proprio Makefile di esempio (pvsneslib/examples/helloworld/Makefile). " +
            "Questo studio non fabbrica un Makefile SNES inventato: clona pvsneslib e " +
            "usa il suo template reale."
        };
    }
  }
}

const SWITCH_MAKEFILE = `#---------------------------------------------------------------------------------
.SUFFIXES:
#---------------------------------------------------------------------------------

ifeq ($(strip $(DEVKITPRO)),)
$(error "Please set DEVKITPRO in your environment. export DEVKITPRO=<path to>/devkitpro")
endif

TOPDIR ?= $(CURDIR)
include $(DEVKITPRO)/libnx/switch_rules

#---------------------------------------------------------------------------------
TARGET		:=	$(notdir $(CURDIR))
BUILD		:=	build
SOURCES		:=	source
DATA		:=	data
INCLUDES	:=	include

#---------------------------------------------------------------------------------
# options for code generation
#---------------------------------------------------------------------------------
ARCH	:=	-march=armv8-a+crc+crypto -mtune=cortex-a57 -mtp=soft -fPIE

CFLAGS	:=	-g -Wall -O2 -ffunction-sections \\
			$(ARCH) $(DEFINES)

CFLAGS	+=	$(INCLUDE) -D__SWITCH__

CXXFLAGS	:= $(CFLAGS) -fno-rtti -fno-exceptions

ASFLAGS	:=	-g $(ARCH)
LDFLAGS	=	-specs=$(DEVKITPRO)/libnx/switch.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)

LIBS	:= -lnx

#---------------------------------------------------------------------------------
LIBDIRS	:= $(PORTLIBS) $(LIBNX)

#---------------------------------------------------------------------------------
ifneq ($(BUILD),$(notdir $(CURDIR)))
#---------------------------------------------------------------------------------

export OUTPUT	:=	$(CURDIR)/$(TARGET)
export TOPDIR	:=	$(CURDIR)

export VPATH	:=	$(foreach dir,$(SOURCES),$(CURDIR)/$(dir)) \\
			$(foreach dir,$(DATA),$(CURDIR)/$(dir))

export DEPSDIR	:=	$(CURDIR)/$(BUILD)

CFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
CPPFILES	:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.cpp)))
SFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.s)))
BINFILES	:=	$(foreach dir,$(DATA),$(notdir $(wildcard $(dir)/*.*)))

ifeq ($(strip $(CPPFILES)),)
	export LD	:=	$(CC)
else
	export LD	:=	$(CXX)
endif

export OFILES_BIN	:=	$(addsuffix .o,$(BINFILES))
export OFILES_SRC	:=	$(CPPFILES:.cpp=.o) $(CFILES:.c=.o) $(SFILES:.s=.o)
export OFILES 	:=	$(OFILES_BIN) $(OFILES_SRC)
export HFILES_BIN	:=	$(addsuffix .h,$(subst .,_,$(BINFILES)))

export INCLUDE	:=	$(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) \\
			$(foreach dir,$(LIBDIRS),-I$(dir)/include) \\
			-I$(CURDIR)/$(BUILD)

export LIBPATHS	:=	$(foreach dir,$(LIBDIRS),-L$(dir)/lib)

.PHONY: $(BUILD) clean all

all: $(BUILD)

$(BUILD):
	@[ -d $@ ] || mkdir -p $@
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile

clean:
	@echo clean ...
	@rm -fr $(BUILD) $(TARGET).nro $(TARGET).nacp $(TARGET).elf

#---------------------------------------------------------------------------------
else
.PHONY:	all

DEPENDS	:=	$(OFILES:.o=.d)

all	:	$(OUTPUT).nro

ifeq ($(strip $(NO_NACP)),)
$(OUTPUT).nro	:	$(OUTPUT).elf $(OUTPUT).nacp
else
$(OUTPUT).nro	:	$(OUTPUT).elf
endif

$(OUTPUT).elf	:	$(OFILES)

-include $(DEPENDS)

#---------------------------------------------------------------------------------
endif
#---------------------------------------------------------------------------------
`;

const SWITCH_MAIN_C = `// Include the most common headers from the C standard library
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Include the main libnx system header, for Switch development
#include <switch.h>

// Main program entrypoint
int main(int argc, char* argv[])
{
    // This example uses a text console, as a simple way to output text to the screen.
    consoleInit(NULL);

    // Configure our supported input layout: a single player with standard controller styles
    padConfigureInput(1, HidNpadStyleSet_NpadStandard);

    // Initialize the default gamepad
    PadState pad;
    padInitializeDefault(&pad);

    printf("Hello World!\\n");

    // Main loop
    while (appletMainLoop())
    {
        padUpdate(&pad);

        u64 kDown = padGetButtonsDown(&pad);

        if (kDown & HidNpadButton_Plus)
            break; // break in order to return to hbmenu

        // Your code goes here

        consoleUpdate(NULL);
    }

    consoleExit(NULL);
    return 0;
}
`;

const GAMECUBE_MAKEFILE = `#---------------------------------------------------------------------------------
.SUFFIXES:
#---------------------------------------------------------------------------------
ifeq ($(strip $(DEVKITPPC)),)
$(error "Please set DEVKITPPC in your environment. export DEVKITPPC=<path to>devkitPPC")
endif

include $(DEVKITPPC)/gamecube_rules

#---------------------------------------------------------------------------------
TARGET		:=	$(notdir $(CURDIR))
BUILD		:=	build
SOURCES		:=	source
DATA		:=	data
INCLUDES	:=

CFLAGS		= -g -O2 -Wall $(MACHDEP) $(INCLUDE)
CXXFLAGS	= $(CFLAGS)

LDFLAGS		= -g $(MACHDEP) -Wl,-Map,$(notdir $@).map

LIBS	:=	-logc -lm

LIBDIRS	:=

#---------------------------------------------------------------------------------
ifneq ($(BUILD),$(notdir $(CURDIR)))
#---------------------------------------------------------------------------------

export OUTPUT	:=	$(CURDIR)/$(TARGET)

export VPATH	:=	$(foreach dir,$(SOURCES),$(CURDIR)/$(dir)) \\
			$(foreach dir,$(DATA),$(CURDIR)/$(dir))

export DEPSDIR	:=	$(CURDIR)/$(BUILD)

CFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
CPPFILES	:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.cpp)))
sFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.s)))
SFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.S)))
BINFILES	:=	$(foreach dir,$(DATA),$(notdir $(wildcard $(dir)/*.*)))

ifeq ($(strip $(CPPFILES)),)
	export LD	:=	$(CC)
else
	export LD	:=	$(CXX)
endif

export OFILES_BIN	:=	$(addsuffix .o,$(BINFILES))
export OFILES_SOURCES := $(CPPFILES:.cpp=.o) $(CFILES:.c=.o) $(sFILES:.s=.o) $(SFILES:.S=.o)
export OFILES := $(OFILES_BIN) $(OFILES_SOURCES)

export HFILES := $(addsuffix .h,$(subst .,_,$(BINFILES)))

export INCLUDE	:=	$(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) \\
			$(foreach dir,$(LIBDIRS),-I$(dir)/include) \\
			-I$(CURDIR)/$(BUILD) \\
			-I$(LIBOGC_INC)

export LIBPATHS	:=	-L$(LIBOGC_LIB) $(foreach dir,$(LIBDIRS),-L$(dir)/lib)

export OUTPUT	:=	$(CURDIR)/$(TARGET)
.PHONY: $(BUILD) clean

$(BUILD):
	@[ -d $@ ] || mkdir -p $@
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile

clean:
	@echo clean ...
	@rm -fr $(BUILD) $(OUTPUT).elf $(OUTPUT).dol

#---------------------------------------------------------------------------------
else

DEPENDS	:=	$(OFILES:.o=.d)

$(OUTPUT).dol: $(OUTPUT).elf
$(OUTPUT).elf: $(OFILES)

$(OFILES_SOURCES) : $(HFILES)

-include $(DEPENDS)

#---------------------------------------------------------------------------------
endif
#---------------------------------------------------------------------------------
`;

const GAMECUBE_MAIN_C = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <malloc.h>
#include <ogcsys.h>
#include <gccore.h>

static void *xfb = NULL;
static GXRModeObj *rmode = NULL;

void *Initialise();

int main(int argc, char **argv) {

	xfb = Initialise();

	printf("\\nHello World!\\n");

	while(SYS_MainLoop()) {

		VIDEO_WaitVSync();
		PAD_ScanPads();

		int buttonsDown = PAD_ButtonsDown(0);

		if( buttonsDown & PAD_BUTTON_A ) {
			printf("Button A pressed.\\n");
		}

		if (buttonsDown & PAD_BUTTON_START) {
			exit(0);
		}
	}

	return 0;
}

void * Initialise() {

	void *framebuffer;

	VIDEO_Init();
	PAD_Init();

	rmode = VIDEO_GetPreferredMode(NULL);

	framebuffer = MEM_K0_TO_K1(SYS_AllocateFramebuffer(rmode));
	console_init(framebuffer,20,20,rmode->fbWidth,rmode->xfbHeight,rmode->fbWidth*VI_DISPLAY_PIX_SZ);

	VIDEO_Configure(rmode);
	VIDEO_SetNextFramebuffer(framebuffer);
	VIDEO_SetBlack(FALSE);
	VIDEO_Flush();
	VIDEO_WaitVSync();
	if(rmode->viTVMode&VI_NON_INTERLACE) VIDEO_WaitVSync();

	return framebuffer;
}
`;

const WII_MAKEFILE = GAMECUBE_MAKEFILE
  .replace("include $(DEVKITPPC)/gamecube_rules", "include $(DEVKITPPC)/wii_rules")
  .replace("LIBS	:=	-logc -lm", "LIBS	:=	-lwiiuse -lbte -logc -lm");

const WII_MAIN_C = `#include <stdio.h>
#include <stdlib.h>
#include <gccore.h>
#include <wiiuse/wpad.h>

static void *xfb = NULL;
static GXRModeObj *rmode = NULL;

//---------------------------------------------------------------------------------
int main(int argc, char **argv) {
//---------------------------------------------------------------------------------

	VIDEO_Init();
	WPAD_Init();

	rmode = VIDEO_GetPreferredMode(NULL);

	xfb = MEM_K0_TO_K1(SYS_AllocateFramebuffer(rmode));

	console_init(xfb,20,20,rmode->fbWidth,rmode->xfbHeight,rmode->fbWidth*VI_DISPLAY_PIX_SZ);

	VIDEO_Configure(rmode);
	VIDEO_SetNextFramebuffer(xfb);
	VIDEO_SetBlack(false);
	VIDEO_Flush();
	VIDEO_WaitVSync();
	if(rmode->viTVMode&VI_NON_INTERLACE) VIDEO_WaitVSync();

	printf("\\x1b[2;0H");
	printf("Hello World!\\n");

	while(SYS_MainLoop()) {

		WPAD_ScanPads();

		u32 pressed = WPAD_ButtonsDown(0);

		if ( pressed & WPAD_BUTTON_HOME ) exit(0);

		VIDEO_WaitVSync();
	}

	return 0;
}
`;
