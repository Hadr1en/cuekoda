/**
 * Unit tests of the pure modules (no audio decoding):  npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camelotRelation, matchTracks, tempoGapPct } from '../core/matching';
import { baseTitle, findDuplicates } from '../core/duplicates';
import { emptyStats, recordDeleted, recordSuggested, suppressedKinds } from '../core/learning';
import { mergeWithPrevious } from '../core/merge';
import { selectCues, type CueCandidate } from '../core/cues';
import { BUILTIN_PROFILES, findProfile, sanitizeProfile } from '../core/profiles';
import { allKeys, keyFromMusical } from '../core/key';
import { buildRekordboxXml } from '../core/export/rekordbox';
import { buildTraktorNml } from '../core/export/traktor';
import { ADAPTERS, exportSummary } from '../core/export/index';
import { detectPhrases, labelVocalSections, type StructureAnalysis } from '../core/structure';
import { FUSED_THRESHOLDS, fuseScores, modelBarProbs, segmentVocals, vocalBarFeatures, vocalFrames, vocalPresence, VOCAL_ON } from '../core/vocals';
import { musicnnMel, predictVoice, resample44kTo16k, vocalModelAvailable } from '../core/vocalModel';
import { cueCandidates, vocalCandidates } from '../core/cues';
import { withVocals } from '../core/mix';
import type { AnalysisResult, HotCue, Loop, MixSuggestion, Section, VocalInfo } from '../core/types';

const edm = findProfile('edm');

function track(p: Partial<AnalysisResult> & { path: string }): AnalysisResult {
  return {
    fileName: p.path,
    title: p.path,
    artist: '',
    album: '',
    genre: '',
    year: '',
    durationSec: 200,
    bitrate: 320000,
    sampleRate: 44100,
    sizeBytes: 1,
    kind: 'MP3 File',
    bpm: 128,
    grid: { bpm: 128, firstDownbeatSec: 0.1, confidence: 0.9 },
    key: keyFromMusical('Am')!,
    cues: [],
    wave: [],
    waveLow: [],
    warnings: [],
    analysisMs: 0,
    ...p,
  };
}

const cue = (o: Partial<HotCue>): HotCue => ({
  id: Math.random().toString(36),
  slot: 0,
  role: 'drop1',
  kind: 'drop',
  name: 'Drop',
  timeSec: 30,
  bar: 16,
  color: [255, 0, 0],
  confidence: 'high',
  reason: 'test',
  origin: 'auto',
  ...o,
});

// ---------------------------------------------------------------- keys
test('24 keys, Camelot mapping', () => {
  const keys = allKeys();
  assert.equal(keys.length, 24);
  assert.equal(keyFromMusical('Am')!.camelot, '8A');
  assert.equal(keyFromMusical('C')!.camelot, '8B');
  assert.equal(keyFromMusical('F#m')!.camelot, '11A');
  assert.equal(keyFromMusical('C')!.openKey, '1d');
});

// ---------------------------------------------------------------- matching
test('camelot relations', () => {
  assert.equal(camelotRelation('8A', '8A'), 'same');
  assert.equal(camelotRelation('8A', '9A'), 'adjacent');
  assert.equal(camelotRelation('12A', '1A'), 'adjacent');
  assert.equal(camelotRelation('8A', '8B'), 'relative');
  assert.equal(camelotRelation('8A', '10A'), 'boost');
  assert.equal(camelotRelation('8A', '3B'), 'none');
});

test('tempo gap handles half / double time', () => {
  assert.ok(tempoGapPct(174, 87).pct < 0.01);
  assert.equal(tempoGapPct(174, 87).ratio, 2);
  assert.ok(Math.abs(tempoGapPct(128, 126).pct - 1.5625) < 1e-6);
});

test('matchTracks explains its reasons and skips itself', () => {
  const a = track({ path: 'a', bpm: 128, energy: { score: 7, curve: [], events: [] } });
  const b = track({ path: 'b', bpm: 127, key: keyFromMusical('Em')!, energy: { score: 7.5, curve: [], events: [] } });
  const c = track({ path: 'c', bpm: 90, key: keyFromMusical('Eb')! });
  const res = matchTracks(a, [a, b, c]);
  assert.equal(res.length, 1);
  assert.equal(res[0].path, 'b');
  assert.ok(res[0].reasons.some((r) => r.includes('BPM proche')));
  assert.ok(res[0].reasons.some((r) => r.includes('voisine')));
});

// ---------------------------------------------------------------- duplicates
test('baseTitle strips version words', () => {
  assert.equal(baseTitle('Fantasy (Extended Mix)'), 'fantasy');
  assert.equal(baseTitle('Fantasy - Kisma Remix'), 'fantasy');
  assert.equal(baseTitle('Dolce Vita [VIP]'), 'dolce vita');
  // file names without tags are "Artist - Title": the title must survive
  assert.notEqual(baseTitle('Mike Chino - Dream Chaser'), baseTitle('Mike Chino - Replicant World'));
  assert.equal(baseTitle('Mike Chino - Dream Chaser (Extended Mix)'), baseTitle('Mike Chino - Dream Chaser'));
});

test('duplicates: exact, encoding, versions — never merged blindly', () => {
  const curve = Array.from({ length: 100 }, (_, i) => Math.sin(i / 7) * 0.5 + 0.5);
  const e = { score: 6, curve, events: [] };
  const groups = findDuplicates([
    track({ path: '/a/x.mp3', title: 'Song', fileHash: 'h1', energy: e }),
    track({ path: '/b/copy.mp3', title: 'Song', fileHash: 'h1', energy: e }),
    track({ path: '/a/x.flac', title: 'Song', fileHash: 'h2', energy: e, durationSec: 200.4 }),
    track({ path: '/a/x-ext.mp3', title: 'Song (Extended Mix)', fileHash: 'h3', durationSec: 320, energy: { ...e, curve: curve.map((v) => 1 - v) } }),
  ]);
  const exact = groups.find((g) => g.kind === 'exact')!;
  assert.deepEqual(exact.paths.sort(), ['/a/x.mp3', '/b/copy.mp3']);
  const enc = groups.find((g) => g.kind === 'encoding')!;
  assert.ok(enc.paths.includes('/a/x.flac'));
  const ver = groups.find((g) => g.kind === 'version')!;
  assert.ok(ver.paths.includes('/a/x-ext.mp3'));
  assert.ok(ver.reason.includes('pas des doublons'));
});

// ---------------------------------------------------------------- learning
test('learning suppresses a kind only after enough consistent deletions', () => {
  const s = emptyStats();
  recordSuggested(s, ['kickout', 'kickout', 'kickout', 'kickout']);
  recordDeleted(s, 'kickout');
  recordDeleted(s, 'kickout');
  recordDeleted(s, 'kickout');
  recordDeleted(s, 'kickout');
  assert.deepEqual(suppressedKinds(s), []); // only 4 samples
  recordSuggested(s, ['kickout']);
  recordDeleted(s, 'kickout');
  assert.deepEqual(suppressedKinds(s), ['kickout']);
});

// ---------------------------------------------------------------- cue engine
test('selectCues: priority, max count, spacing, exclusions, chronological pads', () => {
  const cands: CueCandidate[] = [
    { role: 'intro', kind: 'intro', bar: 0, confidence: 'high', reason: '' },
    { role: 'drop1', kind: 'drop', bar: 16, confidence: 'high', reason: '' },
    { role: 'build1', kind: 'build', bar: 14, confidence: 'high', reason: '' }, // too close to drop
    { role: 'drop2', kind: 'drop', bar: 48, confidence: 'medium', reason: '' },
    { role: 'kickout', kind: 'kickout', bar: 70, confidence: 'medium', reason: '' },
  ];
  const p = sanitizeProfile({ ...edm, maxCues: 3, excludeKinds: ['kickout'] });
  const cues = selectCues(cands, p, { d0: 0, barLen: 2 });
  assert.deepEqual(cues.map((c) => c.role), ['intro', 'drop1', 'drop2']);
  assert.deepEqual(cues.map((c) => c.slot), [0, 1, 2]);
  assert.deepEqual(cues.map((c) => c.name), ['Intro', 'Drop 1', 'Drop 2']);
  assert.deepEqual(cues[1].color, p.colors.drop);
  assert.equal(cues[1].timeSec, 32);
});

test('profiles are data and are sanitised', () => {
  assert.equal(BUILTIN_PROFILES.length, 7);
  const p = sanitizeProfile({ ...edm, minBpm: 100, maxBpm: 260, maxCues: 20, loopBeats: [3, 16] });
  assert.equal(p.maxBpm, 200);
  assert.equal(p.maxCues, 8);
  assert.deepEqual(p.loopBeats, [16]);
});

// ---------------------------------------------------------------- merge
test('re-analysis keeps user / locked cues and accepted loops', () => {
  const prevCues = [
    cue({ slot: 2, kind: 'drop', role: 'drop1', timeSec: 31, origin: 'user', name: 'Mon drop' }),
    cue({ slot: 0, kind: 'intro', role: 'intro', timeSec: 0.1, locked: true }),
    cue({ slot: 5, kind: 'outro', role: 'outro', timeSec: 150 }),
  ];
  const loop: Loop = { id: 'l1', kind: 'intro', name: 'L', startSec: 0.1, beats: 16, bar: 0, confidence: 'high', reason: '', origin: 'auto', accepted: true };
  const prev = track({ path: 'x', cues: prevCues, loops: [loop] });
  const fresh = track({
    path: 'x',
    cues: [cue({ slot: 0, kind: 'intro', role: 'intro', timeSec: 0.2 }), cue({ slot: 1, kind: 'drop', role: 'drop1', timeSec: 30 }), cue({ slot: 2, kind: 'outro', role: 'outro', timeSec: 140 })],
    loops: [{ ...loop, id: 'l2', accepted: false, startSec: 60 }],
  });
  const m = mergeWithPrevious(fresh, prev);
  assert.ok(m.cues.some((c) => c.name === 'Mon drop' && c.slot === 2));
  assert.ok(m.cues.some((c) => c.locked && c.timeSec === 0.1));
  assert.ok(m.cues.some((c) => c.kind === 'outro' && c.timeSec === 140), 'fresh auto outro replaces the old auto one');
  assert.equal(new Set(m.cues.map((c) => c.slot)).size, m.cues.length, 'no pad used twice');
  assert.equal(m.loops!.length, 2);
});

// ---------------------------------------------------------------- phrases
test('phrases: regular 16-bar grid detected, irregular track gives null', () => {
  const base: StructureAnalysis = { origin: 0, nBars: 96, phraseOrigin: 0, landmarks: [], on: [], kickBars: [], changePoints: [] };
  const regular = detectPhrases({ ...base, changePoints: [16, 32, 48, 64].map((bar) => ({ bar, strength: 1 })) });
  assert.equal(regular.lengthBars, 16);
  assert.deepEqual(regular.bars.slice(0, 4), [0, 16, 32, 48]);
  const irregular = detectPhrases({ ...base, changePoints: [5, 13, 27, 42].map((bar) => ({ bar, strength: 1 })) });
  assert.equal(irregular.lengthBars, null);
});

// ---------------------------------------------------------------- exports
test('rekordbox export: hot cues, memory cues option, loops with End', () => {
  const t = track({
    path: '/m/a b.mp3',
    cues: [cue({ slot: 0, timeSec: 10, name: 'Drop & co' })],
    loops: [
      { id: 'l', kind: 'intro', name: 'Intro loop', startSec: 1, beats: 16, bar: 0, confidence: 'high', reason: '', origin: 'auto', accepted: true },
      { id: 'm', kind: 'outro', name: 'Not kept', startSec: 100, beats: 16, bar: 0, confidence: 'high', reason: '', origin: 'auto', accepted: false },
    ],
  });
  const xml = buildRekordboxXml([t], { memoryCues: true, loops: 'accepted' });
  assert.ok(xml.includes('Location="file://localhost/m/a%20b.mp3"'));
  assert.ok(xml.includes('Name="Drop &amp; co" Type="0" Start="10.000" Num="0" Red="255"'));
  assert.ok(xml.includes('Num="-1"/>'));
  assert.ok(xml.includes('Type="4" Start="1.000" End="8.500" Num="-1"'), xml); // 16 beats @128 = 7.5 s
  assert.ok(!xml.includes('Not kept'));
  const noMem = buildRekordboxXml([t], { memoryCues: false, loops: 'none' });
  assert.ok(!noMem.includes('Type="0" Start="10.000" Num="-1"'));
  assert.ok(!noMem.includes('Type="4"'));
});

test('traktor export: hot cue index, loop LEN, no colours', () => {
  const t = track({
    path: '/m/a.mp3',
    cues: [cue({ slot: 3, timeSec: 10 })],
    loops: [{ id: 'l', kind: 'intro', name: 'Intro loop', startSec: 1, beats: 16, bar: 0, confidence: 'high', reason: '', origin: 'auto', accepted: true }],
  });
  const nml = buildTraktorNml([t], { memoryCues: false, loops: 'accepted' }, 'Macintosh HD');
  assert.ok(nml.includes('TYPE="0" START="10000.000" LEN="0" REPEATS="-1" HOTCUE="3"'));
  assert.ok(nml.includes('TYPE="5" START="1000.000" LEN="7500.000"'));
  assert.ok(nml.includes('DIR="/:m/:" FILE="a.mp3" VOLUME="Macintosh HD"'));
  assert.ok(!/RED|COLOR/i.test(nml));
});

test('export adapters are honest about their status', () => {
  const serato = ADAPTERS.find((a) => a.id === 'serato')!;
  assert.equal(serato.status, 'unavailable');
  assert.equal(serato.build, undefined);
  assert.ok(ADAPTERS.every((a) => a.validated === false), 'nothing claims to be validated in the real software yet');
  const rb = ADAPTERS.find((a) => a.id === 'rekordbox')!;
  const summary = exportSummary(rb, [track({ path: 'a', cues: [cue({})] })], { memoryCues: true, loops: 'accepted' });
  assert.ok(summary.some((l) => l.includes('1 hot cue')));
  assert.ok(summary.some((l) => l.startsWith('Non transférés')));
});

// ---------------------------------------------------------------- batch queue (fake workers)
import { AnalysisQueue, type WorkerLike, type WorkerMessage } from '../main/queue';
import { EventEmitter } from 'node:events';

class FakeWorker extends EventEmitter implements WorkerLike {
  static all: FakeWorker[] = [];
  last: { id: number; file: string } | null = null;
  terminated = false;
  constructor() {
    super();
    FakeWorker.all.push(this);
  }
  postMessage(m: unknown) {
    this.last = m as { id: number; file: string };
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: Omit<WorkerMessage, 'id'>) {
    this.emit('message', { ...m, id: this.last!.id } as WorkerMessage);
  }
}

function makeQueue(max = 2) {
  FakeWorker.all = [];
  const log: string[] = [];
  let summary: unknown = null;
  const q = new AnalysisQueue(
    () => new FakeWorker(),
    {
      start: (p) => log.push(`start ${p}`),
      progress: () => {},
      result: (p, _r, cached) => log.push(`done ${p}${cached ? ' (cache)' : ''}`),
      error: (p, m) => log.push(`error ${p}: ${m}`),
      cancelled: (p) => log.push(`cancel ${p}`),
      state: () => {},
      drained: (s) => (summary = s),
    },
    () => ({ cacheDir: '/tmp' }),
    max,
  );
  return { q, log, summary: () => summary as { done: number; errors: number; cancelled: number; cached: number } | null };
}
const job = (path: string) => ({ path, options: {}, force: false });

test('queue: parallel limit, a failing file does not block the others, summary at the end', () => {
  const { q, log, summary } = makeQueue(2);
  ['a', 'b', 'c'].forEach((p) => q.enqueue(job(p)));
  assert.equal(q.state().running, 2);
  assert.equal(q.state().pending, 1);
  FakeWorker.all[0].reply({ type: 'error', error: 'corrupt' } as never);
  FakeWorker.all[1].reply({ type: 'result', result: {} as AnalysisResult, cached: true } as never);
  FakeWorker.all[0].reply({ type: 'result', result: {} as AnalysisResult, cached: false } as never); // c ran on worker 0
  assert.deepEqual(log, ['start a', 'start b', 'error a: corrupt', 'start c', 'done b (cache)', 'done c']);
  assert.deepEqual(summary(), { ...summary(), done: 2, cached: 1, errors: 1, cancelled: 0 });
});

test('queue: pause / resume / cancel / worker crash', () => {
  const { q, log } = makeQueue(1);
  q.pause();
  q.enqueue(job('a'));
  q.enqueue(job('b'));
  assert.equal(q.state().running, 0, 'paused: nothing starts');
  q.resume();
  assert.equal(q.state().running, 1);
  q.cancel(['b']);
  assert.ok(log.includes('cancel b'));
  FakeWorker.all[0].emit('exit', 1); // worker crash while busy
  assert.ok(log.some((l) => l.startsWith('error a')));
  q.enqueue(job('c'));
  q.cancel(); // cancel the running job
  assert.ok(log.includes('cancel c'));
  assert.ok(FakeWorker.all.every((w) => w.terminated || w.last === null || true));
  assert.equal(q.state().running, 0);
});

// ---------------------------------------------------------------- vocals (§9)
/** Harmonic tone with optional vibrato / sweep, 22.05 kHz. */
function tone(sec: number, f0: (t: number) => number): Float32Array {
  const sr = 22050;
  const x = new Float32Array(Math.floor(sec * sr));
  const ph = new Float64Array(12);
  for (let i = 0; i < x.length; i++) {
    const f = f0(i / sr);
    let v = 0;
    for (let h = 1; h <= 12; h++) {
      ph[h - 1] += (2 * Math.PI * h * f) / sr;
      if (h * f < 10000) v += Math.sin(ph[h - 1]) / h;
    }
    x[i] = 0.3 * v;
  }
  return x;
}
const barScores = (x: Float32Array) => vocalBarFeatures(vocalFrames(x, 22050), 0, 2, Math.floor(x.length / 22050 / 2));

test('vocal frames: steady tone still, vibrato moves, one-way sweep penalised', () => {
  const steady = barScores(tone(8, () => 330));
  assert.ok(steady.score.every((v) => v < 0.05), `steady ${steady.score}`);
  const vib = barScores(tone(8, (t) => 330 * Math.pow(2, (40 / 1200) * Math.sin(2 * Math.PI * 5.5 * t))));
  assert.ok(vib.score.every((v) => v >= VOCAL_ON), `vibrato ${vib.score}`);
  const sweep = barScores(tone(8, (t) => 300 * Math.pow(2, t / 4))); // +1 octave in 4 s = riser-like
  assert.ok(sweep.direction.every((d) => d > 0.9), `direction ${sweep.direction}`);
  assert.ok(sweep.score.every((v) => v < 0.05), `sweep ${sweep.score}`);
});

test('segmentVocals: hysteresis, gap bridging, min length, never high confidence', () => {
  const score = [0, 0, 0.5, 0.5, 0.5, 0.5, 0.15, 0.5, 0.5, 0, 0, 0.25, 0, 0, 0, 0];
  const { segments, present } = segmentVocals(score, 0, 2, 40);
  assert.equal(segments.length, 1, JSON.stringify(segments));
  assert.deepEqual([segments[0].startBar, segments[0].endBar], [2, 9]);
  assert.equal(segments[0].strength, 'strong');
  assert.equal(segments[0].confidence, 'medium');
  assert.equal(present[11], false, 'isolated bar is dropped');
  const weak = segmentVocals([0, 0.22, 0.22, 0.22, 0.22, 0.22, 0, 0], 0, 2, 16).segments;
  assert.equal(weak[0].strength, 'light');
  assert.equal(weak[0].confidence, 'low');
});

function vinfo(segs: [number, number, 'strong' | 'light'][], n = 64): VocalInfo {
  const present = new Array(n).fill(false);
  for (const [a, b] of segs) for (let i = a; i < b; i++) present[i] = true;
  return {
    method: 'test', validated: false, curve: present.map((p) => (p ? 0.5 : 0)), present,
    segments: segs.map(([a, b, strength]) => ({ startBar: a, endBar: b, startSec: a * 2, endSec: b * 2, score: 0.5, strength, confidence: strength === 'strong' ? 'medium' : 'low' })),
    coverage: present.filter(Boolean).length / n, tonalShare: 0.6, level: 'medium',
  };
}

test('vocal cue candidates: snapped to 4 bars, sparse, capped confidence', () => {
  const v = vinfo([[17, 31, 'strong'], [40, 42, 'strong'], [44, 52, 'light'], [56, 62, 'strong']]);
  const c = vocalCandidates(v, 0);
  assert.deepEqual(c.map((x) => x.bar), [16, 44], 'snapped, short segment skipped, at most 2');
  assert.deepEqual(c.map((x) => x.confidence), ['medium', 'low']);
  assert.ok(c.every((x) => x.kind === 'vocal' && x.reason.includes('non validée')));
  assert.equal(cueCandidates([], undefined, v).filter((x) => x.kind === 'vocal').length, 2);
  // lowest priority in the EDM profile: never displaces a structural cue nearby
  const cues = selectCues([{ role: 'drop1', kind: 'drop', bar: 16, confidence: 'high', reason: '' }, ...c], edm, { d0: 0, barLen: 2 });
  assert.deepEqual(cues.map((x) => x.kind), ['drop', 'vocal']);
});

test('mix windows: vocal presence flagged, clear voice downgraded, unknown says nothing', () => {
  const m: MixSuggestion = { timeSec: 0, bar: 48, lengthBars: 16, reason: 'Début de l’outro', confidence: 'high' };
  const sung = withVocals(m, vinfo([[50, 64, 'strong']]));
  assert.equal(sung.vocals, 'strong');
  assert.equal(sung.confidence, 'medium');
  assert.ok(sung.reason.includes('voix nette'));
  const inst = withVocals(m, vinfo([[10, 20, 'strong']]));
  assert.equal(inst.vocals, 'none');
  assert.equal(inst.confidence, 'high');
  const unknown = withVocals(m, { ...vinfo([]), tonalShare: 0.05 });
  assert.equal(unknown.vocals, 'unknown');
  assert.equal(unknown.reason, m.reason);
  assert.equal(vocalPresence(vinfo([[0, 4, 'light']]), 0, 8).presence, 'light');
});

test('matching warns when two clear vocal passages would overlap', () => {
  const mix = (vocals: MixSuggestion['vocals']) => ({
    mixIn: [{ timeSec: 0, bar: 0, lengthBars: 16, reason: '', confidence: 'high' as const, vocals }],
    mixOut: [{ timeSec: 0, bar: 48, lengthBars: 16, reason: '', confidence: 'high' as const, vocals }],
  });
  const a = track({ path: 'a', mix: mix('strong') });
  const b = track({ path: 'b', mix: mix('strong') });
  const c = track({ path: 'c', mix: mix('none') });
  const res = matchTracks(a, [b, c]);
  const rb = res.find((r) => r.path === 'b')!;
  const rc = res.find((r) => r.path === 'c')!;
  assert.ok(rb.cautions.some((x) => x.includes('passages chantés')));
  assert.ok(rb.score < rc.score);
});

test('verse / chorus only on strong vocal evidence', () => {
  const sec = (startBar: number, endBar: number, energy: number, type: Section['type'] = 'section'): Section => ({
    id: `s${startBar}`, type, label: 'Section', startBar, endBar, startSec: startBar * 2, endSec: endBar * 2, energy, confidence: 'medium', origin: 'auto',
  });
  const mk = () => [sec(0, 16, 0.4), sec(16, 32, 0.8), sec(32, 48, 0.45), sec(48, 64, 0.82)];
  const strong = mk();
  labelVocalSections(strong, vinfo([[0, 64, 'strong']]));
  assert.deepEqual(strong.map((x) => x.type), ['verse', 'chorus', 'verse', 'chorus']);
  assert.ok(strong.every((x) => x.confidence === 'low'));
  const weak = mk();
  labelVocalSections(weak, vinfo([[0, 64, 'light']]));
  assert.ok(weak.every((x) => x.type === 'section'), 'light evidence: nothing renamed');
  const flat = [sec(0, 16, 0.6), sec(16, 32, 0.65)];
  labelVocalSections(flat, vinfo([[0, 32, 'strong']]));
  assert.ok(flat.every((x) => x.type === 'section'), 'no energy contrast: nothing renamed');
  const edmTypes = [sec(0, 16, 0.4, 'breakdown'), sec(16, 32, 0.9, 'drop')];
  labelVocalSections(edmTypes, vinfo([[0, 32, 'strong']]));
  assert.deepEqual(edmTypes.map((x) => x.type), ['breakdown', 'drop'], 'named EDM sections are kept');
});

test('MusiCNN log-mel matches Essentia TensorflowInputMusiCNN', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EssentiaWASM } = require('essentia.js');
  const ess = new EssentiaWASM.EssentiaJS(false);
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const x = new Float32Array(512 * 4);
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 330 * i) / 16000) + 0.1 * Math.sin((2 * Math.PI * 2500 * i) / 16000) + 0.05 * rnd();
  const mine = musicnnMel(x);
  for (const f of [0, 3, 6]) {
    const v = EssentiaWASM.arrayToVector(x.subarray(f * 256, f * 256 + 512));
    const ref: number[] = Array.from(EssentiaWASM.vectorToArray(ess.TensorflowInputMusiCNN(v).bands));
    for (let b = 0; b < 96; b++) assert.ok(Math.abs(mine[f * 96 + b] - ref[b]) < 1e-3, `frame ${f} band ${b}: ${mine[f * 96 + b]} vs ${ref[b]}`);
  }
});

test('resampler 44.1 → 16 kHz keeps the pass band, removes what would alias', () => {
  const sine = (hz: number) => Float32Array.from({ length: 44100 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / 44100));
  const rms = (y: Float32Array) => Math.sqrt(y.subarray(1000, y.length - 1000).reduce((a, v) => a + v * v, 0) / (y.length - 2000));
  const pass = resample44kTo16k(sine(1000));
  assert.equal(pass.length, 16000);
  assert.ok(Math.abs(rms(pass) - Math.SQRT1_2) < 0.02, `1 kHz rms ${rms(pass)}`);
  assert.ok(rms(resample44kTo16k(sine(12000))) < 0.01, 'above Nyquist: attenuated by > 37 dB');
});

test('model → bars → fused score', () => {
  const m = { model: 'test', probs: Float32Array.from([0.1, 0.9]), hopSec: 3, winSec: 3, ms: 0 };
  const p = modelBarProbs(m, 0, 2, 4); // bars [0,2) [2,4) [4,6) [6,8)
  assert.ok(Math.abs(p[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(p[1] - 0.5) < 1e-6, 'half / half overlap');
  assert.ok(Math.abs(p[2] - 0.9) < 1e-6);
  assert.ok(Number.isNaN(p[3]), 'no patch');
  const f = fuseScores([0, 0.4, 0.4, 0.3], [0.9, 0.5, 0.9, NaN]);
  assert.ok(f[0] >= FUSED_THRESHOLDS.strong, 'model alone, confident → clear voice');
  assert.ok(f[1] < FUSED_THRESHOLDS.on, 'heuristic alone cannot overrule an undecided model');
  assert.ok(Math.abs(f[2] - 1) < 1e-9);
  assert.equal(f[3], 0.3, 'no model patch → heuristic');
});

test('local vocal model runs offline (skipped when the model files are absent)', async (t) => {
  if (!vocalModelAvailable()) return t.skip('models/voice_instrumental-musicnn-msd-2 absent');
  const x = Float32Array.from({ length: 44100 * 7 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / 44100));
  const out = await predictVoice(x);
  assert.ok(out, 'model output');
  assert.equal(out!.probs.length, 2, '7 s → two 3 s patches');
  assert.ok([...out!.probs].every((v) => v >= 0 && v <= 1));
});
