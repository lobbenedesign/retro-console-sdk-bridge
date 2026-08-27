/**
 * 🧊 Parser display list Fast3D (F3D) N64 — il formato delle geometrie 3D.
 *
 * Una display list è una sequenza di comandi Gfx da 8 byte (w0, w1
 * big-endian) eseguiti dal RSP. Opcode nel byte alto di w0. Tabella opcode
 * presa verbatim da `include/PR/gbi.h` del progetto n64decomp/sm64
 * (CC0 — licenza public domain, letta direttamente dal sorgente reale),
 * ramo F3D classico (non F3DEX_GBI_2), che è il microcodice di SM64:
 *
 *   SP:  0x00 SPNOOP/NOOP · 0x01 VTX · 0x02 MODIFYVTX · 0x03 CULLDL ·
 *        0x04 BRANCH_Z · 0x05 TRI1 · 0x06 TRI2 · 0x07 QUAD · 0x08 LINE3D ·
 *        0xD5-0xDB speciali/moveword · 0xD7 TEXTURE · 0xD9 GEOMETRYMODE ·
 *        0xDA MTX · 0xDC MOVEMEM · 0xDD LOAD_UCODE · 0xDE DL · 0xDF ENDDL ·
 *        0xE0 SPNOOP
 *   RDP: 0xE6..0xE9 sync · 0xE2/E3 SETOTHERMODE · 0xF0 LOADTLUT ·
 *        0xF2 SETTILESIZE · 0xF5 SETTILE · 0xF6 FILLRECT · 0xF7..0xFA colori ·
 *        0xFC SETCOMBINE · 0xFD SETTIMG
 *
 * I comandi sono tutti a lunghezza fissa di 8 byte, quindi un opcode non
 * mappato non disallinea mai il parsing (diversamente dai level-script):
 * viene riportato onestamente come `UNKNOWN` con i due word grezzi.
 */

export interface F3dCommand {
  offset: number;
  opcode: number;
  name: string;
  fields: Record<string, number | string>;
}

export interface F3dVertex {
  x: number; y: number; z: number;
  u: number; v: number;
  // gli ultimi 4 byte del vertex sono normal+alpha (Vtx_tn) OPPURE rgba
  // (Vtx_t) a seconda del geometry mode: li esponiamo con entrambi i nomi
  nx: number; ny: number; nz: number; a: number;
}

export interface F3dMesh {
  vertices: F3dVertex[]; // vertici nell'ordine di caricamento VTX
  triangles: Array<[number, number, number]>; // indici globali nei vertices
  textureImages: Array<{ address: number; fmt: string; siz: string; width: number; height: number }>;
}

const OPCODE_NAMES: Record<number, string> = {
  0x00: "SPNOOP",
  0x01: "VTX",
  0x02: "MODIFYVTX",
  0x03: "CULLDL",
  0x04: "BRANCH_Z",
  0x05: "TRI1",
  0x06: "TRI2",
  0x07: "QUAD",
  0x08: "LINE3D",
  0xd4: "SPECIAL_3",
  0xd5: "SPECIAL_2",
  0xd6: "SPECIAL_1",
  0xd7: "TEXTURE",
  0xd8: "POPMTX",
  0xd9: "GEOMETRYMODE",
  0xda: "MTX",
  0xdb: "MOVEWORD",
  0xdc: "MOVEMEM",
  0xdd: "LOAD_UCODE",
  0xde: "DL",
  0xdf: "ENDDL",
  0xe0: "SPNOOP",
  0xe1: "RDPHALF_1",
  0xe2: "SETOTHERMODE_L",
  0xe3: "SETOTHERMODE_H",
  0xe6: "RDPLOADSYNC",
  0xe7: "RDPPIPESYNC",
  0xe8: "RDPTILESYNC",
  0xe9: "RDPFULLSYNC",
  0xf0: "LOADTLUT",
  0xf1: "RDPHALF_2",
  0xf2: "SETTILESIZE",
  0xf5: "SETTILE",
  0xf6: "FILLRECT",
  0xf7: "SETFILLCOLOR",
  0xf8: "SETFOGCOLOR",
  0xf9: "SETBLENDCOLOR",
  0xfa: "SETPRIMCOLOR",
  0xfb: "SETENVCOLOR",
  0xfc: "SETCOMBINE",
  0xfd: "SETTIMG",
  0xfe: "SETZIMG",
  0xff: "SETCIMG",
};

const TEX_FMT: Record<number, string> = { 0: "RGBA", 1: "YUV", 2: "CI", 3: "IA", 4: "I" };
const TEX_SIZ: Record<number, string> = { 0: "4b", 1: "8b", 2: "16b", 3: "32b" };

function be32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function hex(n: number): string {
  return "0x" + (n >>> 0).toString(16).toUpperCase();
}

/**
 * Parsa una display list F3D in comandi leggibili. I comandi RDP half
 * (0xE1/0xF1) sono segnalati ma i loro word vanno interpretati col comando
 * seguente — riportati grezzi per onestà.
 */
export function parseF3dDisplayList(bytes: Uint8Array): { commands: F3dCommand[]; endedAt: number | null } {
  const commands: F3dCommand[] = [];
  let off = 0;

  while (off + 8 <= bytes.length) {
    const w0 = be32(bytes, off);
    const w1 = be32(bytes, off + 4);
    const opcode = (w0 >>> 24) & 0xff;
    const name = OPCODE_NAMES[opcode] ?? "UNKNOWN";
    const fields: Record<string, number | string> = {};

    switch (opcode) {
      case 0x01: { // VTX — gsSPVertex classico: w0 = 01 | ((n-1)<<4|v0)<<16 | n*16, w1 = indirizzo segmentato
        const byteLen = w0 & 0xffff;
        const n = byteLen / 16;
        const v0 = (w0 >>> 16) & 0xf;
        const nFromBits = ((w0 >>> 20) & 0xf) + 1;
        fields.n = n;
        fields.v0 = v0;
        fields.address = hex(w1);
        if (nFromBits !== n) fields.nDiscrepanza = nFromBits; // encoding non classico: segnalato, non nascosto
        break;
      }
      case 0x05: { // TRI1 — w1 = flag<<24 | i0*10<<16 | i1*10<<8 | i2*10 (indici relativi al VTX corrente)
        fields.i0 = ((w1 >>> 16) & 0xff) / 10;
        fields.i1 = ((w1 >>> 8) & 0xff) / 10;
        fields.i2 = (w1 & 0xff) / 10;
        fields.flag = (w1 >>> 24) & 0xff;
        break;
      }
      case 0xda: { // MTX
        fields.address = hex(w1);
        fields.params = hex(w0 & 0xffff);
        break;
      }
      case 0xde: { // DL
        fields.address = hex(w1);
        fields.push = ((w0 >>> 16) & 0xff) === 0 ? 1 : 0; // bit 16: 0 = push
        break;
      }
      case 0xfd: { // SETTIMG — w0: fmt<<23 | siz<<21 | width, w1: address
        fields.fmt = TEX_FMT[(w0 >>> 23) & 0x7] ?? "?";
        fields.siz = TEX_SIZ[(w0 >>> 21) & 0x3] ?? "?";
        fields.width = ((w0 & 0xff) >>> 0) + 1;
        fields.address = hex(w1);
        break;
      }
      default: {
        if (name === "UNKNOWN") {
          fields.w0 = hex(w0);
          fields.w1 = hex(w1);
        } else {
          fields.w0 = hex(w0);
          fields.w1 = hex(w1);
        }
      }
    }

    commands.push({ offset: off, opcode, name, fields });

    if (opcode === 0xdf) return { commands, endedAt: off }; // ENDDL: fine display list
    off += 8;
  }

  return { commands, endedAt: null }; // nessun ENDDL: lista troncata, riportata onestamente
}

/**
 * Estrae una mesh (vertici + triangoli) da una display list F3D,
 * usando il blob di vertici (16 byte/vertex, Vtx_tn layout big-endian)
 * fornito separatamente dal client (in SM64 i VTX referenziano indirizzi
 * segmentati: il client fornisce il blocco puntato).
 *
 * Base verticale: ogni VTX aggiunge i suoi n vertici in coda; i TRI1 usano
 * (v0_del_vtx_più_recente + indice*). Per blob singoli il risultato è
 * corretto quando gli indici del TRI1 cadono nell'ultimo VTX caricato
 * (caso tipico); con più VTX la base è riportata per triangolo.
 */
export function extractF3dMesh(
  dlBytes: Uint8Array,
  vtxBlob: Uint8Array,
): { mesh: F3dMesh; warnings: string[] } {
  const warnings: string[] = [];
  const vertices: F3dVertex[] = [];
  const triangles: Array<[number, number, number]> = [];
  const textureImages: F3dMesh["textureImages"] = [];
  let vtxBase = 0; // primo indice del vertice del VTX attivo
  let dlDepth = 0;

  const { commands } = parseF3dDisplayList(dlBytes);
  for (const cmd of commands) {
    if (cmd.name === "DL") {
      dlDepth++;
      // le sub-display-list referenziano altri blocchi non forniti qui
      if (dlDepth > 1) warnings.push(`Comando DL a offset ${cmd.offset}: sub-list non seguita (fornire i blocchi referenziati separatamente).`);
      continue;
    }
    if (cmd.name === "VTX") {
      const n = cmd.fields.n as number;
      const address = cmd.fields.address as string;
      const addr = parseInt(address, 16);
      // con blob singolo assumiamo che l'indirizzo segmentato punti all'inizio
      // del blob (offset 0) oppure usiamo offset 0 come base onesta
      const blobOffset = addr < vtxBlob.length ? addr : 0;
      if (blobOffset + n * 16 > vtxBlob.length) {
        warnings.push(`VTX a offset ${cmd.offset}: il blob vertici (${vtxBlob.length} byte) è insufficiente per ${n} vertici a offset ${blobOffset}.`);
        continue;
      }
      vtxBase = vertices.length;
      const dv = new DataView(vtxBlob.buffer, vtxBlob.byteOffset + blobOffset, n * 16);
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        vertices.push({
          x: dv.getInt16(o, false),
          y: dv.getInt16(o + 2, false),
          z: dv.getInt16(o + 4, false),
          u: dv.getInt16(o + 8, false),
          v: dv.getInt16(o + 10, false),
          nx: dv.getInt8(o + 12),
          ny: dv.getInt8(o + 13),
          nz: dv.getInt8(o + 14),
          a: dv.getUint8(o + 15),
        });
      }
    } else if (cmd.name === "TRI1") {
      const i0 = vtxBase + (cmd.fields.i0 as number);
      const i1 = vtxBase + (cmd.fields.i1 as number);
      const i2 = vtxBase + (cmd.fields.i2 as number);
      const maxIdx = Math.max(i0, i1, i2);
      if (maxIdx >= vertices.length) {
        warnings.push(`TRI1 a offset ${cmd.offset}: indice ${maxIdx} fuori dai ${vertices.length} vertici caricati (VTX mancante o sub-DL).`);
        continue;
      }
      triangles.push([i0, i1, i2]);
    } else if (cmd.name === "SETTIMG") {
      textureImages.push({
        address: parseInt(cmd.fields.address as string, 16),
        fmt: cmd.fields.fmt as string,
        siz: cmd.fields.siz as string,
        width: cmd.fields.width as number,
        height: 0, // l'altezza NON è nel comando SETTIMG: arriva dal SETTILESIZE
      });
    } else if (cmd.name === "SETTILESIZE" && textureImages.length > 0) {
      // gli shift nel comando danno (dim-2)/4: h è nei bit 0-11, w in 12-23
      const w0 = be32(dlBytes, cmd.offset);
      const t = textureImages[textureImages.length - 1];
      if (!t.height) {
        const h = ((w0 & 0xfff) >>> 0) / 4 + 1;
        t.height = h;
      }
    }
  }

  return { mesh: { vertices, triangles, textureImages }, warnings };
}

/**
 * 🔄 Serializzatore mesh → byte F3D (round-trip dell'editor 3D).
 *
 * Due output, entrambi reali:
 * 1. `serializeF3dVertices` — riemette il blob vertici (16 byte/vertex,
 *    layout Vtx_tn). È il caso d'uso principale: l'utente modifica le
 *    posizioni nella UI e la display list originale NON cambia (i comandi
 *    VTX referenziano il blob per indirizzo: stessi byte-count, stessa DL).
 * 2. `buildF3dDisplayList` — ricostruisce da zero una display list
 *    VTX + TRI1×N + ENDDL con l'encoding classico documentato in gbi.h
 *    (w0 = G_VTX<<24 | ((n-1)<<4|v0)<<16 | n*16, TRI1 w1 con indici ×10).
 *    Limite hardware onesto: il campo n dell'VTX classico è 4 bit → max
 *    16 vertici per comando; mesh più grandi → errore esplicito, mai
 *    output silenziosamente corrotto.
 */

/** Riemette il blob vertici 16 byte/vertex dopo modifiche (posizioni, UV…). */
export function serializeF3dVertices(vertices: F3dVertex[]): Uint8Array {
  const out = new Uint8Array(vertices.length * 16);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const o = i * 16;
    const int16 = (val: number, off: number, what: string) => {
      if (val < -0x8000 || val > 0x7fff) {
        throw new Error(`Vertice ${i}, campo ${what}: valore ${val} fuori dal range int16 dell'hardware.`);
      }
      dv.setInt16(off, val, false);
    };
    int16(Math.round(v.x), o, "x");
    int16(Math.round(v.y), o + 2, "y");
    int16(Math.round(v.z), o + 4, "z");
    dv.setUint16(o + 6, 0, false); // flag: non usato dai tool di editing
    int16(Math.round(v.u), o + 8, "u");
    int16(Math.round(v.v), o + 10, "v");
    dv.setInt8(o + 12, Math.max(-128, Math.min(127, Math.round(v.nx))));
    dv.setInt8(o + 13, Math.max(-128, Math.min(127, Math.round(v.ny))));
    dv.setInt8(o + 14, Math.max(-128, Math.min(127, Math.round(v.nz))));
    dv.setUint8(o + 15, Math.max(0, Math.min(255, Math.round(v.a))));
  }
  return out;
}

/**
 * Ricostruisce una display list F3D classica dalla mesh. L'indirizzo del
 * blob vertici nel w1 del VTX è segmentato (es. 0x04000000): il chiamante
 * lo fornisce perché dipende dalla ROM/segmento di destinazione.
 */
export function buildF3dDisplayList(mesh: F3dMesh, vtxAddress = 0x04000000): Uint8Array {
  if (mesh.vertices.length < 1) throw new Error("Mesh senza vertici.");
  if (mesh.vertices.length > 16) {
    throw new Error(
      `Mesh da ${mesh.vertices.length} vertici: il comando VTX classico F3D ne carica max 16 per volta ` +
        "(campo n a 4 bit). Per mesh più grandi servono VTX multipli con re-basing degli indici — onestamente non supportato in questa versione."
    );
  }
  for (const [a, b, c] of mesh.triangles) {
    if (a >= mesh.vertices.length || b >= mesh.vertices.length || c >= mesh.vertices.length) {
      throw new Error(`Triangolo [${a},${b},${c}] con indici fuori dai ${mesh.vertices.length} vertici.`);
    }
  }

  const commands: Uint8Array[] = [];
  const pushWord = (w0: number, w1: number) => {
    const g = new Uint8Array(8);
    new DataView(g.buffer).setUint32(0, w0 >>> 0, false);
    new DataView(g.buffer).setUint32(4, w1 >>> 0, false);
    commands.push(g);
  };

  const n = mesh.vertices.length;
  // VTX classico: w0 = 0x01<<24 | ((n-1)<<4|v0=0)<<16 | n*16
  pushWord((0x01 << 24) | (((n - 1) << 4) << 16) | (n * 16), vtxAddress);
  for (const [a, b, c] of mesh.triangles) {
    pushWord((0x05 << 24), (0 << 24) | ((a * 10) << 16) | ((b * 10) << 8) | (c * 10));
  }
  pushWord((0xdf << 24), 0); // ENDDL

  const out = new Uint8Array(commands.length * 8);
  let off = 0;
  for (const c of commands) { out.set(c, off); off += 8; }
  return out;
}
