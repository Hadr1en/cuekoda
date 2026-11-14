import * as path from 'node:path';
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

const unescape = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = unescape(m[2]);
  return out;
}

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
  const coll = xml.slice(xml.indexOf('<COLLECTION'), xml.indexOf('</COLLECTION>') + 13);
  const out: ImportedTrack[] = [];
  for (const m of coll.matchAll(/<TRACK\b([^>]*?)(\/>|>([\s\S]*?)<\/TRACK>)/g)) {
    const a = attrs(m[1]);
    if (!a.Location) continue;
    const body = m[3] ?? '';
    const t: ImportedTrack = { path: pathFromRekordboxLocation(a.Location), source: 'rekordbox', cues: [], loops: [] };
    const bpm = Number(a.AverageBpm);
    if (bpm > 0) t.bpm = bpm;
    const tempo = /<TEMPO\b([^>]*)\/?>/.exec(body);
    if (tempo) {
      const ta = attrs(tempo[1]);
      // Battito = beat number in the bar of that marker: step back to its bar's beat 1
      const start = Number(ta.Inizio), b = Number(ta.Bpm) || bpm, beat = Number(ta.Battito) || 1;
      if (Number.isFinite(start) && b > 0) t.gridSec = start - (beat - 1) * (60 / b);
    }
    for (const pm of body.matchAll(/<POSITION_MARK\b([^>]*)\/?>/g)) {
      const p = attrs(pm[1]);
      const start = Number(p.Start);
      if (!Number.isFinite(start)) continue;
      const num = Number(p.Num ?? -1);
      if (p.Type === '4' && p.End) t.loops.push({ name: p.Name || 'Loop', startSec: start, endSec: Number(p.End) });
      else if (p.Type === '0' || p.Type === undefined) {
        const color: RGB | undefined = p.Red !== undefined ? [Number(p.Red), Number(p.Green), Number(p.Blue)] : undefined;
        t.cues.push({ slot: num >= 0 && num <= 7 ? num : -1, name: p.Name ?? '', timeSec: start, color });
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
  const coll = nml.slice(nml.indexOf('<COLLECTION'), nml.indexOf('</COLLECTION>') + 13);
  const out: ImportedTrack[] = [];
  for (const m of coll.matchAll(/<ENTRY\b[^>]*>([\s\S]*?)<\/ENTRY>/g)) {
    const body = m[1];
    const loc = /<LOCATION\b([^>]*)>/.exec(body);
    if (!loc) continue;
    const l = attrs(loc[1]);
    if (!l.FILE) continue;
    const t: ImportedTrack = { path: pathFromTraktorLocation(l.VOLUME ?? '', l.DIR ?? '/:', l.FILE, bootVolume), source: 'traktor', cues: [], loops: [] };
    const tempo = /<TEMPO\b([^>]*)>/.exec(body);
    if (tempo && Number(attrs(tempo[1]).BPM) > 0) t.bpm = Number(attrs(tempo[1]).BPM);
    const hotOf = new Set<number>();
    const raw: { a: Record<string, string>; hot: number }[] = [];
    for (const cm of body.matchAll(/<CUE_V2\b([^>]*)>/g)) {
      const a = attrs(cm[1]);
      raw.push({ a, hot: Number(a.HOTCUE ?? -1) });
    }
    for (const { a, hot } of raw) {
      const start = Number(a.START) / 1000;
      if (!Number.isFinite(start)) continue;
      if (a.TYPE === '4') {
        if (t.gridSec === undefined) t.gridSec = start;
        continue;
      }
      if (a.TYPE === '5' && Number(a.LEN) > 0) {
        t.loops.push({ name: a.NAME || 'Loop', startSec: start, endSec: start + Number(a.LEN) / 1000 });
        continue;
      }
      if (a.TYPE !== '0' && a.TYPE !== '1' && a.TYPE !== '2' && a.TYPE !== '3') continue;
      // Traktor hotcue 1 (index 0) usually holds the grid marker: hotcues 2–8 → pads A–G, as CueKoda exports.
      // A cue on hotcue 1 goes to pad H when it is free, otherwise it is kept as a memory cue.
      let slot = hot >= 1 && hot <= 7 ? hot - 1 : -1;
      if (hot === 0) slot = hotOf.has(7) ? -1 : 7;
      if (slot >= 0) hotOf.add(slot);
      t.cues.push({ slot, name: a.NAME && a.NAME !== 'n.n.' ? a.NAME : '', timeSec: start });
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
