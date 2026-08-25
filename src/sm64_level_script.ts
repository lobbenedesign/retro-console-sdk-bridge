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
 */

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
  length: number; // lunghezza fissa reale del comando (byte), 0 = variabile/non gestito qui
  parse?: (raw: Uint8Array) => Record<string, number>;
  serialize?: (fields: Record<string, number>, raw: Uint8Array) => void;
}

function i16(view: DataView, offset: number): number {
  return view.getInt16(offset, false);
}
function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

// Tabella comandi reale, secondo la documentazione pubblica citata sopra.
// Solo i comandi rilevanti per un editor (posizionamento oggetti, spawn,
// warp, struttura area) sono gestiti con parsing di campo; gli altri sono
// comunque riconosciuti per lunghezza cosi' il parser non si disallinea.
const COMMANDS: Record<number, CommandSpec> = {
  0x00: { name: "LOAD_RAW_DATA_AND_JUMP", length: 16 },
  0x1f: {
    name: "START_AREA",
    length: 8,
    parse: (raw) => ({ areaNum: raw[1] }),
    serialize: (f, raw) => { raw[1] = f.areaNum & 0xff; }
  },
  0x20: { name: "END_AREA", length: 4 },
  0x21: { name: "LOAD_POLYGON_NO_GEO", length: 8 },
  0x22: { name: "LOAD_POLYGON_WITH_GEO", length: 8 },
  0x24: {
    name: "PLACE_OBJECT",
    length: 24,
    parse: (raw) => {
      const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      return {
        activeAreaMask: raw[1],
        modelId: u16(v, 2),
        x: i16(v, 4),
        y: i16(v, 6),
        z: i16(v, 8),
        rotX: i16(v, 10),
        rotY: i16(v, 12),
        rotZ: i16(v, 14),
        behaviorParam: v.getUint32(16, false),
        behaviorSegAddr: v.getUint32(20, false)
      };
    },
    serialize: (f, raw) => {
      const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      raw[1] = f.activeAreaMask & 0xff;
      v.setUint16(2, f.modelId & 0xffff, false);
      v.setInt16(4, f.x, false);
      v.setInt16(6, f.y, false);
      v.setInt16(8, f.z, false);
      v.setInt16(10, f.rotX, false);
      v.setInt16(12, f.rotY, false);
      v.setInt16(14, f.rotZ, false);
      v.setUint32(16, f.behaviorParam >>> 0, false);
      v.setUint32(20, f.behaviorSegAddr >>> 0, false);
    }
  },
  0x25: { name: "LOAD_MARIO_OBJECT", length: 12 },
  0x26: {
    name: "CONNECT_WARPS",
    length: 8,
    parse: (raw) => ({ warpId: raw[1], destLevel: raw[2], destArea: raw[3], destWarpId: raw[4], flags: raw[5] }),
    serialize: (f, raw) => {
      raw[1] = f.warpId & 0xff; raw[2] = f.destLevel & 0xff; raw[3] = f.destArea & 0xff;
      raw[4] = f.destWarpId & 0xff; raw[5] = f.flags & 0xff;
    }
  },
  0x2b: {
    name: "SET_MARIO_START_POS",
    length: 12,
    parse: (raw) => {
      const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      return { areaNum: raw[1], yaw: i16(v, 4), x: i16(v, 6), y: i16(v, 8), z: i16(v, 10) };
    },
    serialize: (f, raw) => {
      const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      raw[1] = f.areaNum & 0xff;
      v.setInt16(4, f.yaw, false); v.setInt16(6, f.x, false); v.setInt16(8, f.y, false); v.setInt16(10, f.z, false);
    }
  },
  0x2e: { name: "LOAD_COLLISION", length: 8 },
  0x2a: { name: "SET_MARIO_ACTION", length: 8 },
  0x27: { name: "END_LEVEL_SCRIPT", length: 4 }
};

/**
 * Scansiona un buffer di comandi level-script reali fino a END_LEVEL_SCRIPT
 * (0x27) o fino a fine buffer. Comandi con lunghezza sconosciuta (opcode non
 * mappato) interrompono la scansione onestamente invece di disallinearsi
 * silenziosamente e produrre un parsing corrotto.
 */
export function parseLevelScript(buffer: Uint8Array): { commands: LevelCommand[]; truncatedAt: number | null } {
  const commands: LevelCommand[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const opcode = buffer[pos];
    const spec = COMMANDS[opcode];
    if (!spec) {
      return { commands, truncatedAt: pos }; // opcode non documentato qui: fermati onestamente
    }
    if (pos + spec.length > buffer.length) {
      return { commands, truncatedAt: pos };
    }
    const raw = buffer.slice(pos, pos + spec.length);
    const fields = spec.parse ? spec.parse(raw) : {};
    commands.push({ offset: pos, opcode, name: spec.name, length: spec.length, raw: Array.from(raw), fields });

    if (opcode === 0x27) { pos += spec.length; break; }
    pos += spec.length;
  }

  return { commands, truncatedAt: null };
}

/**
 * Riserializza i comandi (con eventuali campi modificati) in un nuovo
 * buffer di byte reale, usando i serializer reali definiti sopra per i
 * comandi con campi editabili — gli altri vengono riscritti byte-per-byte
 * identici a come sono stati letti.
 */
export function serializeLevelScript(commands: LevelCommand[]): Uint8Array {
  const totalLen = commands.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const cmd of commands) {
    const raw = new Uint8Array(cmd.raw);
    const spec = COMMANDS[cmd.opcode];
    if (spec?.serialize) spec.serialize(cmd.fields, raw);
    out.set(raw, pos);
    pos += cmd.length;
  }
  return out;
}

export const EDITABLE_COMMAND_NAMES = Object.values(COMMANDS)
  .filter(c => c.parse)
  .map(c => c.name);
