/**
 * 🗺️ Parser/editor di comandi level-script (formato pubblicamente
 * documentato dalla community di reverse engineering)
 *
 * Fonte del formato: Hack64 Wiki, "Level Commands"
 * (hack64.net/wiki/doku.php?id=super_mario_64:level_commands) e il progetto
 * di decompilazione open source n64decomp/sm64 — entrambe documentazioni
 * PUBBLICHE del formato binario dei comandi, create dalla community negli
 * anni. Nessun asset o codice originale di Nintendo è incluso qui: solo
 * l'interpretazione del formato binario (offset dei campi, dimensioni),
 * lo stesso tipo di informazione che sta alla base di editor reali della
 * community (SM64 Editor, Fast64, ecc).
 *
 * Questo modulo opera su un buffer di byte fornito dal CLIENT (l'utente,
 * dal proprio segmento di livello già estratto/decompresso da una propria
 * ROM) — non scarica, non ospita e non contiene alcun dato di gioco reale.
 * Testato con sequenze di byte sintetiche costruite a mano secondo la
 * specifica pubblica, mai con dati estratti da una ROM reale.
 *
 * CORREZIONE (verifica del 2026-08-25): una prima versione di questo modulo
 * usava erroneamente l'opcode 0x27 come marcatore di fine script. La
 * tabella completa documentata mostra che 0x27 è in realtà "Painting Warp"
 * (stesso layout di Connect Warps 0x26), non un terminatore. Il vero
 * comando di terminazione è 0x02 "End Level Data" (4 byte, nessun
 * argomento). Corretto qui; il bug era autoconsistente nel test precedente
 * (encoder e decoder condividevano la stessa assunzione sbagliata) — motivo
 * per cui è stato scoperto solo recuperando la tabella completa pubblica,
 * non dal solo test round-trip.
 */

function i16(view: DataView, offset: number): number { return view.getInt16(offset, false); }
function u16(view: DataView, offset: number): number { return view.getUint16(offset, false); }
function u8(raw: Uint8Array, offset: number): number { return raw[offset]; }

export interface LevelCommand {
  offset: number;
  opcode: number;
  name: string;
  length: number;
  raw: number[];
  fields: Record<string, number>;
}

interface CommandSpec {
  name: string;
  length: number;
  parse?: (raw: Uint8Array, view: DataView) => Record<string, number>;
  serialize?: (fields: Record<string, number>, raw: Uint8Array, view: DataView) => void;
}

// Parser/serializer condiviso per Connect Warps (0x26) e Painting Warp
// (0x27): stesso identico layout documentato pubblicamente.
const warpSpec: CommandSpec = {
  name: "CONNECT_WARPS",
  length: 8,
  parse: (raw) => ({ warpId: raw[1], destCourse: raw[2], destArea: raw[3], destWarpId: raw[4], checkpointFlag: raw[5] }),
  serialize: (f, raw) => {
    raw[1] = f.warpId & 0xff; raw[2] = f.destCourse & 0xff; raw[3] = f.destArea & 0xff;
    raw[4] = f.destWarpId & 0xff; raw[5] = f.checkpointFlag & 0xff;
  }
};

// Tabella comandi reale, cross-verificata su Hack64 Wiki. Comandi marcati
// "mai usati nei level script reali" dalla documentazione pubblica sono
// comunque mappati per lunghezza (per non disallineare il parser se
// presenti), ma senza parsing di campo dedicato essendo di fatto inutili
// per un editor. I commenti [MAI USATO] seguono la nota della wiki.
const COMMANDS: Record<number, CommandSpec> = {
  0x00: { name: "LOAD_RAW_DATA_AND_JUMP", length: 0x10 },
  0x01: { name: "LOAD_RAW_DATA_AND_JUMP_ALT", length: 0x10 },
  0x02: { name: "END_LEVEL_DATA", length: 0x04 }, // vero terminatore reale
  0x03: {
    name: "DELAY_FRAMES", length: 0x04,
    parse: (raw, v) => ({ frameCount: v.getUint16(2, false) }),
    serialize: (f, raw, v) => v.setUint16(2, f.frameCount & 0xffff, false)
  },
  0x04: { name: "DELAY_FRAMES_2", length: 0x04 },
  0x05: { name: "JUMP_TO_ADDRESS", length: 0x08 },
  0x06: { name: "PUSH_STACK", length: 0x08 },
  0x07: { name: "POP_STACK", length: 0x04 },
  0x08: { name: "PUSH_STACK_16", length: 0x04 }, // [MAI USATO]
  0x09: { name: "POP_STACK_16", length: 0x04 }, // [MAI USATO]
  0x0a: { name: "PUSH_SCRIPT", length: 0x04 }, // [MAI USATO]
  0x0b: { name: "CONDITIONAL_POP", length: 0x08 },
  0x0c: { name: "CONDITIONAL_JUMP", length: 0x0c },
  0x0d: { name: "CONDITIONAL_PUSH", length: 0x08 }, // [MAI USATO]
  0x0e: { name: "CONDITIONAL_SKIP", length: 0x08 }, // [MAI USATO]
  0x0f: { name: "SKIP_NEXT", length: 0x04 }, // [MAI USATO]
  0x10: { name: "NO_OPERATION", length: 0x04 }, // [MAI USATO]
  0x11: { name: "SET_ACCUMULATOR_FROM_ASM", length: 0x08 },
  0x12: { name: "ACTIVELY_SET_ACCUMULATOR", length: 0x08 },
  0x13: { name: "SET_ACCUMULATOR", length: 0x04 },
  0x14: { name: "PUSH_POOL_STATE", length: 0x04 }, // [MAI USATO]
  0x15: { name: "POP_POOL_STATE", length: 0x04 }, // [MAI USATO]
  0x16: { name: "LOAD_ROM_TO_RAM", length: 0x10 },
  0x17: { name: "LOAD_ROM_TO_SEGMENT", length: 0x0c },
  0x18: { name: "DECOMPRESS_MIO0_TO_SEGMENT", length: 0x0c },
  0x19: {
    name: "CREATE_MARIO_DEMO", length: 0x04,
    parse: (raw) => ({ settings: raw[3] }),
    serialize: (f, raw) => { raw[3] = f.settings & 0xff; }
  },
  0x1a: { name: "DECOMPRESS_MIO0_TEXTURES", length: 0x0c },
  0x1b: { name: "START_LOAD_SEQUENCE", length: 0x04 },
  0x1c: { name: "LEVEL_MEMORY_CLEANUP", length: 0x04 },
  0x1d: { name: "END_LOAD_SEQUENCE", length: 0x04 },
  0x1e: { name: "ALLOCATE_LEVEL_DATA_FROM_POOL", length: 0x04 },
  0x1f: {
    name: "START_AREA", length: 0x08,
    parse: (raw) => ({ areaNum: raw[1] }),
    serialize: (f, raw) => { raw[1] = f.areaNum & 0xff; }
  },
  0x20: { name: "END_AREA", length: 0x04 },
  0x21: {
    name: "LOAD_POLYGON_NO_GEO", length: 0x08,
    parse: (raw, v) => ({ drawingLayer: raw[1], modelId: v.getUint16(2, false) }),
    serialize: (f, raw, v) => { raw[1] = f.drawingLayer & 0xff; v.setUint16(2, f.modelId & 0xffff, false); }
  },
  0x22: {
    name: "LOAD_POLYGON_WITH_GEO", length: 0x08,
    parse: (raw, v) => ({ modelId: v.getUint16(2, false) }),
    serialize: (f, raw, v) => v.setUint16(2, f.modelId & 0xffff, false)
  },
  0x23: { name: "UNKNOWN_0x23", length: 0x0c },
  0x24: {
    name: "PLACE_OBJECT", length: 0x18,
    parse: (raw, v) => ({
      activeAreaMask: raw[1], modelId: u16(v, 2),
      x: i16(v, 4), y: i16(v, 6), z: i16(v, 8),
      rotX: i16(v, 10), rotY: i16(v, 12), rotZ: i16(v, 14),
      behaviorParam: v.getUint32(16, false), behaviorSegAddr: v.getUint32(20, false)
    }),
    serialize: (f, raw, v) => {
      raw[1] = f.activeAreaMask & 0xff;
      v.setUint16(2, f.modelId & 0xffff, false);
      v.setInt16(4, f.x, false); v.setInt16(6, f.y, false); v.setInt16(8, f.z, false);
      v.setInt16(10, f.rotX, false); v.setInt16(12, f.rotY, false); v.setInt16(14, f.rotZ, false);
      v.setUint32(16, f.behaviorParam >>> 0, false); v.setUint32(20, f.behaviorSegAddr >>> 0, false);
    }
  },
  0x25: { name: "LOAD_MARIO", length: 0x0c },
  0x26: warpSpec,
  0x27: { ...warpSpec, name: "PAINTING_WARP" },
  0x28: {
    name: "SETUP_INSTANT_AREA_WARP", length: 0x0c,
    parse: (raw, v) => ({ collisionId: raw[1], area: raw[3], xOffset: i16(v, 4), yOffset: i16(v, 6), zOffset: i16(v, 8) }),
    serialize: (f, raw, v) => {
      raw[1] = f.collisionId & 0xff; raw[3] = f.area & 0xff;
      v.setInt16(4, f.xOffset, false); v.setInt16(6, f.yOffset, false); v.setInt16(8, f.zOffset, false);
    }
  },
  0x29: { name: "UNKNOWN_0x29", length: 0x04 },
  0x2a: { name: "UNKNOWN_0x2A", length: 0x04 },
  0x2b: {
    name: "SET_MARIO_DEFAULT_POSITION", length: 0x0c,
    parse: (raw, v) => ({ areaNum: raw[1], yaw: i16(v, 4), x: i16(v, 6), y: i16(v, 8), z: i16(v, 10) }),
    serialize: (f, raw, v) => {
      raw[1] = f.areaNum & 0xff;
      v.setInt16(4, f.yaw, false); v.setInt16(6, f.x, false); v.setInt16(8, f.y, false); v.setInt16(10, f.z, false);
    }
  },
  0x2c: { name: "UNKNOWN_0x2C", length: 0x04 },
  0x2d: { name: "UNKNOWN_0x2D", length: 0x04 },
  0x2e: { name: "LOAD_COLLISION", length: 0x08 },
  0x2f: { name: "SETUP_RENDER_ROOM", length: 0x08 },
  0x30: {
    name: "SHOW_DIALOG", length: 0x04,
    parse: (raw) => ({ dialogId: raw[3] }),
    serialize: (f, raw) => { raw[3] = f.dialogId & 0xff; }
  },
  0x31: {
    name: "SET_DEFAULT_TERRAIN", length: 0x04,
    parse: (raw, v) => ({ terrainType: u16(v, 2) }),
    serialize: (f, raw, v) => v.setUint16(2, f.terrainType & 0xffff, false)
  },
  0x33: {
    name: "FADE_COLOR", length: 0x08,
    parse: (raw, v) => ({ enable: raw[1], duration: u16(v, 2), red: raw[4], green: raw[5], blue: raw[6] }),
    serialize: (f, raw, v) => {
      raw[1] = f.enable & 0xff; v.setUint16(2, f.duration & 0xffff, false);
      raw[4] = f.red & 0xff; raw[5] = f.green & 0xff; raw[6] = f.blue & 0xff;
    }
  },
  0x34: {
    name: "BLACKOUT_SCREEN", length: 0x04,
    parse: (raw) => ({ state: raw[1] }),
    serialize: (f, raw) => { raw[1] = f.state & 0xff; }
  },
  0x35: { name: "UNKNOWN_0x35", length: 0x04 },
  0x36: {
    name: "SET_MUSIC", length: 0x08,
    parse: (raw, v) => ({ param1: raw[1], param2: raw[2], param3: raw[3], sequenceArgs: v.getUint32(4, false) }),
    serialize: (f, raw, v) => {
      raw[1] = f.param1 & 0xff; raw[2] = f.param2 & 0xff; raw[3] = f.param3 & 0xff;
      v.setUint32(4, f.sequenceArgs >>> 0, false);
    }
  },
  0x37: {
    name: "SET_MUSIC_SIMPLE", length: 0x04,
    parse: (raw) => ({ sequence: raw[3] }),
    serialize: (f, raw) => { raw[3] = f.sequence & 0xff; }
  },
  0x38: { name: "UNKNOWN_0x38", length: 0x04 },
  0x39: { name: "PLACE_MACRO_OBJECTS", length: 0x08 },
  0x3b: {
    name: "JET_STREAM", length: 0x0c,
    parse: (raw, v) => ({ x: i16(v, 4), y: i16(v, 6), z: i16(v, 8), intensity: u16(v, 10) }),
    serialize: (f, raw, v) => {
      v.setInt16(4, f.x, false); v.setInt16(6, f.y, false); v.setInt16(8, f.z, false); v.setUint16(10, f.intensity & 0xffff, false);
    }
  },
  0x3c: { name: "UNKNOWN_0x3C", length: 0x04 }
};

/**
 * Scansiona un buffer di comandi level-script reali fino a END_LEVEL_DATA
 * (0x02, il vero terminatore documentato) o fino a fine buffer. Comandi con
 * opcode non mappato interrompono la scansione onestamente invece di
 * disallinearsi silenziosamente e produrre un parsing corrotto.
 */
export function parseLevelScript(buffer: Uint8Array): { commands: LevelCommand[]; truncatedAt: number | null } {
  const commands: LevelCommand[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const opcode = buffer[pos];
    const spec = COMMANDS[opcode];
    if (!spec) return { commands, truncatedAt: pos };
    if (pos + spec.length > buffer.length) return { commands, truncatedAt: pos };

    const raw = buffer.slice(pos, pos + spec.length);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const fields = spec.parse ? spec.parse(raw, view) : {};
    commands.push({ offset: pos, opcode, name: spec.name, length: spec.length, raw: Array.from(raw), fields });

    if (opcode === 0x02) { pos += spec.length; break; } // vero terminatore reale
    pos += spec.length;
  }

  return { commands, truncatedAt: null };
}

export function serializeLevelScript(commands: LevelCommand[]): Uint8Array {
  const totalLen = commands.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const cmd of commands) {
    const raw = new Uint8Array(cmd.raw);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const spec = COMMANDS[cmd.opcode];
    if (spec?.serialize) spec.serialize(cmd.fields, raw, view);
    out.set(raw, pos);
    pos += cmd.length;
  }
  return out;
}

export const EDITABLE_COMMAND_NAMES = Object.values(COMMANDS)
  .filter(c => c.parse)
  .map(c => c.name);
