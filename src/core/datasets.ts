import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Reference } from './evaluate';
import { beatportGenre } from './genres';
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
 *  - jamendo-vocal    : Jamendo Singing Voice — .lab intervals (sing / nosing), CC audio included by the corpus
 *  - m-djcue          : M-DJCUE — JAMS cue annotations from three independent annotators
 *  - groove           : Magenta Groove MIDI Dataset — info.csv and aligned audio performances
 *  - audioset         : Google AudioSet evaluation CSV — singing, rapping/speech and crowd kept separate
 * Each annotation is paired with the audio file of the same name stem in the audio folder.
 */
export const DATASETS = ['giantsteps-tempo', 'giantsteps-key', 'harmonix', 'ballroom', 'brid', 'raveform', 'jamendo-vocal', 'm-djcue', 'groove', 'audioset'] as const;
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
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function walkFiles(dir: string, extension: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.toLowerCase().endsWith(extension)) out.push(file);
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
  if (id === 'jamendo-vocal') return loadJamendoVocal(annotationsDir, audio);
  if (id === 'm-djcue') return loadMdjcue(annotationsDir, audio);
  if (id === 'groove') return loadGroove(annotationsDir, audio);
  if (id === 'audioset') return loadAudioSet(annotationsDir, audio);
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
  genre?: string;
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
      genre: track.genre,
      genreFamily: beatportGenre(track.genre)?.family,
      rhythm: beatportGenre(track.genre)?.rhythm,
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

function loadJamendoVocal(annotationsDir: string, audio: Map<string, string>): { refs: Reference[]; withoutAudio: number } {
  const refs: Reference[] = [];
  let withoutAudio = 0;
  const filelists = path.join(path.dirname(annotationsDir), 'filelists');
  const partitions = new Map<string, Reference['partition']>();
  for (const [file, partition] of [['train', 'train'], ['valid', 'validation'], ['test', 'test']] as const) {
    const list = path.join(filelists, file);
    if (fs.existsSync(list)) for (const name of fs.readFileSync(list, 'utf8').split(/\r?\n/).filter(Boolean)) {
      partitions.set(path.basename(name, path.extname(name)).toLowerCase(), partition);
    }
  }
  for (const annotation of walkFiles(annotationsDir, '.lab')) {
    const name = path.basename(annotation, path.extname(annotation));
    const file = audio.get(name.toLowerCase());
    if (!file) { withoutAudio++; continue; }
    const vocalSegments = fs.readFileSync(annotation, 'utf8').split(/\r?\n/).flatMap((line) => {
      const parts = line.trim().split(/\s+/);
      const startSec = Number(parts[0]), endSec = Number(parts[1]);
      const label = parts.slice(2).join(' ').toLowerCase();
      return Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec
        && /sing|voice|vocal|speech/.test(label) && !/no.?sing|instrumental|non.?vocal/.test(label)
        ? [{ startSec, endSec }] : [];
    });
    refs.push({
      ...baseRef(file, 'Jamendo Singing Voice Dataset'), vocalSegments, vocalStyle: 'unknown',
      partition: partitions.get(name.toLowerCase()),
    });
  }
  return { refs, withoutAudio };
}

interface JamsAnnotation { namespace?: string; data?: { time?: number; duration?: number; value?: unknown }[] }

function cueLabel(value: unknown): 'mixin' | 'mixout' | null {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object'
    ? String((value as Record<string, unknown>).label ?? (value as Record<string, unknown>).value ?? '') : '';
  const label = raw.trim().toUpperCase();
  if (label === 'IN' || /MIX.?IN/.test(label)) return 'mixin';
  if (label === 'OUT' || /MIX.?OUT/.test(label)) return 'mixout';
  return null;
}

function consensus(points: { time: number; kind: 'mixin' | 'mixout'; annotator: number }[], tolerance = 0.5) {
  const out: { time: number; kind: 'mixin' | 'mixout'; votes: number }[] = [];
  for (const kind of ['mixin', 'mixout'] as const) {
    const sorted = points.filter((p) => p.kind === kind).sort((a, b) => a.time - b.time);
    for (let i = 0; i < sorted.length;) {
      const cluster = [sorted[i++]];
      while (i < sorted.length && sorted[i].time - cluster[0].time <= tolerance) cluster.push(sorted[i++]);
      const byAnnotator = new Map(cluster.map((point) => [point.annotator, point.time]));
      if (byAnnotator.size >= 2) out.push({
        time: [...byAnnotator.values()].reduce((sum, value) => sum + value, 0) / byAnnotator.size,
        kind,
        votes: byAnnotator.size,
      });
    }
  }
  return out;
}

function loadMdjcue(annotationsDir: string, audio: Map<string, string>): { refs: Reference[]; withoutAudio: number } {
  const refs: Reference[] = [];
  let withoutAudio = 0;
  for (const annotation of walkFiles(annotationsDir, '.jams')) {
    const jams = JSON.parse(fs.readFileSync(annotation, 'utf8')) as {
      file_metadata?: { title?: string; identifiers?: { mirrors?: { type?: string; url?: string; offset?: number; playbackSpeed?: number }[] } };
      annotations?: JamsAnnotation[];
    };
    const name = path.basename(annotation, '.jams');
    const direct = audio.get(name.toLowerCase()) ?? audio.get(stem(jams.file_metadata?.title ?? '').toLowerCase());
    const mirrors = jams.file_metadata?.identifiers?.mirrors ?? [];
    const mirror = mirrors.find(({ url }) => {
      const videoId = /[?&]v=([^&]+)/.exec(url ?? '')?.[1] ?? /youtu\.be\/([^?]+)/.exec(url ?? '')?.[1];
      return videoId ? audio.has(videoId.toLowerCase()) : false;
    });
    const videoId = /[?&]v=([^&]+)/.exec(mirror?.url ?? '')?.[1] ?? /youtu\.be\/([^?]+)/.exec(mirror?.url ?? '')?.[1];
    const file = direct ?? (videoId ? audio.get(videoId.toLowerCase()) : undefined);
    if (!file) { withoutAudio++; continue; }
    const mapTime = (time: number) => direct ? time : time * (mirror?.playbackSpeed ?? 1) - (mirror?.offset ?? 0);
    const points = (jams.annotations ?? []).flatMap((ann, annotator) => (ann.data ?? []).flatMap((item) => {
      const kind = cueLabel(item.value);
      return kind && Number.isFinite(item.time) ? [{ time: mapTime(Number(item.time)), kind, annotator }] : [];
    }));
    const cues = consensus(points).map(({ time, kind, votes }) => ({
      kind, name: `${kind === 'mixin' ? 'Mix in' : 'Mix out'} (${votes} votes)`, timeSec: time,
    }));
    refs.push({ ...baseRef(file, 'M-DJCUE (consensus ≥2 annotators, ±0.5 s)'), title: jams.file_metadata?.title ?? name, cues });
  }
  return { refs, withoutAudio };
}

function csvRow(line: string): string[] {
  const out: string[] = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { out.push(value); value = ''; }
    else value += char;
  }
  out.push(value);
  return out;
}

function loadGroove(annotationsDir: string, audio: Map<string, string>): { refs: Reference[]; withoutAudio: number } {
  const info = fs.existsSync(path.join(annotationsDir, 'info.csv'))
    ? path.join(annotationsDir, 'info.csv') : walkFiles(annotationsDir, 'info.csv')[0];
  if (!info) throw new Error('Groove MIDI Dataset : info.csv introuvable');
  const lines = fs.readFileSync(info, 'utf8').trim().split(/\r?\n/);
  const header = csvRow(lines.shift() ?? '').map((v) => v.trim());
  const column = (row: string[], name: string) => row[header.indexOf(name)] ?? '';
  const refs: Reference[] = [];
  let withoutAudio = 0;
  for (const line of lines) {
    const row = csvRow(line);
    const audioName = column(row, 'audio_filename');
    const name = path.basename(audioName, path.extname(audioName));
    const file = audio.get(name.toLowerCase());
    if (!file) { withoutAudio++; continue; }
    const bpm = Number(column(row, 'bpm'));
    const genre = column(row, 'style') || column(row, 'genre');
    const mapped = beatportGenre(genre);
    refs.push({
      ...baseRef(file, 'Groove MIDI Dataset v1.0.0'),
      title: column(row, 'id') || name,
      bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined,
      genre,
      genreFamily: mapped?.family,
      rhythm: mapped?.rhythm ?? 'open',
      scenario: 'live',
    });
  }
  return { refs, withoutAudio };
}

const AUDIOSET_LABELS = {
  speech: '/m/09x0r', singing: '/m/015lz1', rapping: '/m/06bxc', crowd: '/m/03qtwd',
} as const;

function loadAudioSet(annotationsDir: string, audio: Map<string, string>): { refs: Reference[]; withoutAudio: number } {
  const csv = fs.statSync(annotationsDir).isFile() ? annotationsDir : path.join(annotationsDir, 'eval_segments.csv');
  const refs: Reference[] = [];
  let withoutAudio = 0;
  for (const line of fs.readFileSync(csv, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const row = csvRow(line).map((value) => value.trim());
    const [id, startRaw, endRaw] = row;
    const labels = row.slice(3).join(',').replaceAll('"', '').split(',').map((value) => value.trim());
    const start = Number(startRaw), end = Number(endRaw);
    if (!id || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const file = audio.get(id.toLowerCase())
      ?? audio.get(`${id}_${start.toFixed(3)}_${end.toFixed(3)}`.toLowerCase());
    const singing = labels.includes(AUDIOSET_LABELS.singing);
    const rapSpoken = labels.includes(AUDIOSET_LABELS.rapping) || labels.includes(AUDIOSET_LABELS.speech);
    const crowd = labels.includes(AUDIOSET_LABELS.crowd);
    if (!singing && !rapSpoken && !crowd) continue;
    if (!file) { withoutAudio++; continue; }
    const vocalStyle: Reference['vocalStyle'] = singing && rapSpoken ? 'mixed' : singing ? 'sung' : rapSpoken ? 'rap-spoken' : 'crowd';
    refs.push({
      ...baseRef(file, 'Google AudioSet evaluation split (human-labelled 10 s segment)'),
      title: id,
      partition: 'test',
      vocalStyle,
      // Clip-level labels: only crowd-without-speech is a negative. Do not invent temporal boundaries.
      vocalPresence: singing || rapSpoken,
    });
  }
  return { refs, withoutAudio };
}
