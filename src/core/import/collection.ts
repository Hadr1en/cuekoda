import * as path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { cueAt } from '../cues';
import { mergeWithPrevious } from '../merge';
import { CUE_KIND_LABEL } from '../profiles';
import type { AnalysisResult, CueKind, HotCue, Loop, RGB } from '../types';

/**
 * Reads an existing DJ collection (rekordbox XML export, Traktor collection.nml) so the DJ's own cues are
 * respected: they come into CueKoda as locked cues on their pads, and CueKoda's suggestions only fill the
 * empty pads. Read-only: the collection file is never modified.
 */
export interface ImportedCue {
  /** pad 0–7, or −1 for a memory cue */
  slot: number;
  name: string;
  timeSec: number;
  color?: RGB;
}

export interface ImportedTrack {
  path: string;
  source: 'rekordbox' | 'traktor';
  bpm?: number;
  /** a beat of the DJ software's grid (rekordbox: first TEMPO marker; Traktor: first grid marker) */
  gridSec?: number;
  cues: ImportedCue[];
  loops: { name: string; startSec: number; endSec: number }[];
}

function parseCollectionXml(xml: string, root: 'DJ_PLAYLISTS' | 'NML'): Element {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('XML invalide : les déclarations DOCTYPE ne sont pas autorisées');
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (message) => errors.push(String(message)),
      fatalError: (message) => errors.push(String(message)),
    },
  }).parseFromString(xml, 'application/xml');
  if (errors.length) throw new Error(`XML invalide : ${errors[0]}`);
  if (doc.documentElement?.tagName !== root) throw new Error(`XML invalide : racine ${root} attendue`);
  const collection = doc.getElementsByTagName('COLLECTION').item(0);
  if (!collection) throw new Error('XML invalide : collection absente');
  return collection;
}

const elements = (parent: Element, name: string): Element[] =>
  Array.from({ length: parent.getElementsByTagName(name).length }, (_, i) => parent.getElementsByTagName(name).item(i)).filter((x): x is Element => !!x);

const attr = (element: Element, name: string): string | undefined => element.getAttribute(name) ?? undefined;

/** rekordbox Location (file://localhost/Users/…, file://localhost/C:/…) → OS path. */
export function pathFromRekordboxLocation(loc: string): string {
  let p = loc.replace(/^file:\/\/localhost/i, '').replace(/^file:\/\//i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep it raw */
  }
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
  return p;
}

export function parseRekordboxXml(xml: string): ImportedTrack[] {
  const coll = parseCollectionXml(xml, 'DJ_PLAYLISTS');
  const out: ImportedTrack[] = [];
  for (const track of elements(coll, 'TRACK')) {
    const location = attr(track, 'Location');
    if (!location) continue;
    const t: ImportedTrack = { path: pathFromRekordboxLocation(location), source: 'rekordbox', cues: [], loops: [] };
    const bpm = Number(attr(track, 'AverageBpm'));
    if (bpm > 0) t.bpm = bpm;
    const tempo = track.getElementsByTagName('TEMPO').item(0);
    if (tempo) {
      // Battito = beat number in the bar of that marker: step back to its bar's beat 1
      const start = Number(attr(tempo, 'Inizio'));
      const b = Number(attr(tempo, 'Bpm')) || bpm;
      const beat = Number(attr(tempo, 'Battito')) || 1;
      if (Number.isFinite(start) && b > 0) t.gridSec = start - (beat - 1) * (60 / b);
    }
    for (const mark of elements(track, 'POSITION_MARK')) {
      const start = Number(attr(mark, 'Start'));
      if (!Number.isFinite(start)) continue;
      const type = attr(mark, 'Type');
      const num = Number(attr(mark, 'Num') ?? -1);
      const end = attr(mark, 'End');
      if (type === '4' && end !== undefined) t.loops.push({ name: attr(mark, 'Name') || 'Loop', startSec: start, endSec: Number(end) });
      else if (type === '0' || type === undefined) {
        const red = attr(mark, 'Red');
        const color: RGB | undefined = red !== undefined
          ? [Number(red), Number(attr(mark, 'Green')), Number(attr(mark, 'Blue'))]
          : undefined;
        t.cues.push({ slot: num >= 0 && num <= 7 ? num : -1, name: attr(mark, 'Name') ?? '', timeSec: start, color });
      }
    }
    out.push(t);
  }
  return out;
}

/** Traktor LOCATION → OS path (macOS: the boot volume is "/", other volumes live in /Volumes). */
export function pathFromTraktorLocation(volume: string, dir: string, file: string, bootVolume: string): string {
  const rel = dir.replace(/\/:/g, '/');
  if (/^[A-Za-z]:$/.test(volume)) return `${volume}${rel}${file}`.replace(/\//g, '\\');
  const base = !volume || volume === bootVolume ? '' : `/Volumes/${volume}`;
  return path.posix.join(base || '/', rel, file);
}

export function parseTraktorNml(nml: string, bootVolume = 'Macintosh HD'): ImportedTrack[] {
  const coll = parseCollectionXml(nml, 'NML');
  const out: ImportedTrack[] = [];
  for (const entry of elements(coll, 'ENTRY')) {
    const loc = entry.getElementsByTagName('LOCATION').item(0);
    if (!loc) continue;
    const file = attr(loc, 'FILE');
    if (!file) continue;
    const t: ImportedTrack = {
      path: pathFromTraktorLocation(attr(loc, 'VOLUME') ?? '', attr(loc, 'DIR') ?? '/:', file, bootVolume),
      source: 'traktor', cues: [], loops: [],
    };
    const tempo = entry.getElementsByTagName('TEMPO').item(0);
    if (tempo && Number(attr(tempo, 'BPM')) > 0) t.bpm = Number(attr(tempo, 'BPM'));
    const hotOf = new Set<number>();
    for (const cue of elements(entry, 'CUE_V2')) {
      const hot = Number(attr(cue, 'HOTCUE') ?? -1);
      const start = Number(attr(cue, 'START')) / 1000;
      if (!Number.isFinite(start)) continue;
      const type = attr(cue, 'TYPE');
      if (type === '4') {
        if (t.gridSec === undefined) t.gridSec = start;
        continue;
      }
      const len = Number(attr(cue, 'LEN'));
      if (type === '5' && len > 0) {
        t.loops.push({ name: attr(cue, 'NAME') || 'Loop', startSec: start, endSec: start + len / 1000 });
        continue;
      }
      if (type !== '0' && type !== '1' && type !== '2' && type !== '3') continue;
      // Traktor hotcue 1 (index 0) usually holds the grid marker: hotcues 2–8 → pads A–G, as CueKoda exports.
      // A cue on hotcue 1 goes to pad H when it is free, otherwise it is kept as a memory cue.
      let slot = hot >= 1 && hot <= 7 ? hot - 1 : -1;
      if (hot === 0) slot = hotOf.has(7) ? -1 : 7;
      if (slot >= 0) hotOf.add(slot);
      const name = attr(cue, 'NAME');
      t.cues.push({ slot, name: name && name !== 'n.n.' ? name : '', timeSec: start });
    }
    out.push(t);
  }
  return out;
}

/** "Drop 2", "Intro", "Mix Out" → cue kind (custom when the name says nothing CueKoda knows). */
export function kindFromName(name: string): CueKind {
  const n = name.toLowerCase();
  for (const [k, label] of Object.entries(CUE_KIND_LABEL) as [CueKind, string][]) {
    if (k !== 'custom' && n.startsWith(label.toLowerCase())) return k;
  }
  return 'custom';
}

const DEFAULT_IMPORT_COLOR: RGB = [180, 180, 190];

/**
 * Puts the collection's cues into an analysed track: they become locked cues on their own pads (a CueKoda
 * cue already on such a pad, or at the same position, gives way — moved to a memory cue or dropped), loops
 * become accepted loops, and the automatic suggestions only take the pads that are still free.
 */
export function applyImport(r: AnalysisResult, imp: ImportedTrack, opts: { strictSlots?: boolean } = {}): AnalysisResult {
  const barLen = (4 * 60) / r.bpm;
  const label = imp.source === 'rekordbox' ? 'rekordbox' : 'Traktor';
  const imported: HotCue[] = [];
  for (const c of imp.cues) {
    if (cueAt(imported, c.timeSec)) continue; // rekordbox stores hot cues twice (pad + memory) when asked
    const kind = kindFromName(c.name);
    imported.push({
      id: `imp${imported.length}${Math.round(c.timeSec * 1000).toString(36)}`,
      slot: c.slot >= 0 && !imported.some((x) => x.slot === c.slot) ? c.slot : -1,
      role: 'custom',
      kind,
      name: c.name || (c.slot >= 0 ? `Cue ${'ABCDEFGH'[c.slot]}` : 'Memory'),
      bar: Math.round((c.timeSec - r.grid.firstDownbeatSec) / barLen),
      timeSec: c.timeSec,
      color: c.color ?? DEFAULT_IMPORT_COLOR,
      confidence: 'high',
      reason: `Importé de ${label} (cue du DJ, verrouillé)`,
      origin: 'user',
      locked: true,
    });
  }
  // a hot cue that also exists as a memory cue keeps only its pad version
  const cues = imported.filter((c) => c.slot >= 0 || !imported.some((o) => o !== c && o.slot >= 0 && Math.abs(o.timeSec - c.timeSec) < 0.03));
  const pads = new Set(cues.filter((c) => c.slot >= 0).map((c) => c.slot));
  // the DJ's earlier CueKoda edits stay, unless the collection already has a cue there
  const keptUser = r.cues
    .filter((c) => (c.origin === 'user' || c.locked) && !cueAt(cues, c.timeSec))
    .map((c) => (c.slot >= 0 && pads.has(c.slot) ? { ...c, slot: -1 } : c));
  const loops: Loop[] = imp.loops.map((l, i) => ({
    id: `impl${i}`, kind: 'custom', name: l.name, startSec: l.startSec, bar: Math.round((l.startSec - r.grid.firstDownbeatSec) / barLen),
    beats: Math.max(1, Math.round((l.endSec - l.startSec) / (60 / r.bpm))), confidence: 'high',
    reason: `Importée de ${label}`, origin: 'user', accepted: true, locked: true,
  }));
  const prev: AnalysisResult = { ...r, cues: [...cues, ...keptUser], loops: [...loops, ...(r.loops ?? []).filter((l) => l.origin === 'user' || l.locked || l.accepted)] };
  return { ...mergeWithPrevious(r, prev, opts), importedFrom: { source: imp.source, cues: cues.length, loops: loops.length } };
}
