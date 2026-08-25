# 🎮 Nintendo Universal SDK Studio

Studio web locale per compilare codice C contro l'astrazione hardware
`include/nintendo_hal.h`, che avvolge gli SDK homebrew **reali e open-source**
per console Nintendo: [libnx](https://github.com/switchbrew/libnx) (Switch),
[libogc](https://github.com/devkitPro/libogc) (Wii/GameCube),
[libdragon](https://github.com/DragonMinded/libdragon) (N64) e
[pvsneslib](https://github.com/alekmaul/pvsneslib) (SNES), tutti installabili
gratuitamente via [devkitPro](https://github.com/devkitPro/pacman).

## Nota onesta sullo stato v1.1

La v1.0 fingeva sempre un compile "riuscito": se il toolchain reale non era
installato, generava un file di 16KB quasi vuoto con solo un header magico,
accompagnato da log fabbricati ("✓ AST analysis: OK", "✓ Linking... OK") che
non corrispondevano a nessuna vera compilazione. Corretto in v1.1:

- **Rilevamento reale del toolchain**: controlla sia il `PATH` sia i percorsi
  standard di installazione `$DEVKITPRO` — mai un `detected: true` finto.
- **Compilazione reale**: se il compilatore è presente, esegue davvero
  `gcc`/l'assembler sul sorgente fornito e restituisce l'object file/ELF
  realmente prodotto (verificato su questa macchina: `aarch64-none-elf-gcc`
  di devkitA64 compila realmente il file sorgente in un ELF object valido).
- **Nessun fallback fittizio**: se il toolchain manca, l'API risponde
  `success: false` con istruzioni reali di installazione (comandi
  `dkp-pacman` veri), mai un binario o un log inventato.
- **Packaging onesto**: per Switch il codice tenta anche il link reale
  contro `libnx` (`switch.specs` reale di devkitPro) e il packaging con
  `elf2nro` reale. Su questa macchina il link fallisce con un errore PIE/
  relocation del linker devkitA64 non ancora risolto (`read-only segment
  has dynamic relocations`) — il campo `packaged: false` lo segnala
  esplicitamente e viene restituito l'object file grezzo, mai un `.nro`
  fittizio spacciato per funzionante.

## Cosa funziona oggi, verificato

| Piattaforma | Compilazione reale | Link reale | Packaging finale reale |
|---|---|---|---|
| Switch (devkitA64) | ✓ (verificato: devkitPro installato) | ⚠ fallisce (PIE relocation, in lavorazione) | ✗ |
| Wii/GameCube (devkitPPC) | dipende da installazione locale | non ancora automatizzato | ✗ |
| N64 | dipende da installazione locale | non ancora automatizzato | ✗ |
| SNES (WLA-DX) | dipende da installazione locale | — | — |

## Avvio

```bash
bun install
bun start
```

Apri `http://localhost:3014`. Se `devkitPro` non è installato, ogni
tentativo di compilazione risponde onestamente con le istruzioni di
installazione reali invece di un falso successo.

## Licenza
MIT.
