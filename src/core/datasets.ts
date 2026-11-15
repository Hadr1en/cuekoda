import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Reference } from './evaluate';
import { keyFromTonic } from './key';
import { AUDIO_EXTENSIONS, type SectionType } from './types';

/**
 * Public annotated datasets as CueKoda references (evaluation only — audio is never shipped):
 *  - giantsteps-tempo : GiantSteps Tempo (EDM from Beatport) — annotations/<id>.bpm, one number
 *  - giantsteps-key   : GiantSteps Key (EDM from Beatport) — annotations/<id>.key, e.g. "Eb minor"
 *  - harmonix         : Harmonix Set — beats_and_downbeats/<id>.txt ("time beat bar") and optionally
 *                       segments/<id>.txt ("time label"); the audio must be obtained separately
 *  - ballroom         : CPJKU BallroomAnnotations — <id>.beats ("time beat-in-bar")
 *  - brid             : BRID ensemble recordings — beats/<id>.beats and tempo/<id>.bpm
 *  - raveform         : Raveform EDM annotations — structures/segments.json and structures/beats/<key>.beat.csv
 * Each annotation is paired with the audio file of the same name stem in the audio folder.
 */
export const DATASETS = ['giantsteps-tempo', 'giantsteps-key', 'harmonix', 'ballroom', 'brid', 'raveform'] as const;
export type DatasetId = typeof DATASETS[number];

const stem = (f: string) => path.basename(f).replace(/\.(bpm|key|txt|beats|LOFI)$/i, '').replace(/\.LOFI$/i, '');

/** Audio files indexed by stem, preserving case for case-sensitive video IDs. */
function audioIndex(dir: string, caseSensitive: boolean): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (AUDIO_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) {
        const name = e.name.slice(0, -path.extname(e.name).length);
        out.set(caseSensitive ? name : stem(name).toLowerCase(), p);
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
  const audio = audioIndex(audioDir, id === 'raveform');
  if (id === 'raveform') return loadRaveform(annotationsDir, audio);
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
    const annotatedPart = id !== 'harmonix';
    const annotationsSubdir = id === 'brid' ? 'beats' : 'beats_and_downbeats';
    const beatsSubdir = path.join(annotationsDir, annotationsSubdir);
    const beatsDir = fs.existsSync(beatsSubdir) ? beatsSubdir : annotationsDir;
    const segDir = path.join(annotationsDir, 'segments');
    for (const f of files(beatsDir, annotatedPart ? '.beats' : '.txt')) {
      const a = find(f);
      if (!a) { withoutAudio++; continue; }
      const rows = fs.readFileSync(path.join(beatsDir, f), 'utf8').trim().split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([time]) => Number.isFinite(time) && time >= 0);
      const beats = rows.map(([time]) => time);
      if (beats.length < 8) continue;
      const ref = baseRef(a, id);
      ref.beats = beats;
      ref.downbeats = rows.filter((r) => r[1] === 1).map((r) => r[0]);
      const ibi = median(beats.slice(1).map((t, i) => t - beats[i]));
      ref.bpm = ibi > 0 ? 60 / ibi : undefined;
      if (ref.downbeats.length) ref.firstDownbeatSec = ref.downbeats[0];
      if (annotatedPart) {
        ref.beatWindow = [beats[0], beats[beats.length - 1]];
        const barLengths = new Map<number, number>();
        let previous = -1;
        for (const [index, [, beat]] of rows.entries()) {
          if (beat !== 1) continue;
          if (previous >= 0) {
            const length = index - previous;
            barLengths.set(length, (barLengths.get(length) ?? 0) + 1);
          }
          previous = index;
        }
        ref.beatsPerBar = [...barLengths].sort(([, a], [, b]) => b - a)[0]?.[0];
      }
      if (id === 'brid') {
        const tempoFile = path.join(annotationsDir, 'tempo', `${stem(f)}.bpm`);
        const tempo = fs.existsSync(tempoFile) ? Number(fs.readFileSync(tempoFile, 'utf8').trim()) : 0;
        if (Number.isFinite(tempo) && tempo > 0) ref.bpm = tempo;
      }
      const segFile = path.join(segDir, f);
      if (id === 'harmonix' && fs.existsSync(segFile)) {
        ref.sections = fs.readFileSync(segFile, 'utf8').trim().split(/\r?\n/)
          .map((l) => l.trim().split(/\s+/))
          .filter((p) => p.length > 1 && Number.isFinite(Number(p[0])) && p[1].toLowerCase() !== 'end')
          .map((p) => ({ type: 'section' as const, label: p.slice(1).join(' '), startSec: Number(p[0]) }));
      }
      refs.push(ref);
    }
  }
  return { refs, withoutAudio };
}


interface RaveformTrack {
  id: string;
  key: string;
  title: string;
  average_bpm: number;
  sections: { name: string; start: number }[];
}

const raveformSectionTypes: Readonly<Record<string, SectionType>> = {
  intro: 'intro', altintro: 'intro', buildup: 'build', breakdown: 'breakdown',
  drop: 'drop', outro: 'outro', altoutro: 'outro',
};

function loadRaveform(annotationsDir: string, audio: Map<string, string>): { refs: Reference[]; withoutAudio: number } {
  const index = path.join(annotationsDir, 'segments.json');
  const dir = fs.existsSync(index) ? annotationsDir : path.join(annotationsDir, 'structures');
  const tracks: RaveformTrack[] = JSON.parse(fs.readFileSync(path.join(dir, 'segments.json'), 'utf8'));
  const refs: Reference[] = [];
  let withoutAudio = 0;
  for (const track of tracks) {
    const file = audio.get(track.id);
    if (!file) { withoutAudio++; continue; }
    const beatFile = path.join(dir, 'beats', `${track.key}.beat.csv`);
    const [, ...lines] = fs.readFileSync(beatFile, 'utf8').trim().split(/\r?\n/);
    const rows = lines.map((line) => line.split(','))
      .filter(([time, beat]) => time.trim() !== '' && Number.isFinite(Number(time)) && Number(time) >= 0
        && Number.isInteger(Number(beat)) && Number(beat) > 0);
    if (rows.length < 8) continue;
    const beats = rows.map(([time]) => Number(time));
    const downbeats = rows.filter(([, beat]) => Number(beat) === 1).map(([time]) => Number(time));
    refs.push({
      ...baseRef(file, 'raveform'),
      title: track.title,
      bpm: track.average_bpm,
      firstDownbeatSec: downbeats[0],
      beats,
      downbeats,
      beatWindow: [beats[0], beats[beats.length - 1]],
      sections: track.sections.filter(({ name }) => name !== 'end')
        .map(({ name, start }) => ({ type: raveformSectionTypes[name] ?? 'section', label: name, startSec: start })),
    });
  }
  return { refs, withoutAudio };
}
