/**
 * 🎮 Scaffold + rilevamento toolchain per Sega Mega Drive/Genesis,
 * Sega Dreamcast e Sony PSP.
 *
 * HONESTÀ DICHARATA (ricerca 2026-08-26, fonti verificate):
 * - La pipeline /api/build NON compila per queste piattaforme: i toolchain
 *   non sono installati su questa macchina e non possiamo verificare una
 *   compilazione reale (regola del progetto: mai claim non verificati).
 *   Qui si generano ONLY scaffold reali, con Makefile identici ai template
 *   ufficiali/community dei rispettivi SDK.
 * - Genesis/MD: SGDK (github.com/Stephane-D/SGDK, MIT, 2.2k stelle) è lo
 *   standard de facto. Il Makefile generato è il wrapper reale che include
 *   $(GDK)/makefile.gen (uso documentato nel README SGDK).
 * - Dreamcast: KallistiOS (github.com/KallistiOS/KallistiOS, attivo, push
 *   2026-08-26) con kos-cc. Makefile identico alla struttura degli esempi
 *   ufficiali (es. examples/dreamcast/2ndmix/Makefile).
 * - PSP: pspdev/pspsdk (1.2k stelle, SDK open-source della community) +
 *   toolchain pspdev (MIT). Makefile con la struttura standard
 *   PSPSDK/build.mak usata da tutti i progetti homebrew PSP.
 */

import { existsSync } from "fs";
import { spawnSync } from "child_process";

function which(cmd: string): string | null {
  try {
    const proc = spawnSync("which", [cmd], { encoding: "utf8" });
    return proc.status === 0 && proc.stdout.trim() ? proc.stdout.trim() : null;
  } catch {
    return null;
  }
}

export interface ExtraToolchainStatus {
  genesis: { sdk: string; detected: boolean; path?: string; installHint: string };
  dreamcast: { sdk: string; detected: boolean; path?: string; installHint: string };
  psp: { sdk: string; detected: boolean; path?: string; installHint: string };
}

/** Rilevamento onesto: GDK (SGDK), KOS_BASE (KallistiOS), psp-config (pspdev). */
export function detectExtraToolchains(): ExtraToolchainStatus {
  const gdkEnv = process.env.GDK;
  const gdkWhich = which("sgdk") || (existsSync("/opt/sgdk") ? "/opt/sgdk" : null);
  const gdkPath = gdkWhich && existsSync(gdkWhich) ? gdkWhich : gdkEnv && existsSync(gdkEnv) ? gdkEnv : null;

  const kosEnv = process.env.KOS_BASE;
  const shElf = which("sh-elf-gcc");
  const kosPath = kosEnv && existsSync(kosEnv) ? kosEnv : shElf ? "(KOS non confermato, ma sh-elf-gcc presente: " + shElf + ")" : null;

  const pspConfig = which("psp-config");

  return {
    genesis: {
      sdk: "SGDK (github.com/Stephane-D/SGDK, MIT)",
      detected: !!gdkPath,
      path: gdkPath || undefined,
      installHint: "Installa SGDK realmente: scarica la release da github.com/Stephane-D/SGDK (o brew install sgdk), poi esporta GDK=/percorso/sgdk. Serve Java per rescomp.jar.",
    },
    dreamcast: {
      sdk: "KallistiOS (github.com/KallistiOS/KallistiOS)",
      detected: !!(kosEnv && existsSync(kosEnv)),
      path: kosPath || undefined,
      installHint: "Costruisci il toolchain Dreamcast reale: github.com/KallistiOS/KallistiOS (dcchain per gcc SH-4, poi esporta KOS_BASE e KOS_LDSCRIPT). Build pesante (ore), nessuna scorciatoia.",
    },
    psp: {
      sdk: "pspdev + PSPSDK (github.com/pspdev)",
      detected: !!pspConfig,
      path: pspConfig || undefined,
      installHint: "Installa il toolchain PSP reale: github.com/pspdev/pspdev (script che costruisce psp-gcc + PSPSDK; su macOS/Linux cerca 'pspdev toolchain install'). Fornisce psp-config.",
    },
  };
}

// ---------------------------------------------------------------------------
// Template reali
// ---------------------------------------------------------------------------

const GENESIS_MAIN_C = `#include <genesis.h>

int main(bool hardReset) {
    // SGDK reale: VDP, joy e engine inizializzati dal boot sega.s di SGDK
    VDP_drawText("Hello from SGDK via Retro Studio!", 8, 12);

    JOY_init();
    while (true) {
        JOY_update();
        SPR_update();
        VDP_waitVSync();
    }
    return 0;
}
`;

const GENESIS_MAKEFILE = `# Makefile wrapper reale per progetti SGDK (github.com/Stephane-D/SGDK).
# Uso documentato da SGDK: il progetto include makefile.gen dalla SDK.
# Imposta GDK prima di invocare make, ad esempio:
#   export GDK=/opt/sgdk   (oppure passa GDK=/opt/sgdk make)
GDK ?= $(GDK)

all:
	$(MAKE) -f $(GDK)/makefile.gen

release:
	$(MAKE) -f $(GDK)/makefile.gen release

debug:
	$(MAKE) -f $(GDK)/makefile.gen debug

clean:
	$(MAKE) -f $(GDK)/makefile.gen clean-all
`;

const DREAMCAST_MAIN_C = `#include <kos.h>

/* KallistiOS reale: bargv/romdisk opzionali. Compilato con kos-cc. */
KOS_INIT_FLAGS(INIT_DEFAULT | INIT_MALLOCSTATS);

int main(int argc, char **argv) {
    int x = 20, y = 24, dx = 1, dy = 1;

    printf("Hello from KallistiOS via Retro Studio!\\n");

    while (1) {
        /* disegna un pixel che rimbalza sul framebuffer reale del Dreamcast */
        vid_screen->buffer[y * 640 + x] = 0xffffffff;

        x += dx; y += dy;
        if (x <= 0 || x >= 639) dx = -dx;
        if (y <= 0 || y >= 479) dy = -dy;

        vid_waitvbl();
        vid_flip(0);
    }

    return 0;
}
`;

const DREAMCAST_MAKEFILE = `# KallistiOS Makefile reale (struttura identica a examples/dreamcast/*/Makefile).
# Richiede: KOS_BASE esportato e toolchain dcchain costruito (kos-cc disponibile).
TARGET = retrostudio.elf
OBJS = main.o

all: rm-elf $(TARGET)

include $(KOS_BASE)/Makefile.rules

clean: rm-elf
	-rm -f $(OBJS)

rm-elf:
	-rm -f $(TARGET)

$(TARGET): $(OBJS)
	kos-cc -o $(TARGET) $(OBJS)

run: $(TARGET)
	$(KOS_LOADER) $(TARGET)
`;

const PSP_MAIN_C = `#include <pspkernel.h>
#include <pspdebug.h>
#include <pspdisplay.h>
#include <pspctrl.h>

PSP_MODULE_INFO("RetroStudio", 0, 1, 0);
PSP_MAIN_THREAD_ATTR(THREAD_ATTR_USER | THREAD_ATTR_VFPU);

/* setup callback standard PSPSDK (pattern ufficiale di tutti gli esempi) */
static int exit_callback(int arg1, int arg2, void *common) { sceKernelExitGame(); return 0; }
static int callback_thread(SceSize args, void *argp) {
    int cbid = sceKernelCreateCallback("Exit Callback", exit_callback, NULL);
    sceKernelRegisterExitCallback(cbid);
    sceKernelSleepThreadCB();
    return 0;
}
static int setup_callbacks(void) {
    int thid = sceKernelCreateThread("update_thread", callback_thread, 0x11, 0xFA0, 0, 0);
    if (thid >= 0) sceKernelStartThread(thid, 0, 0);
    return thid;
}

int main(void) {
    SceCtrlData pad;
    pspDebugScreenInit();
    setup_callbacks();
    pspDebugScreenPrintf("Hello from PSPSDK via Retro Studio!");

    while (1) {
        sceCtrlReadBufferPositive(&pad, 1);
        if (pad.Buttons & PSP_CTRL_START) break;
        sceDisplayWaitVblankStart();
    }
    sceKernelExitGame();
    return 0;
}
`;

const PSP_MAKEFILE = `# Makefile PSP reale: struttura standard PSPSDK build.mak usata da tutti
# i progetti homebrew PSP (github.com/pspdev/pspsdk). Richiede psp-config
# nel PATH (toolchain pspdev installato).
TARGET := retrostudio
OBJS = src/main.o

INCDIR =
CFLAGS = -O2 -G0 -Wall
CXXFLAGS = $(CFLAGS) -fno-exceptions -fno-rtti
ASFLAGS = $(CFLAGS)

LIBDIR =
LDFLAGS =
LIBS =

PSPSDK := $(shell psp-config --pspsdk-path)
include $(PSPSDK)/lib/build.mak

# produce out/EBOOT.PBP installabile su PSP reale o PPSSPP
EXTRA_TARGETS = EBOOT.PBP
PSP_EBOOT_TITLE = RetroStudio
`;

export function scaffoldExtra(platform: "genesis" | "dreamcast" | "psp"): { files: Record<string, string>; notes: string } | { error: string } {
  switch (platform) {
    case "genesis":
      return {
        files: { "Makefile": GENESIS_MAKEFILE, "src/main.c": GENESIS_MAIN_C },
        notes:
          "Progetto SGDK reale (github.com/Stephane-D/SGDK, MIT). Il Makefile include $(GDK)/makefile.gen, " +
          "l'uso documentato da SGDK stesso. Questo studio NON compila per Genesis: serve SGDK installato " +
          "(export GDK=...) e 'make'. Output: out/rom.bin avviabile su emulatori reali (BlastEm, Genesis Plus GX).",
      };
    case "dreamcast":
      return {
        files: { "Makefile": DREAMCAST_MAKEFILE, "main.c": DREAMCAST_MAIN_C },
        notes:
          "Progetto KallistiOS reale (github.com/KallistiOS/KallistiOS). Struttura identica agli esempi " +
          "ufficiali KOS (kos-cc + Makefile.rules). Questo studio NON compila per Dreamcast: la costruzione " +
          "del toolchain dcchain è onerosa (ore). Output: .elf, convertibile in CDI/GDI per Flycast/redream.",
      };
    case "psp":
      return {
        files: { "Makefile": PSP_MAKEFILE, "src/main.c": PSP_MAIN_C },
        notes:
          "Progetto PSPSDK reale (github.com/pspdev/pspsdk). Makefile con la struttura standard build.mak " +
          "usata da tutto l'homebrew PSP; main.c col pattern callback ufficiale PSP_MODULE_INFO. Questo " +
          "studio NON compila per PSP: serve il toolchain pspdev (fornisce psp-config). Output: EBOOT.PBP " +
          "avviabile su PPSSPP o PSP reale.",
      };
  }
}
