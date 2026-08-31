/**
 * 📝 Dichiarazione d'uso per il patcher di ROM — onesta, non una verifica.
 *
 * Nota importante: NON esiste alcun modo tecnico per uno strumento locale
 * di verificare realmente se l'utente possiede una copia autentica del
 * gioco. Chiamare questo meccanismo "certificato" o "verifica" sarebbe
 * fabbricare una garanzia che non può esistere — esattamente il tipo di
 * claim fittizio già rimosso da altri progetti in questo repository.
 *
 * Quello che questo modulo fa realmente:
 * 1. Richiede all'utente di digitare per esteso una dichiarazione precisa
 *    (non una semplice checkbox spuntabile senza attenzione).
 * 2. Registra realmente ogni dichiarazione accettata su disco (JSONL,
 *    timestamp reale, testo dichiarato) come log di responsabilizzazione.
 * 3. Genera un token reale (HMAC-SHA256, verificabile) che il client deve
 *    ripresentare per usare il patcher: un gate tecnico reale, anche se
 *    non prova nulla sulla proprietà legale del gioco.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHmac, randomBytes } from "crypto";
import { userDataDir } from "./app_paths";

const DATA_DIR = userDataDir();
const LOG_PATH = join(DATA_DIR, "rom_patch_declarations.jsonl");
const SECRET_PATH = join(DATA_DIR, ".declaration_secret");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Segreto locale reale generato una sola volta su questa macchina, usato
// solo per firmare i token di sessione: non lascia mai il processo locale.
function getOrCreateSecret(): string {
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH, "utf-8").trim();
  const secret = randomBytes(32).toString("hex");
  // mode 0o600: leggibile/scrivibile solo dal proprietario. Prima veniva
  // creato con i permessi di default del sistema (spesso 0o644, leggibile
  // da chiunque altro sulla stessa macchina) — un file che si chiama
  // ".declaration_secret" e firma token HMAC dovrebbe essere privato per
  // definizione, non solo per nome.
  writeFileSync(SECRET_PATH, secret, { encoding: "utf-8", mode: 0o600 });
  return secret;
}
const SECRET = getOrCreateSecret();

export const REQUIRED_DECLARATION_TEXT =
  "Dichiaro che la copia del videogioco su cui sto applicando questa patch è di mia legittima proprietà, " +
  "e che l'uso di questa patch è a mio esclusivo rischio e responsabilità. Comprendo che questo strumento " +
  "applica solo un file di differenze (IPS/BPS) fornito da me a una ROM fornita da me, e non scarica, " +
  "non ospita né distribuisce alcun contenuto protetto da copyright.";

export interface DeclarationRecord {
  fullName: string;
  statement: string;
  acceptedAt: string;
  declarationId: string;
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Registra una dichiarazione REALE se il testo digitato corrisponde
 * esattamente (normalizzato per spazi/maiuscole) al testo richiesto — non
 * accetta un semplice `true` booleano, l'utente deve avere effettivamente
 * letto e ridigitato/incollato la dichiarazione. Ritorna un token HMAC
 * reale, verificabile, legato al nome dichiarato e all'istante di accettazione.
 */
export function recordDeclaration(fullName: string, statement: string): { token: string; declarationId: string } {
  const cleanName = (fullName || "").trim();
  if (cleanName.length < 2) {
    throw new Error("Nome completo mancante o troppo corto.");
  }
  if (normalize(statement) !== normalize(REQUIRED_DECLARATION_TEXT)) {
    throw new Error(
      "Il testo digitato non corrisponde esattamente alla dichiarazione richiesta. " +
      "Copia/incolla o ridigita esattamente il testo mostrato — questo passaggio serve a " +
      "confermare che l'hai letto, non solo spuntato una casella."
    );
  }

  const declarationId = randomBytes(16).toString("hex");
  const acceptedAt = new Date().toISOString();

  const record: DeclarationRecord = { fullName: cleanName, statement, acceptedAt, declarationId };
  appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf-8");

  const token = createHmac("sha256", SECRET).update(`${declarationId}:${cleanName}:${acceptedAt}`).digest("hex");
  return { token: `${declarationId}|${acceptedAt}|${token}`, declarationId };
}

/**
 * Verifica REALE del token (HMAC ricalcolato, non un semplice confronto di
 * stringa arbitraria) e che il nome dichiarato corrisponda a quello loggato
 * per quel declarationId. Non prova la proprietà del gioco — prova solo che
 * questo client ha effettivamente completato il passaggio di dichiarazione.
 */
export function verifyToken(token: string | null | undefined, fullName: string | null | undefined): boolean {
  if (!token || !fullName) return false;
  const parts = token.split("|");
  if (parts.length !== 3) return false;
  const [declarationId, acceptedAt, signature] = parts;
  const expected = createHmac("sha256", SECRET).update(`${declarationId}:${fullName.trim()}:${acceptedAt}`).digest("hex");
  return expected === signature;
}
