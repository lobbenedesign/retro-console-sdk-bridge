/**
 * 🔁 Servizi di rebuild: PSP (ISO/CSO) e Dreamcast (GDI).
 *
 * Il client fornisce l'immagine ORIGINALE + i file modificati; il server
 * rilegge l'intero filesystem dall'originale (in memoria, mai su disco),
 * sostituisce i file indicati e ricostruisce l'immagine col builder.
 * Le dimensioni diverse da quelle originali sono gestite: gli LBA vengono
 * riassegnati globalmente dal builder.
 */

import { IsoReader, csoCompress } from "./psp_cso";
import { listIsoFiles, extractIsoFile } from "./psp_iso";
import { buildIso9660, type BuildFile } from "./iso_build";
import { unzip } from "./zip_reader";

export interface Replacement {
  name: string; // nome file (ultimo segmento del percorso, case-insensitive)
  data: Uint8Array;
}

/** Legge TUTTI i file da un'immagine (ISO o CSO) come BuildFile[]. */
function readAllFiles(image: Uint8Array): { files: BuildFile[]; systemId: string; volumeId: string } {
  const reader = new IsoReader(image);
  const listing = listIsoFiles(reader);
  const files: BuildFile[] = listing.entries
    .filter((e) => !e.isDir)
    .map((e) => ({ path: e.path, data: extractIsoFile(reader, listing.entries, e.path) }));
  return { files, systemId: listing.systemId, volumeId: listing.volumeId };
}

/** Applica le sostituzioni per nome file (match sull'ultimo segmento). */
function applyReplacements(files: BuildFile[], replacements: Replacement[]): { files: BuildFile[]; applied: string[]; unmatched: string[] } {
  const applied: string[] = [];
  const unmatched: string[] = [];
  const out = files.map((f) => {
    const base = f.path.split("/").pop()!.toUpperCase();
    const rep = replacements.find((r) => r.name.toUpperCase() === base);
    if (rep) {
      applied.push(f.path + " (" + f.data.length + " → " + rep.data.length + " byte)");
      return { path: f.path, data: rep.data };
    }
    return f;
  });
  for (const r of replacements) {
    const base = r.name.toUpperCase();
    const hit = files.some((f) => f.path.split("/").pop()!.toUpperCase() === base);
    if (!hit) unmatched.push(r.name);
  }
  return { files: out, applied, unmatched };
}

export interface PspRebuildResult {
  iso: Uint8Array;
  cso?: Uint8Array;
  applied: string[];
  unmatched: string[];
}

/** Rebuild immagine PSP (ISO, opzionalmente anche CSO). */
export function rebuildPspImage(
  image: Uint8Array,
  replacements: Replacement[],
  alsoCso: boolean,
): PspRebuildResult {
  const { files, systemId, volumeId } = readAllFiles(image);
  const { files: finalFiles, applied, unmatched } = applyReplacements(files, replacements);
  const iso = buildIso9660(finalFiles, { systemId: systemId || "PLAYSTATION", volumeId: volumeId || "REBUILT" });
  return { iso, cso: alsoCso ? csoCompress(iso) : undefined, applied, unmatched };
}

export interface DcRebuildResult {
  zip: Uint8Array;
  applied: string[];
  unmatched: string[];
}

/** Rebuild immagine Dreamcast GDI: ricostruisce track dati preservando IP.BIN. */
export function rebuildDcGdi(
  zipBytes: Uint8Array,
  replacements: Replacement[],
): DcRebuildResult {
  const entriesList = unzip(zipBytes);
  const byName = new Map(entriesList.map((e) => [e.name.toLowerCase(), e]));
  const gdiEntry = entriesList.find((e) => e.name.toLowerCase().endsWith(".gdi"));
  if (!gdiEntry) throw new Error("Nessun file .gdi nello ZIP.");

  // parse GDI minimale (stessa logica di dc_gdi)
  const lines = new TextDecoder().decode(gdiEntry.data).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const trackLines = lines.slice(1);
  const dataTrackLine = trackLines.find((l) => /(^|\s)2048(\s|$)/.test(l));
  if (!dataTrackLine) throw new Error("Traccia dati (2048) non trovata nel GDI.");
  const dataTrackFile = dataTrackLine.split(/\s+/).find((t) => /\D/.test(t))!;

  const dataTrack = byName.get(dataTrackFile.toLowerCase())?.data;
  if (!dataTrack) throw new Error(`Traccia dati ${dataTrackFile} mancante.`);

  const { files, systemId, volumeId } = readAllFiles(dataTrack);
  const { files: finalFiles, applied, unmatched } = applyReplacements(files, replacements);

  // preserva i primi 16 settori = IP.BIN (bootstrap del disco)
  const newTrack = buildIso9660(finalFiles, {
    systemId,
    volumeId,
    preserveSectors0to15: dataTrack,
  });

  // ricrea lo ZIP con le stesse voci, traccia dati sostituita
  const newEntries = entriesList.map((e) => e.name.toLowerCase() === dataTrackFile.toLowerCase()
    ? { name: e.name, data: newTrack }
    : { name: e.name, data: e.data });
  return { zip: rebuildZip(newEntries), applied, unmatched };
}

/** Riscrive uno ZIP (stored, senza dipendenze). */
export function rebuildZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const crc32 = (bytes: Uint8Array): number => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    let c = 0xffffffff;
    for (const b of bytes) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of entries) {
    const nb = new TextEncoder().encode(f.name);
    const local = new Uint8Array(30 + nb.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc32(f.data), true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nb.length, true);
    local.set(nb, 30);
    locals.push(local, f.data);

    const central = new Uint8Array(46 + nb.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc32(f.data), true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nb.length, true);
    cv.setUint32(42, offset, true);
    central.set(nb, 46);
    centrals.push(central);
    offset += local.length + f.data.length;
  }
  const cdStart = offset;
  const cdLen = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdLen, true);
  ev.setUint32(16, cdStart, true);
  return Buffer.concat([...locals, ...centrals, eocd]);
}
