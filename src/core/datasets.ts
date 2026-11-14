import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Reference } from './evaluate';
import { keyFromTonic } from './key';
import { AUDIO_EXTENSIONS } from './types';

/**
 * Public annotated datasets as CueKoda references (evaluation only — audio is never shipped):
 *  - giantsteps-tempo : GiantSteps Tempo (EDM from Beatport) — annotations/<id>.bpm, one number
 *  - giantsteps-key   : GiantSteps Key (EDM from Beatport) — annotations/<id>.key, e.g. "Eb minor"
 *  - harmonix         : Harmonix Set — beats_and_downbeats/<id>.txt ("time beat bar") and optionally
 *                       segments/<id>.txt ("time label"); the audio must be obtained separately
 * Each annotation is paired with the audio file of the same name stem in the audio folder.
 */
export type DatasetId = 'giantsteps-tempo' | 'giantsteps-key' | 'harmonix';
export const DATASETS: DatasetId[] = ['giantsteps-tempo', 'giantsteps-key', 'harmonix'];

const stem = (f: string) => path.basename(f).replace(/\.(bpm|key|txt|LOFI)$/i, '').replace(/\.LOFI$/i, '');

/** Audio files of a folder indexed by stem (case-insensitive, ".LOFI" suffix ignored). */
function audioIndex(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (AUDIO_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) {
        out.set(stem(e.name.slice(0, -path.extname(e.name).length)).toLowerCase(), p);
      }
    }
  };
  walk(dir);
  return out;
}

/** "Eb minor", "C# major", "a:min" → musical tonic + scale (null when not a single key). */
export function parseKeyLabel(label: string): { tonic: string; scale: 'major' | 'minor' } | null {
  const m = /^\s*([A-Ga-g])\s*([#b♯♭]?)\s*[:\s]?\s*(maj(?:or)?|min(?:or)?)\b/i.exec(label);
  if (!m) return null;
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  return { tonic: m[1].toUpperCase() + acc, scale: /^min/i.test(m[3]) ? 'minor' : 'major' };
}

const baseRef = (audio: string, source: string): Reference => ({
  version: 1, fileHash: '', path: audio, fileName: path.basename(audio), title: path.basename(audio),
  createdAt: '', engineVersion: 'dataset', source,
});

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

/** Builds references for a dataset; annotations without audio are counted, not silently dropped. */
export function loadDataset(id: DatasetId, annotationsDir: string, audioDir: string): { refs: Reference[]; withoutAudio: number } {
  const audio = audioIndex(audioDir);
  const refs: Reference[] = [];
  let withoutAudio = 0;
  const files = (dir: string, ext: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext)) : []);
  const find = (f: string) => audio.get(stem(f).toLowerCase());

  if (id === 'giantsteps-tempo' || id === 'giantsteps-key') {
    const ext = id === 'giantsteps-tempo' ? '.bpm' : '.key';
    for (const f of files(annotationsDir, ext)) {
      const a = find(f);
      if (!a) { withoutAudio++; continue; }
      const text = fs.readFileSync(path.join(annotationsDir, f), 'utf8').trim();
      const ref = baseRef(a, id);
      if (id === 'giantsteps-tempo') {
        const bpm = Number(text.split(/\s+/)[0]);
        if (!(bpm > 0)) continue;
        ref.bpm = bpm;
      } else {
        const k = parseKeyLabel(text);
        const res = k && keyFromTonic(k.tonic, k.scale, 1);
        if (!res) continue;
        ref.key = res.musical;
        ref.keyCamelot = res.camelot;
      }
      refs.push(ref);
    }
  } else {
    const beatsDir = fs.existsSync(path.join(annotationsDir, 'beats_and_downbeats')) ? path.join(annotationsDir, 'beats_and_downbeats') : annotationsDir;
    const segDir = path.join(annotationsDir, 'segments');
    for (const f of files(beatsDir, '.txt')) {
      const a = find(f);
      if (!a) { withoutAudio++; continue; }
      const rows = fs.readFileSync(path.join(beatsDir, f), 'utf8').trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number));
      const beats = rows.map((r) => r[0]).filter((t) => Number.isFinite(t));
      if (beats.length < 8) continue;
      const ref = baseRef(a, id);
      ref.beats = beats;
      ref.downbeats = rows.filter((r) => r[1] === 1).map((r) => r[0]);
      const ibi = median(beats.slice(1).map((t, i) => t - beats[i]));
      ref.bpm = ibi > 0 ? 60 / ibi : undefined;
      if (ref.downbeats.length) ref.firstDownbeatSec = ref.downbeats[0];
      const segFile = path.join(segDir, f);
      if (fs.existsSync(segFile)) {
        ref.sections = fs.readFileSync(segFile, 'utf8').trim().split(/\r?\n/)
          .map((l) => l.trim().split(/\s+/))
          .filter((p) => Number.isFinite(Number(p[0])))
          .map((p) => ({ type: 'section' as const, label: p.slice(1).join(' '), startSec: Number(p[0]) }));
      }
      refs.push(ref);
    }
  }
  return { refs, withoutAudio };
}
