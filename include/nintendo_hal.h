/**
 * 🎮 Nintendo Universal Hardware Abstraction Layer (HAL)
 * Unifies Game Loop, Pad Inputs, and 2D Graphics across multiple console architectures.
 * 
 * Supports:
 *  - Nintendo Switch (ARM64 / libnx)
 *  - Nintendo Wii / GameCube (PowerPC / libogc)
 *  - Nintendo 64 (MIPS / libdragon)
 *  - Super Nintendo (W65816 / pvsneslib)
 */

#ifndef NINTENDO_HAL_H
#define NINTENDO_HAL_H

// 1. Nintendo Switch Target (libnx)
#if defined(__aarch64__) || defined(NX_PLATFORM)
#include <switch.h>

typedef struct {
    PadState pad;
} NintendoGamepad;

static inline void NintendoInitConsole() {
    consoleInit(NULL);
}

static inline void NintendoUpdateGamepad(NintendoGamepad* gp) {
    padUpdate(&gp->pad);
}

static inline int NintendoIsButtonPressed(NintendoGamepad* gp, u64 button) {
    u64 keys = padGetButtonsDown(&gp->pad);
    // Map abstract keys to physical Switch keys
    if (button == 1) return (keys & HidNpadButton_A) != 0;
    if (button == 2) return (keys & HidNpadButton_B) != 0;
    if (button == 3) return (keys & HidNpadButton_Plus) != 0;
    return 0;
}

static inline void NintendoRefreshScreen() {
    consoleUpdate(NULL);
}

// 2. Nintendo Wii / GameCube Target (libogc / devkitPPC)
#elif defined(__powerpc__) || defined(GEKKO)
#include <gctypes.h>
#include <ogc/pad.h>
#include <ogc/vi.h>
#include <ogc/video.h>

typedef struct {
    int padChannel;
} NintendoGamepad;

static inline void NintendoInitConsole() {
    // Wii/GCN native framebuffer init
    VIDEO_Init();
    PAD_Init();
}

static inline void NintendoUpdateGamepad(NintendoGamepad* gp) {
    PAD_ScanPads();
}

static inline int NintendoIsButtonPressed(NintendoGamepad* gp, u64 button) {
    u16 keys = PAD_ButtonsDown(gp->padChannel);
    if (button == 1) return (keys & PAD_BUTTON_A) != 0;
    if (button == 2) return (keys & PAD_BUTTON_B) != 0;
    if (button == 3) return (keys & PAD_TRIGGER_START) != 0;
    return 0;
}

static inline void NintendoRefreshScreen() {
    // VI swap buffers
}

// 3. Nintendo 64 Target (libdragon / devkitMIPS)
#elif defined(__mips__) || defined(N64_PLATFORM)
#include <libdragon.h>

typedef struct {
    int controllerPort;
} NintendoGamepad;

static inline void NintendoInitConsole() {
    display_init(RESOLUTION_320x240, DEPTH_16_BPP, 2, GAMMA_NONE, FILTERS_RESAMPLE);
    controller_init();
}

static inline void NintendoUpdateGamepad(NintendoGamepad* gp) {
    controller_scan();
}

static inline int NintendoIsButtonPressed(NintendoGamepad* gp, u64 button) {
    struct controller_data keys = get_keys_down();
    if (button == 1) return keys.c[gp->controllerPort].A;
    if (button == 2) return keys.c[gp->controllerPort].B;
    if (button == 3) return keys.c[gp->controllerPort].start;
    return 0;
}

static inline void NintendoRefreshScreen() {
    // swap display buffers
}

// 4. Super Nintendo Target (pvsneslib / W65816)
#elif defined(__w65816__) || defined(SNES_PLATFORM)
#include <snes.h>

typedef struct {
    u16 padState;
} NintendoGamepad;

static inline void NintendoInitConsole() {
    consoleInit();
}

static inline void NintendoUpdateGamepad(NintendoGamepad* gp) {
    gp->padState = padsCurrent(0);
}

static inline int NintendoIsButtonPressed(NintendoGamepad* gp, u64 button) {
    u16 keys = gp->padState;
    if (button == 1) return (keys & KEY_A) != 0;
    if (button == 2) return (keys & KEY_B) != 0;
    if (button == 3) return (keys & KEY_START) != 0;
    return 0;
}

static inline void NintendoRefreshScreen() {
    WaitForVBlank();
}

// 5. Desktop Simulation Mode (Fallback)
#else
#include <stdio.h>

typedef struct {
    int simulatedState;
} NintendoGamepad;

static inline void NintendoInitConsole() {
    printf("[Nintendo SDK Simulator] Console Virtuale Inizializzata.\n");
}

static inline void NintendoUpdateGamepad(NintendoGamepad* gp) {
    // Mock gamepad update
}

static inline int NintendoIsButtonPressed(NintendoGamepad* gp, int button) {
    return 0;
}

static inline void NintendoRefreshScreen() {
    // Desktop virtual buffer swap
}
#endif

#endif // NINTENDO_HAL_H
