import { describe, test, expect } from "bun:test";
import { parseLevelScript, serializeLevelScript } from "../src/sm64_level_script";

/**
 * Test reali per il parser/serializer level-script SM64 (src/sm64_level_script.ts).
 * Usa il vero terminatore 0x02 (END_LEVEL_DATA) e comandi reali documentati
 * pubblicamente (Hack64 Wiki): DELAY_FRAMES (0x03), START_AREA (0x1F),
 * SET_MUSIC_SIMPLE (0x37). Verifica il round-trip parse -> serialize.
 */

describe("parseLevelScript / serializeLevelScript", () => {
  test("parsa DELAY_FRAMES (0x03) e ne estrae il campo frameCount", () => {
    // 0x03: length 4, frameCount a offset 2 (u16 big-endian)
    const buffer = new Uint8Array([
      0x03, 0x00, 0x00, 0x1e, // DELAY_FRAMES frameCount=30
      0x02, 0x00, 0x00, 0x00  // END_LEVEL_DATA
    ]);
    const { commands, truncatedAt } = parseLevelScript(buffer);
    expect(truncatedAt).toBeNull();
    expect(commands.length).toBe(2);
    expect(commands[0].name).toBe("DELAY_FRAMES");
    expect(commands[0].fields.frameCount).toBe(30);
    expect(commands[1].name).toBe("END_LEVEL_DATA");
    expect(commands[1].opcode).toBe(0x02);
  });

  test("parsa START_AREA (0x1F) e SET_MUSIC_SIMPLE (0x37)", () => {
    const buffer = new Uint8Array([
      0x1f, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // START_AREA areaNum=1
      0x37, 0x00, 0x00, 0x05, // SET_MUSIC_SIMPLE sequence=5
      0x02, 0x00, 0x00, 0x00  // END_LEVEL_DATA
    ]);
    const { commands, truncatedAt } = parseLevelScript(buffer);
    expect(truncatedAt).toBeNull();
    expect(commands.length).toBe(3);
    expect(commands[0].name).toBe("START_AREA");
    expect(commands[0].fields.areaNum).toBe(1);
    expect(commands[1].name).toBe("SET_MUSIC_SIMPLE");
    expect(commands[1].fields.sequence).toBe(5);
    expect(commands[2].name).toBe("END_LEVEL_DATA");
  });

  test("si ferma a END_LEVEL_DATA (0x02) anche se ci sono altri byte dopo", () => {
    const buffer = new Uint8Array([
      0x02, 0x00, 0x00, 0x00, // END_LEVEL_DATA
      0xff, 0xff, 0xff, 0xff  // spazzatura dopo il terminatore, non deve essere parsata
    ]);
    const { commands, truncatedAt } = parseLevelScript(buffer);
    expect(truncatedAt).toBeNull();
    expect(commands.length).toBe(1);
    expect(commands[0].opcode).toBe(0x02);
  });

  test("opcode sconosciuto interrompe la scansione con truncatedAt onesto", () => {
    const buffer = new Uint8Array([
      0x03, 0x00, 0x00, 0x1e, // DELAY_FRAMES valido
      0x3f, 0x00, 0x00, 0x00  // opcode 0x3F non mappato
    ]);
    const { commands, truncatedAt } = parseLevelScript(buffer);
    expect(commands.length).toBe(1);
    expect(truncatedAt).toBe(4);
  });

  test("round-trip parse -> serialize produce gli stessi byte (DELAY_FRAMES + END)", () => {
    const original = new Uint8Array([
      0x03, 0x00, 0x00, 0x2a, // DELAY_FRAMES frameCount=42
      0x02, 0x00, 0x00, 0x00  // END_LEVEL_DATA
    ]);
    const { commands } = parseLevelScript(original);
    const serialized = serializeLevelScript(commands);
    expect([...serialized]).toEqual([...original]);
  });

  test("round-trip parse -> serialize preserva un campo modificato (START_AREA)", () => {
    const original = new Uint8Array([
      0x1f, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // START_AREA areaNum=1
      0x02, 0x00, 0x00, 0x00
    ]);
    const { commands } = parseLevelScript(original);
    commands[0].fields.areaNum = 3;
    const serialized = serializeLevelScript(commands);

    const reparsed = parseLevelScript(serialized);
    expect(reparsed.commands[0].fields.areaNum).toBe(3);
    // Il resto del buffer (terminatore) resta identico bit per bit.
    expect([...serialized.slice(8)]).toEqual([0x02, 0x00, 0x00, 0x00]);
  });

  test("round-trip completo su una sequenza di 3 comandi reali", () => {
    const original = new Uint8Array([
      0x1f, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // START_AREA areaNum=2
      0x37, 0x00, 0x00, 0x07,                          // SET_MUSIC_SIMPLE sequence=7
      0x02, 0x00, 0x00, 0x00                           // END_LEVEL_DATA
    ]);
    const { commands, truncatedAt } = parseLevelScript(original);
    expect(truncatedAt).toBeNull();
    const serialized = serializeLevelScript(commands);
    expect([...serialized]).toEqual([...original]);
  });
});
