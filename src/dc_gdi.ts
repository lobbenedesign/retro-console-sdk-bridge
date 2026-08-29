/**
 * 📀 Supporto immagini GDI Dreamcast — parse + filesystem della traccia dati.
 *
 * Formato GDI verificato su dreamcast.wiki/GDI_format (la wiki di riferimento
 * della scena DC): file TESTO, prima riga = numero tracce, poi una riga per
 * traccia con token numerici e il nome file come ULTIMO token. Esistono due
 * layout di riga (5 e 8 campi): noi parsiamo in modo robusto — numero traccia
 * = primo token, nome file = ultimo, dimensione settore dal token "2048"
 * (tracce dati con ECC stripped) vs "2352" (CDDA raw).
 *
 * La traccia dati (canonicamente track03.bin, LBA 45000) è ISO9660 a settori
 * 2048 che parte con IP.BIN: il PVD sta a settore 16 RELATIVO alla traccia —
 * riusiamo direttamente il nostro parser ISO9660 (src/psp_iso.ts, già
 * verificato). Il GDI è multi-file: il client carica uno ZIP con dentro
 * .gdi + tracce (riusiamo il lettore ZIP nativo).
 *
 * Onestà dichiarata: CDI (DiscJuggler) NON supportato — formato binario più
 * complesso; convertire a GDI con gli strumenti della community (es.
 * GDIBuilder di sappharad). MDS/CHD nemmeno (CHD merita un modulo a sé).
 */

import { unzip } from "./zip_reader";
import { IsoReader } from "./psp_cso";
import { listIsoFiles, extractIsoFile, type IsoEntry } from "./psp_iso";

export interface GdiTrack {
  number: number;
  file: string;
  sectorSize: number; // 2048 = dati, 2352 = audio
  isData: boolean;
}

export interface GdiInfo {
  gdiName: string;
  trackCount: number;
  tracks: GdiTrack[];
  dataTrackFile: string;
  dataTrackSize: number;
}

/** Parsa il testo .gdi. La traccia dati è quella con settore 2048. */
export function parseGdi(text: string): GdiInfo {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("File GDI vuoto.");
  const trackCount = Number(lines[0]);
  if (!Number.isFinite(trackCount) || trackCount < 1) throw new Error("Prima riga del GDI non è un numero di tracce valido.");

  const tracks: GdiTrack[] = [];
  for (const line of lines.slice(1)) {
    const tokens = line.split(/\s+/);
    if (tokens.length < 3) continue;
    const number = Number(tokens[0]);
    // il nome file è il token non numerico (colonna variabile tra i due layout
    // documentati: 5 campi = "...file size", 8 campi = "...size lba file")
    const file = tokens.find((t) => /\D/.test(t));
    if (!file) continue;
    // la dimensione settore è l'unico token numerico 2048/2352 della riga
    const sizeToken = tokens.map(Number).find((n) => n === 2048 || n === 2352);
    const sectorSize = sizeToken ?? 2352;
    if (!Number.isFinite(number)) continue;
    tracks.push({ number, file, sectorSize, isData: sectorSize === 2048 });
  }

  const dataTrack = tracks.find((t) => t.isData);
  if (!dataTrack) throw new Error("Nessuna traccia dati (settore 2048) nel GDI: immagine audio-only o corrotta.");
  return { gdiName: "", trackCount, tracks, dataTrackFile: dataTrack.file, dataTrackSize: 0 };
}

/** Cerca il .gdi dentro i byte di uno ZIP e lo parsifica. */
export function findGdiInZip(zipBytes: Uint8Array): { info: GdiInfo; entries: Map<string, Uint8Array> } {
  const entriesList = unzip(zipBytes);
  const entries = new Map(entriesList.map((e) => [e.name.toLowerCase(), e.data]));
  const gdiEntry = entriesList.find((e) => e.name.toLowerCase().endsWith(".gdi"));
  if (!gdiEntry) throw new Error("Nessun file .gdi nello ZIP caricato (servono .gdi + tracce).");
  const info = parseGdi(new TextDecoder().decode(gdiEntry.data));
  info.gdiName = gdiEntry.name;
  const trackFile = entries.get(info.dataTrackFile.toLowerCase());
  if (!trackFile) throw new Error(`Traccia dati "${info.dataTrackFile}" mancante nello ZIP.`);
  info.dataTrackSize = trackFile.length;
  return { info, entries };
}

export interface DcGdiListing extends GdiInfo {
  systemId: string;
  volumeId: string;
  entries: IsoEntry[];
  isLikelyDreamcast: boolean;
}

/** Elenca il filesystem ISO9660 della traccia dati di un GDI in ZIP. */
export function listGdiFiles(zipBytes: Uint8Array): DcGdiListing {
  const { info, entries } = findGdiInZip(zipBytes);
  const trackFile = entries.get(info.dataTrackFile.toLowerCase())!;
  const reader = new IsoReader(trackFile);
  const listing = listIsoFiles(reader);
  return {
    ...info,
    systemId: listing.systemId,
    volumeId: listing.volumeId,
    entries: listing.entries,
    // IP.BIN boot header "SEGA SEGAKATANA" nei primi 16 byte della traccia dati
    isLikelyDreamcast: String.fromCharCode(...trackFile.slice(0, 15)) === "SEGA SEGAKATANA",
  };
}

/** Estrae un file dal filesystem della traccia dati. */
export function extractGdiFile(zipBytes: Uint8Array, path: string): Uint8Array {
  const { info, entries } = findGdiInZip(zipBytes);
  const reader = new IsoReader(entries.get(info.dataTrackFile.toLowerCase())!);
  const listing = listIsoFiles(reader);
  return extractIsoFile(reader, listing.entries, path);
}
