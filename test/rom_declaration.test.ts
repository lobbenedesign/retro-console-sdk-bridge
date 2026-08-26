import { describe, test, expect } from "bun:test";
import { recordDeclaration, verifyToken, REQUIRED_DECLARATION_TEXT } from "../src/rom_declaration";

/**
 * Test reali per il gate di dichiarazione d'uso (src/rom_declaration.ts).
 * Nota: `recordDeclaration` scrive realmente su disco sotto data/ (gitignored),
 * lo stesso comportamento reale usato in produzione — nessun mock del
 * filesystem qui, per verificare che il token HMAC generato sia davvero
 * verificabile end-to-end da `verifyToken`.
 */

describe("recordDeclaration", () => {
  test("rifiuta un testo che non corrisponde esattamente alla dichiarazione richiesta", () => {
    expect(() => recordDeclaration("Mario Rossi", "non è il testo giusto")).toThrow();
  });

  test("rifiuta un nome mancante o troppo corto", () => {
    expect(() => recordDeclaration("", REQUIRED_DECLARATION_TEXT)).toThrow();
    expect(() => recordDeclaration("A", REQUIRED_DECLARATION_TEXT)).toThrow();
  });

  test("accetta il testo normalizzato (spazi/maiuscole differenti) e produce un token nel formato declarationId|acceptedAt|signature", () => {
    const messyStatement = "  " + REQUIRED_DECLARATION_TEXT.toUpperCase().replace(/\s+/g, "   ") + "  ";
    const { token, declarationId } = recordDeclaration("Mario Rossi Test", messyStatement);

    const parts = token.split("|");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe(declarationId);
    // acceptedAt è un timestamp ISO reale
    expect(() => new Date(parts[1]).toISOString()).not.toThrow();
    expect(new Date(parts[1]).toString()).not.toBe("Invalid Date");
    // signature è un hex HMAC-SHA256 (64 caratteri hex)
    expect(parts[2]).toMatch(/^[0-9a-f]{64}$/);
    // declarationId è hex a 32 caratteri (16 byte)
    expect(declarationId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("verifyToken", () => {
  test("accetta un token valido appena generato per lo stesso nome", () => {
    const fullName = "Luigi Verdi Test";
    const { token } = recordDeclaration(fullName, REQUIRED_DECLARATION_TEXT);
    expect(verifyToken(token, fullName)).toBe(true);
  });

  test("rifiuta un token manomesso (signature alterata)", () => {
    const fullName = "Peach Test";
    const { token } = recordDeclaration(fullName, REQUIRED_DECLARATION_TEXT);
    const parts = token.split("|");
    const tamperedSignature = parts[2].slice(0, -1) + (parts[2].endsWith("0") ? "1" : "0");
    const tamperedToken = `${parts[0]}|${parts[1]}|${tamperedSignature}`;
    expect(verifyToken(tamperedToken, fullName)).toBe(false);
  });

  test("rifiuta un token valido riusato con un nome diverso", () => {
    const { token } = recordDeclaration("Bowser Test", REQUIRED_DECLARATION_TEXT);
    expect(verifyToken(token, "Nome Diverso")).toBe(false);
  });

  test("rifiuta token o nome mancanti/malformati", () => {
    expect(verifyToken(null, "Mario")).toBe(false);
    expect(verifyToken("abc", "Mario")).toBe(false); // formato non a 3 parti
    expect(verifyToken("a|b|c", null)).toBe(false);
  });
});
