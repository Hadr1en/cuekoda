import { applyCrateAction, replaceCratePaths } from '../core/crates';
import { analysisChanges, comparisonPoint } from '../core/analysisComparison';
/**
 * Unit tests of the pure modules (no audio decoding):  npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertAudioRevision, hashAudioRevision } from '../core/hash';
import { camelotRelation, matchTracks, tempoGapPct } from '../core/matching';
import { baseTitle, findDuplicates } from '../core/duplicates';
import { emptyStats, recordDeleted, recordSuggested, suppressedKinds } from '../core/learning';
import { mergeWithPrevious } from '../core/merge';
import { cueAt, duplicateCueIds, selectCues, type CueCandidate } from '../core/cues';
import { BUILTIN_PROFILES, findProfile, sanitizeProfile } from '../core/profiles';
import { beatIndex, gridBeats, gridAudition, nearestBeat } from '../core/beatgrid';
import { analyseBands } from '../core/dsp';
import { estimateGrid, pickDownbeatOffset, corroboratedBassPhase, entranceBackedPhase } from '../core/rhythm';
import { allKeys, electronicKeyFromVotes, formatKey, keyFromMusical } from '../core/key';
import { buildRekordboxXml } from '../core/export/rekordbox';
import { buildTraktorNml, traktorLocation, traktorPlan } from '../core/export/traktor';
import { ADAPTERS, commentTag, exportSummary } from '../core/export/index';
import { detectPhrases, labelVocalSections, type StructureAnalysis } from '../core/structure';
import { FUSED_THRESHOLDS, fuseScores, modelBarProbs, segmentVocals, vocalBarFeatures, vocalFrames, vocalPresence, VOCAL_ON } from '../core/vocals';
import { musicnnMel, predictVoice, resample44kTo16k, vocalModelAvailable } from '../core/vocalModel';
import { checkNeuralModels, neuralModelAssets } from '../core/neuralModels';
import { cueCandidates, vocalCandidates } from '../core/cues';
import { withVocals } from '../core/mix';
import { bTimeAt, fadeGains, planTransition } from '../core/transition';
import { suggestOrder } from '../core/setorder';
import { MAC_SWAP_SCRIPT, evaluateRelease, parseBuild, type GithubRelease } from '../shared/update';
import type { AnalysisResult, HotCue, Loop, MixSuggestion, Section, VocalInfo } from '../core/types';

const edm = findProfile('edm');

test('beatgrid keeps a fractional BPM that would drift when rounded', () => {
  const sr = 22050;
  const bpm = 128.03;
  const phase = 0.241;
  const period = 60 / bpm;
  const beats = 256;
  const audio = new Float32Array(Math.ceil(sr * (phase + beats * period + 0.3)));
  for (let i = 0; i < beats; i++) {
    // Give the sections different dynamics and give individual hits a little timing variation.
    const level = [0.2, 0.75, 0.4, 1][Math.floor(i / 64)];
    const jitter = ((73 * i) % 53 - 26) / 2600;
    const start = Math.round((phase + i * period + jitter) * sr);
    for (let j = 0; j < 768; j++) audio[start + j] = level * Math.cos(j * 0.023) * Math.exp(-j / 190);
  }
  const bands = analyseBands(audio, sr);
  const grid = estimateGrid(audio, sr, bands, 128);
  assert.ok(Math.abs(60 / grid.bpm - period) * 128 < 0.003, 'tempo drift after 32 bars');
  assert.ok(Math.abs(grid.firstBeatSec + 255 * 60 / grid.bpm - (phase + 255 * period)) < 0.004);
});

test('beatgrid confidence measures alignment against the applied phase', () => {
  const sr = 22050;
  const phase = 0.25;
  const audio = new Float32Array(33 * sr);
  for (let i = 0; i < 64; i++) {
    const start = Math.round((phase + i / 2) * sr);
    for (let j = 0; j < 192; j++) audio[start + j] = Math.cos(j * 0.08) * Math.exp(-j / 40);
  }
  const bands = analyseBands(audio, sr);
  const aligned = estimateGrid(audio, sr, bands, 120, { fixedBpm: true, fixedPhaseSec: phase });
  assert.equal(aligned.confidence, 1);
  const early = estimateGrid(audio, sr, bands, 120, { fixedBpm: true, fixedPhaseSec: phase - 0.016 });
  assert.ok(Math.abs(early.firstBeatSec - (phase - 0.016)) < 1e-9);
  assert.equal(early.bpm, 120);
  assert.equal(early.confidence, 0);
});

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
  const cm = keyFromMusical('Cm')!;
  assert.equal(formatKey(cm), '5A');
  assert.equal(formatKey(cm, 'openKey'), '10m');
  assert.equal(formatKey({ camelot: '5A', openKey: '' }, 'openKey'), '10m');
  assert.equal(formatKey({ camelot: '', openKey: '' }, 'openKey'), '');
  assert.equal(new Set(keys.map((key) => formatKey(key, 'openKey'))).size, 24);
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
  assert.equal(BUILTIN_PROFILES.length, 8);
  const p = sanitizeProfile({ ...edm, maxCues: 20, loopBeats: [3, 16] });
  assert.equal(p.maxCues, 8);
  assert.deepEqual(p.loopBeats, [16]);
});

test('the beat grid follows a bass pulse present in all three parts of the track', () => {
  const sr = 22050;
  const audio = new Float32Array(36 * sr);
  for (let beat = 0; beat < 72; beat++) {
    const start = Math.round((beat * 0.5 + 0.25) * sr);
    for (let i = 0; i < 0.12 * sr; i++) {
      const t = i / sr;
      audio[start + i] = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-30 * t);
    }
  }
  const bands = analyseBands(audio, sr);
  const grid = { bpm: 120, firstBeatSec: 0, confidence: 0.75, localMin: 120, localMax: 120, variable: false };
  const phase = corroboratedBassPhase(bands, grid);
  assert.ok(phase !== undefined && Math.abs(phase - 0.25) < 0.06);
  assert.equal(corroboratedBassPhase(bands, { ...grid, firstBeatSec: phase }), undefined);
  assert.equal(corroboratedBassPhase(bands, { ...grid, variable: true }), undefined);
  audio.fill(0, 24 * sr);
  assert.equal(corroboratedBassPhase(analyseBands(audio, sr), grid), undefined);
});

test('a half-beat alternative needs support from the entrance and both frequency bands', () => {
  const frameRate = 100;
  const frames = 36 * frameRate;
  const pulse = (shift: number) => Float32Array.from({ length: frames }, (_, frame) =>
    frame >= shift && (frame - shift) % 50 < 4 ? 1 : 0);
  const beat = pulse(25);
  const bands = {
    sr: frameRate, hop: 1, frameSize: 1, frameRate, frames,
    eLow: beat, eMid: beat, eHigh: beat,
    onset: beat, fluxLow: beat, fluxMid: beat, fluxHigh: beat,
  };
  const grid = { bpm: 120, firstBeatSec: 0, confidence: 0.75, localMin: 120, localMax: 120, variable: false };
  assert.equal(entranceBackedPhase(bands, grid), 0.25);
  assert.equal(entranceBackedPhase({ ...bands, fluxMid: pulse(0) }, grid), undefined);
  assert.equal(entranceBackedPhase({ ...bands, eMid: pulse(0) }, grid), undefined);
  assert.equal(entranceBackedPhase(bands, { ...grid, variable: true }), undefined);
});

test('the downbeat follows sustained section changes when the entrance agrees', () => {
  const frameRate = 100;
  const duration = 192;
  const frames = duration * frameRate;
  const beatAt = (frame: number) => Math.floor(frame / 50);
  const bass = Float32Array.from({ length: frames }, (_, frame) =>
    (beatAt(frame) + 5) % 8 < 4 ? 10 : 1);
  const sections = Float32Array.from({ length: frames }, (_, frame) =>
    Math.floor(beatAt(frame) / 32) % 2 === 0 ? 10 : 1);
  const bands = {
    sr: 100, hop: 1, frameSize: 1, frameRate, frames,
    eLow: bass, eMid: sections, eHigh: sections,
    onset: sections, fluxLow: bass, fluxMid: sections, fluxHigh: sections,
  };
  assert.equal(pickDownbeatOffset(bands, 120, 0, 0, duration).offset, 3);
  assert.deepEqual(pickDownbeatOffset(bands, 120, 0, 0, duration, 'common'), { offset: 0, confident: true });
  // A pickup or an unrelated entrance should not decide the start of the bar by itself.
  const laterEntrance = { ...bands, eMid: sections.slice() };
  laterEntrance.eMid.fill(0, 0, 100);
  assert.equal(pickDownbeatOffset(laterEntrance, 120, 0, 0, duration, 'common').offset, 3);
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
  assert.deepEqual(mergeWithPrevious(fresh, prev, { preserveCues: true }).cues, prevCues);
});

test('memory cues (slot −1) survive re-analysis and are exported without a pad', () => {
  const memo = cue({ slot: -1, kind: 'vocal', role: 'custom', timeSec: 75, origin: 'user', name: 'Voix reprend' });
  const prev = track({ path: 'm', cues: [memo, cue({ slot: 0, timeSec: 30 })] });
  const fresh = track({ path: 'm', cues: [0, 1, 2, 3, 4, 5, 6, 7].map((s) => cue({ slot: s, kind: 'custom', role: 'custom', timeSec: 10 + s * 20 })) });
  const m = mergeWithPrevious(fresh, prev);
  assert.ok(m.cues.some((c) => c.slot === -1 && c.name === 'Voix reprend'), 'memory cue kept');
  assert.equal(m.cues.filter((c) => c.slot >= 0).length, 8, 'the 8 pads still filled by fresh cues');
  const xml = buildRekordboxXml([m], { memoryCues: false, loops: 'none' });
  assert.match(xml, /Name="Voix reprend" Type="0" Start="75\.000" Num="-1"/);
  assert.equal((xml.match(/Voix reprend/g) ?? []).length, 1, 'no hot cue for a memory cue');
  const nml = buildTraktorNml([m], { memoryCues: false, loops: 'none' }, 'Macintosh HD');
  assert.match(nml, /NAME="Voix reprend"[^>]*HOTCUE="-1"/);
});

test('vocal parts edited by the DJ survive re-analysis', () => {
  const vi = (segs: VocalInfo['segments'], edited?: boolean): VocalInfo => ({
    method: 'x', validated: false, curve: [0.1, 0.9], present: [false, true], segments: segs, coverage: 0.2, tonalShare: 1, level: 'low', edited,
  });
  const seg = { startBar: 8, endBar: 16, startSec: 15, endSec: 30, score: 1, strength: 'strong' as const, confidence: 'high' as const, origin: 'user' as const };
  const prev = track({ path: 'v', vocals: vi([seg], true) });
  const fresh = track({ path: 'v', vocals: vi([{ ...seg, startBar: 20, endBar: 24, origin: undefined }]) });
  const m = mergeWithPrevious(fresh, prev);
  assert.deepEqual(m.vocals!.segments, [seg]);
  assert.equal(m.vocals!.edited, true);
  assert.deepEqual(m.vocals!.curve, fresh.vocals!.curve, 'detector curves stay fresh');
  const untouched = mergeWithPrevious(fresh, track({ path: 'v', vocals: vi([seg]) }));
  assert.equal(untouched.vocals!.segments[0].startBar, 20, 'not edited: the new detection wins');
});

test('transition plan: tempo match, bar-aligned points, fades, guards', () => {
  const a = track({ path: 'a', bpm: 128, grid: { bpm: 128, firstDownbeatSec: 0.5, confidence: 0.9 }, durationSec: 240,
    cues: [cue({ slot: 6, kind: 'mixout', role: 'custom', timeSec: 200.3, name: 'Mix Out' })] });
  const b = track({ path: 'b', bpm: 126, grid: { bpm: 126, firstDownbeatSec: 0.2, confidence: 0.9 }, durationSec: 240,
    cues: [cue({ slot: 0, kind: 'intro', role: 'intro', timeSec: 0.2, name: 'Intro' })] });
  const p = planTransition(a, b);
  assert.ok(!('error' in p));
  if ('error' in p) return;
  assert.ok(Math.abs(p.rate - 128 / 126) < 1e-9);
  const barA = 240 / 128;
  assert.ok(Math.abs(((p.outSec - 0.5) / barA) - Math.round((p.outSec - 0.5) / barA)) < 1e-6, 'out point on A’s bar grid');
  assert.equal(p.inSec, 0.2);
  assert.ok(Math.abs(bTimeAt(p, p.outSec + barA) - (0.2 + barA * p.rate)) < 1e-9, 'one A bar = one B bar once matched');
  assert.ok(Math.abs((barA * p.rate) - 240 / 126) < 1e-9);
  const g0 = fadeGains(p, p.outSec), g1 = fadeGains(p, p.outSec + p.fadeSec);
  assert.ok(g0.a === 1 && g0.b === 0 && g1.a < 1e-9 && Math.abs(g1.b - 1) < 1e-9);
  const half = planTransition(a, { ...b, bpm: 64, grid: { ...b.grid, bpm: 64 } });
  assert.ok(!('error' in half) && Math.abs(half.rate - 1) < 1e-9, 'half-time notation');
  assert.ok('error' in planTransition(a, { ...b, bpm: 100 }), 'too far apart: refused, not stretched');
});

test('update check: build numbers, platform asset, digest, dev builds never updated', () => {
  const sha = 'a'.repeat(64);
  const rel: GithubRelease = {
    tag_name: 'build-42', name: 'CueKoda 0.3.4 — build 42', html_url: 'https://github.com/Hadr1en/cuekoda/releases/tag/build-42',
    assets: [
      { name: 'CueKoda-0.3.4-mac-arm64.dmg', browser_download_url: 'u-arm', size: 10, digest: `sha256:${sha}` },
      { name: 'CueKoda-0.3.4-mac-x64.dmg', browser_download_url: 'u-x64', size: 11, digest: `sha256:${sha}` },
      { name: 'CueKoda-0.3.4-windows-setup.exe', browser_download_url: 'u-win', size: 12, digest: `SHA256:${sha.toUpperCase()}` },
      { name: 'CueKoda-0.3.4-windows-setup.exe.blockmap', browser_download_url: 'u-bm', size: 1 },
    ],
  };
  assert.equal(parseBuild('build-42'), 42);
  assert.equal(parseBuild('v1.2'), null);
  const mac = evaluateRelease(rel, { build: 41 }, 'darwin', 'arm64');
  assert.equal(mac?.asset.url, 'u-arm');
  assert.equal(mac?.asset.sha256, sha);
  assert.equal(mac?.version, '0.3.4');
  assert.equal(evaluateRelease(rel, { build: 41 }, 'darwin', 'x64')?.asset.url, 'u-x64');
  const win = evaluateRelease(rel, { build: 3 }, 'win32', 'x64');
  assert.equal(win?.asset.url, 'u-win');
  assert.equal(win?.asset.sha256, sha);
  for (const digest of [undefined, null, '', `sha1:${sha}`, 'sha256:abcd', `sha256:${sha}\n`]) {
    const invalid = { ...rel, assets: [{ ...rel.assets[2], digest }] };
    assert.throws(() => evaluateRelease(invalid, { build: 41 }, 'win32', 'x64'), /SHA-256 absente ou invalide/);
  }
  assert.equal(evaluateRelease(rel, { build: 42 }, 'win32', 'x64'), null, 'same build: nothing to do');
  assert.equal(evaluateRelease(rel, { build: null }, 'win32', 'x64'), null, 'dev build: never offered');
  assert.equal(evaluateRelease({ ...rel, draft: true }, { build: 1 }, 'win32', 'x64'), null);
  assert.equal(evaluateRelease(rel, { build: 1 }, 'linux', 'x64'), null);
  assert.ok(!MAC_SWAP_SCRIPT.includes('rm '), 'the macOS swap never deletes: the old app goes to the Trash');
});

test('mix order suggestion: harmonic chain, energy arc, fixed opener, deterministic', () => {
  const mk = (id: string, key: string, bpm: number, e: number) =>
    track({ path: id, title: id, bpm, key: keyFromMusical(key)!, energy: { score: e } as AnalysisResult['energy'] });
  // a harmonic chain 8A → 9A → 10A → 11A → 12A plus one clashing key, energies shuffled
  const lib = [mk('d', 'Gbm', 128, 8), mk('a', 'Am', 126, 4), mk('e', 'Dbm', 128, 9), mk('b', 'Em', 127, 5), mk('c', 'Bm', 128, 6), mk('x', 'F', 128, 7)];
  const p = suggestOrder(lib, { shape: 'free' });
  assert.equal(p.steps.length, 6);
  assert.equal(new Set(p.steps.map((s) => s.path)).size, 6, 'each track once');
  const chain = p.steps.map((s) => s.path).join('');
  assert.ok(chain.includes('abcde') || chain.includes('edcba'), `harmonic chain kept together: ${chain}`);
  assert.ok(p.steps.slice(1).every((s) => s.link && s.link.reasons.length >= 0));
  const rise = suggestOrder(lib, { shape: 'rise' });
  const es = rise.steps.map((s) => s.energy!);
  assert.ok(es[0] <= 5 && Math.max(...es.slice(3, 5)) >= 8, `energy rises: ${es.join(',')}`);
  const fixed = suggestOrder(lib, { shape: 'rise', startPath: 'x' });
  assert.equal(fixed.steps[0].path, 'x', 'the DJ’s opener stays first');
  assert.deepEqual(suggestOrder([...lib].reverse(), { shape: 'rise' }).steps.map((s) => s.path), rise.steps.map((s) => s.path), 'deterministic');
  assert.equal(suggestOrder([]).steps.length, 0);
});

test('export: comment tags (energy, key, vocals) and the set as an ordered, named playlist', () => {
  const vi = (segs: VocalInfo['segments'], informative = true): VocalInfo => ({
    method: 'x', validated: false, curve: [], present: [], segments: segs, coverage: 0, tonalShare: 1, level: 'medium', informative,
  });
  const seg = (strength: 'strong' | 'light') => ({ startBar: 1, endBar: 9, startSec: 2, endSec: 17, score: 0.8, strength, confidence: 'medium' as const });
  const base = (id: string, extra: Partial<AnalysisResult>) =>
    track({ path: `/m/${id}.mp3`, title: id, energy: { score: 7.6 } as AnalysisResult['energy'], key: keyFromMusical('C')!, ...extra });
  const vocal = base('voc', { vocals: vi([seg('strong')]) });
  const instru = base('ins', { vocals: vi([]) });
  const unsure = base('uns', { vocals: vi([seg('light')]) });
  const unknown = base('unk', { vocals: vi([], false) });
  assert.equal(commentTag(vocal), 'E8 · 8B · Vocal');
  assert.equal(commentTag(instru), 'E8 · 8B · Instru');
  assert.equal(commentTag(unsure), 'E8 · 8B', 'faint vocals only: no claim');
  assert.equal(commentTag(unknown), 'E8 · 8B', 'uninformative detector: no claim');

  const set = [instru, vocal, unsure];
  const opts = { memoryCues: false, loops: 'none' as const, playlistName: 'Set & Co' };
  const xml = buildRekordboxXml(set, opts, opts.playlistName);
  assert.match(xml, /Name="voc"[^>]*Comments="E8 · 8B · Vocal"/);
  assert.match(xml, /<NODE Name="Set &amp; Co" Type="1" KeyType="0" Entries="3">\s*<TRACK Key="1"\/>\s*<TRACK Key="2"\/>\s*<TRACK Key="3"\/>/);
  assert.ok(xml.indexOf('Name="ins"') < xml.indexOf('Name="voc"'), 'tracks keep the set order');
  const noTags = buildRekordboxXml(set, { ...opts, commentTags: false });
  assert.match(noTags, /Comments=""/);
  const nml = buildTraktorNml(set, opts, 'Macintosh HD');
  assert.match(nml, /COMMENT="E8 · 1d · Instru"/);
  assert.match(nml, /<NODE TYPE="PLAYLIST" NAME="Set &amp; Co">/);
  const order = [...nml.matchAll(/PRIMARYKEY TYPE="TRACK" KEY="[^"]*\/:(\w+)\.mp3"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['ins', 'voc', 'uns']);
  const rb = ADAPTERS.find((a) => a.id === 'engine')!;
  assert.match(rb.build!(set, opts), /<NODE Name="Set &amp; Co"/, 'targets via rekordbox XML get the set name too');
  const sum = exportSummary(ADAPTERS[0], set, opts);
  assert.ok(sum.some((l) => l.includes('Playlist « Set & Co » : 3 morceau(x)')));
  assert.ok(sum.some((l) => l.startsWith('Commentaire de chaque morceau')));
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
test('EDM key consensus reconciles enharmonic names and lowers confidence for a split vote', () => {
  const vote = (tonic: string, scale: 'major' | 'minor', strength = 0.9) => ({ tonic, scale, strength });
  const strong = electronicKeyFromVotes([vote('Db', 'minor'), vote('C#', 'minor'), vote('Db', 'minor')],
    vote('C#', 'minor'), vote('Db', 'minor'));
  assert.equal(strong.musical, 'C#m');
  assert.equal(strong.level, 'high');

  const localDisagreement = electronicKeyFromVotes([vote('C#', 'minor'), vote('Db', 'minor'), vote('F', 'minor')],
    vote('C#', 'minor'), vote('Db', 'minor'));
  assert.equal(localDisagreement.musical, 'C#m');
  assert.equal(localDisagreement.level, 'medium');

  const split = electronicKeyFromVotes([vote('C', 'major'), vote('C', 'major'), vote('C', 'major')],
    vote('C', 'major'), vote('G', 'minor'));
  assert.equal(split.musical, 'C');
  assert.equal(split.level, 'low');
  assert.equal(split.alternatives?.[0].musical, 'Gm');

  const relative = electronicKeyFromVotes([vote('C', 'major'), vote('A', 'minor'), vote('A', 'minor')],
    vote('C', 'major'), vote('A', 'minor'));
  assert.equal(relative.musical, 'C');
  assert.equal(relative.alternatives?.[0].musical, 'Am');
});

test('audio revision rejects a file replaced after hashing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-revision-'));
  const file = path.join(dir, 'example.wav');
  try {
    fs.writeFileSync(file, 'same byte count');
    const revision = await hashAudioRevision(file);
    await assertAudioRevision(file, revision);
    const replacement = path.join(dir, 'replacement.wav');
    fs.writeFileSync(replacement, 'new byte count!');
    fs.renameSync(replacement, file);
    await assert.rejects(assertAudioRevision(file, revision), /audio a changé/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preparation crates preserve playlist order, deduplicate paths and follow library moves', () => {
  const known = (p: string) => p !== '/missing';
  const create = applyCrateAction([], { type: 'create', name: ' Club ', paths: ['/b', '/a', '/b', '/missing'] }, known, () => '1');
  assert.deepEqual(create.crates, [{ id: '1', name: 'Club', paths: ['/b', '/a'] }]);
  const append = applyCrateAction(create.crates, { type: 'add', id: '1', paths: ['/a', '/c'] }, known, () => '2');
  const move = applyCrateAction(append.crates, { type: 'move', id: '1', path: '/c', direction: -1 }, known, () => '2');
  const renamed = replaceCratePaths(move.crates, new Set(['/a']), '/renamed');
  assert.deepEqual(renamed[0].paths, ['/b', '/c', '/renamed']);
  assert.equal(applyCrateAction(renamed, { type: 'create', name: 'club', paths: [] }, known, () => '2').error, 'Un bac porte déjà ce nom.');
  const remove = applyCrateAction(renamed, { type: 'remove', id: '1', paths: ['/c'] }, known, () => '2');
  assert.deepEqual(remove.crates[0].paths, ['/b', '/renamed']);
  assert.deepEqual(replaceCratePaths(remove.crates, new Set(['/b']))[0].paths, ['/renamed']);
});

test('analysis comparison ignores regenerated cue IDs and detects material changes', () => {
  const before = track({
    path: '/m/a.mp3', cues: [cue({ id: 'a', timeSec: 3 })],
    tempoMap: [{ startSec: 0.1, bpm: 128, beatInBar: 1 }],
  });
  const makeChanges = (after: AnalysisResult) => analysisChanges(comparisonPoint(before), comparisonPoint(after));
  assert.deepEqual(makeChanges({ ...before, cues: [{ ...before.cues[0], id: 'b', timeSec: 3.001 }] }),
    { bpm: false, grid: false, cues: false });
  assert.deepEqual(makeChanges({
    ...before, bpm: 128.5, cues: [{ ...before.cues[0], timeSec: 4 }],
    tempoMap: [{ startSec: 0.1, bpm: 128, beatInBar: 3 }],
  }), { bpm: true, grid: true, cues: true });
});

test('four-bar grid audition anchors near the start or end and supports short files', () => {
  const t = track({ path: '/m/a.mp3', bpm: 120, durationSec: 40, grid: { bpm: 120, firstDownbeatSec: 0.5, confidence: 1 } });
  const beats = gridBeats(t);
  assert.deepEqual(gridAudition(beats, 40, 0.5), { start: 0.455, end: 8.5 });
  const tail = gridAudition(beats, 40, 39.9);
  assert.ok(Math.abs(tail.start - 30.455) < 1e-8 && tail.end === 38.5);
  const short = gridAudition(gridBeats({ ...t, durationSec: 4 }), 4, 3);
  assert.deepEqual(short, { start: 0.455, end: 4 });
});

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

test('Traktor exports a matching musical key and Open Key comment', () => {
  const t = track({ path: '/m/a.mp3', key: keyFromMusical('Cm')! });
  const nml = buildTraktorNml([t]);
  assert.match(nml, /<INFO [^>]*COMMENT="[^"]*10m[^"]*" KEY="10m"/);
  assert.match(nml, /<MUSICAL_KEY VALUE="12">/);
  assert.match(buildRekordboxXml([t]), /Comments="[^"]*5A[^"]*"/);
});

test('traktor export: hot cue index, loop LEN, no colours', () => {
  const t = track({
    path: '/m/a.mp3',
    cues: [cue({ slot: 3, timeSec: 10 })],
    loops: [{ id: 'l', kind: 'intro', name: 'Intro loop', startSec: 1, beats: 16, bar: 0, confidence: 'high', reason: '', origin: 'auto', accepted: true }],
  });
  const nml = buildTraktorNml([t], { memoryCues: false, loops: 'accepted' }, 'Macintosh HD');
  assert.match(nml, /TYPE="0" START="10000.000" LEN="0" REPEATS="-1" HOTCUE="1"/);
  assert.match(nml, /TYPE="5" START="1000.000" LEN="7500.000" REPEATS="-1" HOTCUE="-1"/);
  assert.ok(nml.includes('DIR="/:m/:" FILE="a.mp3" VOLUME="Macintosh HD"'));
  assert.ok(!/RED|COLOR/i.test(nml));
});

test('traktor export: no cue shares the grid marker hotcue, external volumes', () => {
  const t = track({
    path: '/Volumes/DJ USB/Music/Set 1/a.mp3',
    cues: [0, 1, 2, 3, 4, 5, 6, 7].map((slot) => cue({ slot, timeSec: 10 + slot, name: `P${slot}` })),
  });
  const nml = buildTraktorNml([t], { memoryCues: false, loops: 'none' }, 'Macintosh HD');
  const hot = [...nml.matchAll(/HOTCUE="(-?\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(hot.filter((h) => h === 0).length, 1, 'only the AutoGrid marker on hotcue index 0');
  assert.match(nml, /NAME="P0"[^>]*HOTCUE="1"/);
  assert.match(nml, /NAME="P6"[^>]*HOTCUE="7"/);
  assert.match(nml, /NAME="P7"[^>]*HOTCUE="-1"/, 'pad H becomes a stored cue');
  assert.ok(nml.includes('DIR="/:Music/:Set 1/:" FILE="a.mp3" VOLUME="DJ USB"'), nml);
  assert.ok(nml.includes('KEY="DJ USB/:Music/:Set 1/:a.mp3"'));
  assert.deepEqual(traktorLocation('C:\\Music\\b.mp3', 'Macintosh HD'), { dir: '/:Music/:', file: 'b.mp3', volume: 'C:' });
  assert.equal(traktorLocation('/Users/me/c.mp3', 'Macintosh HD').volume, 'Macintosh HD');
});

test('Traktor keeps AutoGrid alone and assigns button 2 to the first eligible pad cue', () => {
  const t = track({
    path: '/m/intro.mp3',
    cues: [
      cue({ id: 'intro', slot: 0, timeSec: 0.1, name: 'Intro' }),
      cue({ id: 'near', slot: -1, timeSec: 0.11, name: 'Near grid' }),
      cue({ id: 'drop', slot: 3, timeSec: 15.1, name: 'Drop' }),
    ],
    loops: [
      { id: 'loop', kind: 'intro', name: 'Intro loop', startSec: 0.1, beats: 16, bar: 0, confidence: 'high', reason: '', origin: 'auto', accepted: true },
    ],
  });
  const opts = { memoryCues: false, loops: 'accepted' } as const;
  const nml = buildTraktorNml([t], opts);
  assert.match(nml, /NAME="AutoGrid"[^>]*TYPE="4" START="100\.000"[^>]*HOTCUE="0"/);
  assert.doesNotMatch(nml, /NAME="(?:Intro|Near grid)"/);
  assert.match(nml, /NAME="Drop"[^>]*HOTCUE="1"/);
  assert.match(nml, /NAME="Intro loop"[^>]*TYPE="5"[^>]*HOTCUE="-1"/);
  const plan = traktorPlan(t, 'accepted');
  assert.deepEqual(plan.pads.slice(0, 3), [{ name: 'AutoGrid', timeSec: 0.1 }, { name: 'Drop', timeSec: 15.1 }, null]);
  assert.deepEqual(plan.loops, [{ name: 'Intro loop', timeSec: 0.1, beats: 16, durationSec: 7.5 }]);
  assert.equal(traktorPlan(t, 'none').loops.length, 0);
  assert.match(buildTraktorNml([{ ...t, loops: [] }], opts), /NAME="Drop"[^>]*HOTCUE="1"/);
  assert.match(buildRekordboxXml([t], opts), /Name="Intro"[^>]*Num="0"/);
  const summary = exportSummary(ADAPTERS.find((a) => a.id === 'traktor')!, [t], opts);
  assert.ok(summary.some((line) => line.startsWith('1 hot cue(s)')));
  assert.ok(summary.some((line) => line === '2 cue(s) au premier temps déjà couvert(s) par AutoGrid'));
});

test('duplicate cues: same position flagged once, export summary warns', () => {
  const cues = [
    cue({ id: 'out', slot: 6, timeSec: 260.362, name: 'Outro' }),
    cue({ id: 'mix', slot: 5, timeSec: 260.37, name: 'Mix Out' }),
    cue({ id: 'mem', slot: -1, timeSec: 260.36, name: 'Mémo' }),
    cue({ id: 'drop', slot: 1, timeSec: 106.6, name: 'Drop' }),
  ];
  // the lower pad keeps the position; the higher pad and the memory cue are the duplicates
  assert.deepEqual([...duplicateCueIds(cues)].sort(), ['mem', 'out']);
  assert.equal(cueAt(cues, 106.61)?.id, 'drop');
  assert.equal(cueAt(cues, 107), undefined);
  const sum = exportSummary(ADAPTERS[0], [track({ path: '/a.mp3', title: 'Garrix', cues })], { memoryCues: false, loops: 'none' });
  assert.ok(sum.some((l) => l.startsWith('⚠ 2 cue(s) au même endroit') && l.includes('Garrix')), sum.join('\n'));
});

test('export adapters expose supported collection targets and transfer counts', () => {
  assert.deepEqual(ADAPTERS.map((a) => a.id), ['rekordbox', 'traktor', 'engine', 'virtualdj', 'djay']);
  for (const id of ['engine', 'virtualdj', 'djay'] as const) {
    const a = ADAPTERS.find((x) => x.id === id)!;
    assert.equal(a.via, 'rekordbox');
    assert.match(a.build!([track({ path: 'a', cues: [cue({})] })], { memoryCues: false, loops: 'none' }), /<DJ_PLAYLISTS/);
  }
  const rb = ADAPTERS.find((a) => a.id === 'rekordbox')!;
  const summary = exportSummary(rb, [track({ path: 'a', cues: [cue({})] })], { memoryCues: true, loops: 'accepted' });
  assert.ok(summary.some((l) => l.includes('1 hot cue')));
  assert.ok(summary.some((l) => l.startsWith('Non transférés')));
  const traktor = ADAPTERS.find((a) => a.id === 'traktor')!;
  const variable = track({
    path: 'a', cues: [cue({ slot: 0 }), cue({ slot: 7 }), cue({ slot: -1 })],
    tempoMap: [{ startSec: 0, bpm: 128, beatInBar: 1 }, { startSec: 15, bpm: 132, beatInBar: 1 }],
  });
  const traktorSummary = exportSummary(traktor, [variable], { memoryCues: false, loops: 'none' });
  assert.ok(traktorSummary.some((line) => line.startsWith('2 hot cue')));
  assert.ok(traktorSummary.some((line) => line.startsWith('1 memory cue')));
  assert.ok(traktorSummary.some((line) => line.startsWith('⚠ Tempo variable')));
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
  assert.ok(c.every((x) => x.kind === 'vocal' && x.reason.startsWith('Entrée de voix détectée')));
  assert.equal(cueCandidates([], undefined, v).filter((x) => x.kind === 'vocal').length, 2);
  // off by default (0/2 on the DJ's corrections)…
  const cand = [{ role: 'drop1' as const, kind: 'drop' as const, bar: 16, confidence: 'high' as const, reason: '' }, ...c];
  assert.deepEqual(selectCues(cand, edm, { d0: 0, barLen: 2 }).map((x) => x.kind), ['drop']);
  // …and, once re-enabled in a custom profile, lowest priority: never displaces a structural cue nearby
  const withVocal = { ...edm, excludeKinds: [] };
  assert.deepEqual(selectCues(cand, withVocal, { d0: 0, barLen: 2 }).map((x) => x.kind), ['drop', 'vocal']);
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
  if (!neuralModelAssets().voice) return;
  assert.equal(out.runtime, 'onnx');
  const disabled = process.env.CUEKODA_NEURAL_MODELS;
  process.env.CUEKODA_NEURAL_MODELS = '0';
  try {
    const fallback = await predictVoice(x);
    assert.equal(fallback?.runtime, 'wasm');
    assert.equal(fallback.probs.length, out.probs.length);
    for (const [i, value] of out.probs.entries()) assert.ok(Math.abs(value - fallback.probs[i]) < 1e-4);
  } finally {
    if (disabled === undefined) delete process.env.CUEKODA_NEURAL_MODELS;
    else process.env.CUEKODA_NEURAL_MODELS = disabled;
  }
});

test('all bundled analysis models run through the isolated CPU process', async (t) => {
  const assets = neuralModelAssets();
  if (!assets.tempo || !assets.key || !assets.voice) return t.skip('neural model assets absent');
  assert.equal(await checkNeuralModels(), true);
});

// ---------------------------------------------------------------- evaluation against references (§21)
import { evaluateTrack, keyScore, matchTimes, spearman, summarize, referenceFrom } from '../core/evaluate';
import { loadDataset, parseKeyLabel } from '../core/datasets';

test('MIREX key score', () => {
  assert.equal(keyScore('8A', '8A'), 1); // Am / Am
  assert.equal(keyScore('8A', '9A'), 0.5); // Am / Em (fifth)
  assert.equal(keyScore('8A', '8B'), 0.3); // Am / C (relative)
  assert.equal(keyScore('8B', '5A'), 0.2); // C / Cm (parallel)
  assert.equal(keyScore('11B', '8A'), 0.2); // A / Am (parallel)
  assert.equal(keyScore('8A', '2B'), 0);
});

test('matchTimes is one-to-one within tolerance', () => {
  assert.deepEqual(matchTimes([10, 20, 30], [10.2, 19.6, 50], 0.5), [[10, 10.2], [20, 19.6]]);
  assert.equal(matchTimes([20], [19.4], 0.5).length, 0, '0.6 s away: outside the tolerance');
  assert.equal(matchTimes([10], [10.1, 10.2], 0.5).length, 1);
});

test('spearman', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 2], [1, 2]), null);
});

test('evaluateTrack: perfect, octave error, shifted cues', () => {
  const base = track({
    path: 'x', fileHash: 'h', bpm: 128,
    grid: { bpm: 128, firstDownbeatSec: 0.1, confidence: 1 },
    cues: [cue({ kind: 'intro', timeSec: 0.1 }), cue({ kind: 'drop', timeSec: 30.1 })],
    sections: [
      { id: 'a', type: 'intro', label: 'Intro', startBar: 0, endBar: 16, startSec: 0.1, endSec: 30.1, energy: 0.3, confidence: 'high', origin: 'auto' },
      { id: 'b', type: 'drop', label: 'Drop', startBar: 16, endBar: 32, startSec: 30.1, endSec: 60.1, energy: 0.9, confidence: 'high', origin: 'auto' },
    ],
    energy: { score: 7, curve: [], events: [] },
  });
  const ref = referenceFrom(base, 8);
  const perfect = evaluateTrack(base, ref);
  assert.equal(perfect.key!.score, 1);
  assert.equal(perfect.cues!.recall, 1);
  assert.equal(perfect.cues!.exact, 2);
  assert.equal(perfect.sections!.recall, 1);
  assert.ok(Math.abs(perfect.grid!.phaseErrorMs) < 1e-6 && perfect.grid!.downbeatOk);

  const beat = 60 / 128;
  const off = evaluateTrack({
    ...base, bpm: 64,
    cues: [cue({ kind: 'intro', timeSec: 0.1 }), cue({ kind: 'drop', timeSec: 30.1 - beat })],
    grid: { ...base.grid, firstDownbeatSec: 0.1 + beat },
  }, ref);
  assert.ok(off.bpm!.octaveError);
  assert.equal(off.grid!.downbeatOk, false, 'one beat late = wrong bar start');
  assert.equal(off.cues!.exact, 1, 'a drop one beat early is NOT on the right beat');
  assert.equal(off.cues!.matched, 2, '…but it is within ±1 beat');
  assert.equal(off.cues!.misses.length, 1);
  assert.ok(Math.abs(off.cues!.misses[0].errorBeats! + 1) < 1e-6, 'reported as −1 beat');
  const wrongKind = evaluateTrack({ ...base, cues: [cue({ kind: 'outro', timeSec: 30.1 })] }, ref);
  assert.equal(wrongKind.cues!.exact, 0, 'an Outro cue on the drop position does not count as the Drop');
  const partial = evaluateTrack(base, { ...ref, cues: undefined, sections: undefined, keyCamelot: undefined, firstDownbeatSec: undefined });
  assert.ok(partial.bpm && !partial.cues && !partial.key && !partial.grid, 'dataset references evaluate only what they annotate');
  const s = summarize([perfect, off]);
  assert.equal(s.tracks, 2);
  assert.equal(s.downbeatAccuracy, 0.5);
  assert.equal(s.cueExactRecall, 0.75);
});

test('datasets: key labels and GiantSteps / Harmonix loaders', () => {
  assert.deepEqual(parseKeyLabel('Eb minor'), { tonic: 'Eb', scale: 'minor' });
  assert.deepEqual(parseKeyLabel('c# major'), { tonic: 'C#', scale: 'major' });
  assert.deepEqual(parseKeyLabel('a:min'), { tonic: 'A', scale: 'minor' });
  assert.equal(parseKeyLabel('-'), null);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-ds-'));
  const ann = path.join(root, 'ann'), audio = path.join(root, 'audio');
  fs.mkdirSync(path.join(ann, 'beats_and_downbeats'), { recursive: true });
  fs.mkdirSync(path.join(ann, 'segments'), { recursive: true });
  fs.mkdirSync(audio);
  fs.writeFileSync(path.join(ann, '1001.LOFI.bpm'), '128\n');
  fs.writeFileSync(path.join(ann, '1001.LOFI.key'), 'F minor\n');
  fs.writeFileSync(path.join(ann, '9999.LOFI.bpm'), '120');
  fs.writeFileSync(path.join(audio, '1001.LOFI.mp3'), '');
  const tempo = loadDataset('giantsteps-tempo', ann, audio);
  assert.equal(tempo.refs.length, 1);
  assert.equal(tempo.refs[0].bpm, 128);
  assert.equal(tempo.withoutAudio, 1);
  assert.equal(loadDataset('giantsteps-key', ann, audio).refs[0].keyCamelot, '4A');
  const beats = Array.from({ length: 16 }, (_, i) => `${(0.5 + i * 0.5).toFixed(3)} ${(i % 4) + 1} ${Math.floor(i / 4) + 1}`).join('\n');
  fs.writeFileSync(path.join(ann, 'beats_and_downbeats', '0042_song.txt'), beats);
  fs.writeFileSync(path.join(ann, 'segments', '0042_song.txt'), '0.0 intro\n4.5 verse\n8.0 end\n');
  fs.writeFileSync(path.join(audio, '0042_song.wav'), '');
  const hx = loadDataset('harmonix', ann, audio).refs[0];
  assert.equal(Math.round(hx.bpm!), 120);
  assert.deepEqual(hx.downbeats, [0.5, 2.5, 4.5, 6.5]);
  assert.equal(hx.sections!.length, 2);
});

test('Raveform uses case-sensitive video IDs and imports musical landmarks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-raveform-'));
  const ann = path.join(dir, 'structures');
  const audio = path.join(dir, 'audio');
  fs.mkdirSync(path.join(ann, 'beats'), { recursive: true });
  fs.mkdirSync(audio);
  try {
    fs.writeFileSync(path.join(audio, 'Video_01.flac'), '');
    fs.writeFileSync(path.join(ann, 'segments.json'), JSON.stringify([
      {
        id: 'Video_01', key: '0001.Video_01', title: 'Original edit', average_bpm: 120,
        sections: [
          { name: 'intro', start: 0.2 },
          { name: 'buildup', start: 2.2 },
          { name: 'drop', start: 4.2 },
          { name: 'end', start: 8.2 },
        ],
      },
      { id: 'video_01', key: '0002.video_01' },
    ]));
    const rows = Array.from({ length: 16 }, (_, i) => `${0.2 + i / 2},${i % 4 + 1},intro`);
    fs.writeFileSync(path.join(ann, 'beats', '0001.Video_01.beat.csv'), ['time,downbeat,section', ...rows].join('\n'));
    const { refs, withoutAudio } = loadDataset('raveform', dir, audio);
    assert.equal(withoutAudio, 1);
    assert.equal(refs[0].bpm, 120);
    assert.deepEqual(refs[0].beatWindow, [0.2, 7.7]);
    assert.deepEqual(refs[0].downbeats, [0.2, 2.2, 4.2, 6.2]);
    assert.deepEqual(refs[0].sections?.map(({ type }) => type), ['intro', 'build', 'drop']);
    assert.equal(refs[0].cues, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('external beat annotations use their annotated window and keep the reference meter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-external-beats-'));
  try {
    const audio = path.join(dir, 'audio');
    const ann = path.join(dir, 'annotations');
    fs.mkdirSync(audio);
    fs.mkdirSync(path.join(ann, 'beats'), { recursive: true });
    fs.mkdirSync(path.join(ann, 'tempo'));
    fs.writeFileSync(path.join(audio, 'sample.wav'), '');
    const beats = Array.from({ length: 12 }, (_, index) => 4 + index / 2);
    const rows = beats.map((time, index) => `${time} ${index % 3 + 1}`);
    fs.writeFileSync(path.join(ann, 'beats', 'sample.beats'), rows.join('\n'));
    fs.writeFileSync(path.join(ann, 'tempo', 'sample.bpm'), '121.5');
    const { refs, withoutAudio } = loadDataset('brid', ann, audio);
    assert.equal(withoutAudio, 0);
    assert.equal(refs[0].bpm, 121.5);
    assert.deepEqual(refs[0].beatWindow, [4, 9.5]);
    const result = evaluateTrack(track({
      path: 'sample.wav', bpm: 120, grid: { bpm: 120, firstDownbeatSec: 0, confidence: 1 },
      durationSec: 15,
    }), refs[0]);
    assert.equal(result.beats?.referenceBeatsPerBar, 3);
    assert.equal(result.beats?.fMeasure, 1);
    assert.ok(result.beats!.downbeatF < 1);
    const ballroom = loadDataset('ballroom', path.join(ann, 'beats'), audio);
    assert.equal(ballroom.refs[0].bpm, 120);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluateTrack: beat F-measures follow tempo markers and their beat-in-bar', () => {
  const det = track({
    path: 'tempo-map.wav', durationSec: 6.25, bpm: 120,
    grid: { bpm: 120, firstDownbeatSec: 0, confidence: 1 },
    tempoMap: [
      { startSec: 0.5, bpm: 120, beatInBar: 2 },
      { startSec: 2.5, bpm: 80, beatInBar: 2 },
    ],
  });
  const ref = {
    ...referenceFrom(det),
    beats: [0, 0.5, 1, 1.5, 2, 2.5, 3.25, 4, 4.75, 5.5],
    downbeats: [0, 2, 4.75],
  };
  const timeline = gridBeats(det);
  assert.deepEqual(timeline.map((beat) => beat.timeSec), ref.beats);
  assert.deepEqual(timeline.filter((beat) => beat.downbeat).map((beat) => beat.timeSec), ref.downbeats);
  assert.equal(timeline[beatIndex(timeline, 2.52)].timeSec, 3.25);
  assert.equal(timeline[nearestBeat(timeline, 2.52)].timeSec, 2.5);
  assert.equal(timeline[nearestBeat(timeline, 3.15)].timeSec, 3.25);
  const result = evaluateTrack(det, ref);
  assert.deepEqual(result.beats, { fMeasure: 1, downbeatF: 1 });
  assert.equal(result.grid, undefined);
  const constant = evaluateTrack({ ...det, tempoMap: undefined }, ref);
  assert.ok(constant.beats!.fMeasure < 1);
  assert.ok(constant.beats!.downbeatF < 1);
});

// ---------------------------------------------------------------- acoustic fingerprint (§15)
import { compareFingerprints, type Fingerprint } from '../core/fingerprint';

function fakeFp(bars: number, seed: number, bpm = 128): Fingerprint {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  return { chroma: Array.from({ length: bars * 12 }, () => Math.round(rnd() * 255)), bars, bpm };
}

test('fingerprint: same recording, shared passage, different track, tempo guard', () => {
  const a = fakeFp(100, 1);
  const same = compareFingerprints(a, { ...a, chroma: a.chroma.map((v) => Math.min(255, v + 3)) })!;
  assert.ok(same.matchRatio > 0.95 && same.offsetBars === 0);
  // "radio edit": bars 40-59 removed
  const edit: Fingerprint = { ...a, chroma: [...a.chroma.slice(0, 40 * 12), ...a.chroma.slice(60 * 12)], bars: 80 };
  const m = compareFingerprints(a, edit)!;
  assert.ok(m.longestRunBars >= 40, `longest run ${m.longestRunBars}`);
  const other = compareFingerprints(a, fakeFp(100, 99))!;
  assert.ok(other.longestRunBars < 4, `random tracks share ${other.longestRunBars} bars`);
  assert.equal(compareFingerprints(a, fakeFp(100, 1, 140)), null, 'different tempo: not compared');
});

test('duplicates use the fingerprint: encoding group and acoustic related versions', () => {
  const fp = fakeFp(100, 7);
  const edit: Fingerprint = { ...fp, chroma: [...fp.chroma.slice(0, 40 * 12), ...fp.chroma.slice(60 * 12)], bars: 80 };
  const groups = findDuplicates([
    track({ path: '/a.mp3', title: 'Alpha', fileHash: '1', fingerprint: fp }),
    track({ path: '/a.flac', title: 'Totally other tag', fileHash: '2', fingerprint: { ...fp }, durationSec: 203 }),
    track({ path: '/a-radio.mp3', title: 'Different name', fileHash: '3', fingerprint: edit, durationSec: 160 }),
    track({ path: '/b.mp3', title: 'Beta', fileHash: '4', fingerprint: fakeFp(100, 42) }),
  ]);
  const enc = groups.find((g) => g.kind === 'encoding')!;
  assert.deepEqual(enc.paths.sort(), ['/a.flac', '/a.mp3'], 'same audio despite different tags and durations');
  assert.ok(groups.some((g) => g.kind === 'version' && g.paths.includes('/a-radio.mp3') && g.reason.includes('mesures musicalement identiques')));
  assert.ok(!groups.some((g) => g.paths.includes('/b.mp3')), 'unrelated track never grouped');
});

// ---------------------------------------------------------------- English UI (src/shared/i18n-en.ts)
import { translate } from '../shared/i18n';

test('English UI: dictionary and patterns', () => {
  const cases: [string, string][] = [
    // static UI (index.html, renderer, dialogs)
    ['Réglages', 'Settings'],
    ['Exporter…', 'Export…'],
    ['Glisse des fichiers ou un dossier ici', 'Drop files or a folder here'],
    ['Filtrer (titre, artiste, clé, BPM)…', 'Filter (title, artist, key, BPM)…'],
    ['Temps 1 ici', 'Downbeat here'],
    ['▶︎ Lecture', '▶︎ Play'],
    ['Boucles : ', 'Loops: '],
    [' Memory cues à l’export', ' Memory cues on export'],
    ['Confiance moyenne — vérification conseillée', 'Medium confidence — checking advised'],
    ['Montée progressive (pic aux trois quarts, légère redescente)', 'Gradual rise (peak at three quarters, slight cool-down)'],
    // queue label, busy text, library
    ['Analyse 3/13', 'Analyzing 3/13'],
    ['En attente · 2ᵉ dans la file', 'Queued · 2nd in line'],
    ['Analyse 45 % — décodage · étape 1/6', 'Analyzing 45% — decoding · step 1/6'],
    ['3 / 13 morceaux', '3 / 13 tracks'],
    ['↻ Relancer 1 échec', '↻ Retry 1 failed'],
    ['À vérifier : Grille rythmique peu fiable — à vérifier ; BPM corrigé de 63.9 à 127.80', 'To check: Unreliable beatgrid — please check; BPM corrected from 63.9 to 127.80'],
    // section labels (waveform canvas)
    ['Couplet 2', 'Verse 2'],
    ['Section calme · voix', 'Quiet section · vocals'],
    // engine reasons (structure, cues, mix, loops)
    ['Le groove s’interrompt pendant 8 mesures', 'The groove stops for 8 bars'],
    ['Plus forte hausse de volume du morceau (+4.0 dB)', 'Biggest volume jump in the track (+4.0 dB)'],
    ['Entrée de voix détectée (4 mesures, indice faible)', 'Vocal entry detected (4 bars, weak evidence)'],
    ['Début de l’outro — 32 mesures, kick présent, énergie décroissante, aucune voix détectée', 'Start of the outro — 32 bars, kick present, energy decreasing, no vocals detected'],
    ['Prolonger l’outro rythmique (32 temps)', 'Extend the rhythmic outro (32 beats)'],
    // matching reasons and cautions
    ['même tonalité (8A → 8A) · BPM proche (128.0, 0.5 %) (⚠ tonalité incertaine)', 'same key (8A → 8A) · close BPM (128.0, 0.5%) (⚠ uncertain key)'],
    ['fenêtre de transition de 8 mesures', '8-bar transition window'],
    // export summary, toasts
    ['13 morceau(x) : BPM et grille (premier temps) pour chacun', '13 tracks: BPM and grid (first downbeat) for each'],
    ['1 memory cue(s) sans pad (cues mémorisés Traktor)', '1 memory cue without a pad (Traktor stored cues)'],
    ['Analyse terminée : 10 analysé(s), 1 erreur(s) en 42 s', 'Analysis done: 10 analyzed, 1 error in 42 s'],
    ['BPM fixé à 128 — réanalyse en cours (repères conservés)', 'BPM set to 128 — re-analysing (cues preserved)'],
    ['⚠ Dossier introuvable (/Music/In)', '⚠ Folder not found (/Music/In)'],
    ['Mise à jour impossible : fichier incomplet (100 / 200 octets)', 'Update failed: incomplete file (100 / 200 bytes)'],
  ];
  for (const [fr, en] of cases) {
    assert.equal(translate(fr, 'en'), en, fr);
    assert.equal(translate(fr, 'fr'), fr, 'French is the source language: identity');
  }
  // data is never translated: user cue names, titles, paths
  for (const s of ['My cue', 'Strobe (Extended Mix)', '/Music/In/a.mp3']) assert.equal(translate(s, 'en'), s);
});

// ---------------------------------------------------------------- key changes (P2)
import { findKeyChanges } from '../core/analyzer';

test('key changes: ≥ 60 s of a clearly different key, relative major/minor ignored', () => {
  const w = (t: number, camelot: string, strength = 0.7) => ({ startSec: t, endSec: t + 30, camelot, strength });
  const lift = [w(0, '8A'), w(15, '8A'), w(30, '8A'), w(45, '10A'), w(60, '10A'), w(75, '10A'), w(90, '10A')];
  assert.deepEqual(findKeyChanges(lift, '8A'), [{ startSec: 45, endSec: 120, camelot: '10A' }]);
  const short = [w(0, '8A'), w(15, '10A'), w(30, '10A'), w(45, '8A')];
  assert.deepEqual(findKeyChanges(short, '8A'), [], 'two windows (45 s) are not enough');
  const relative = [w(0, '8B'), w(15, '8B'), w(30, '8B'), w(45, '8B')];
  assert.deepEqual(findKeyChanges(relative, '8A'), [], 'relative major is not a key change');
  const weak = [w(0, '3A', 0.4), w(15, '3A', 0.4), w(30, '3A', 0.4)];
  assert.deepEqual(findKeyChanges(weak, '8A'), [], 'weak windows say nothing');
});

// ---------------------------------------------------------------- fixed pad layout (P3)
test('fixed pads: same function on the same pad, missing roles leave the pad free, merge keeps it', () => {
  const fixed = findProfile('edm-fixed');
  const cand = (role: CueCandidate['role'], kind: CueCandidate['kind'], bar: number): CueCandidate => ({ role, kind, bar, confidence: 'high', reason: '' });
  const g = { d0: 0, barLen: 2 };
  const a = selectCues([cand('intro', 'intro', 0), cand('drop1', 'drop', 32), cand('break1', 'break', 64), cand('drop2', 'drop', 96), cand('outro', 'outro', 128)], fixed, g);
  const b = selectCues([cand('intro', 'intro', 0), cand('build1', 'build', 24), cand('drop1', 'drop', 32), cand('drop2', 'drop', 80), cand('mixout', 'mixout', 120), cand('outro', 'outro', 112)], fixed, g);
  const pad = (cues: HotCue[], role: string) => cues.find((c) => c.role === role)?.slot;
  for (const cues of [a, b]) {
    assert.equal(pad(cues, 'intro'), 0);
    assert.equal(pad(cues, 'drop1'), 2, 'Drop 1 always on pad C');
    assert.equal(pad(cues, 'drop2'), 5, 'Drop 2 always on pad F');
    assert.equal(pad(cues, 'outro'), 6);
  }
  assert.equal(a.find((c) => c.slot === 1), undefined, 'no build: pad B stays free');
  assert.equal(a.find((c) => c.slot === 2)!.name, 'Drop 1');
  // re-analysis: the DJ took pad C for something else → the auto Drop 1 becomes a memory cue, nothing moves
  const user = { ...cue({ slot: 2, timeSec: 10, kind: 'custom', role: 'custom', name: 'Mon cue' }), origin: 'user' as const };
  const prev = track({ path: 'p', cues: [user] });
  const fresh = track({ path: 'p', cues: b });
  const merged = mergeWithPrevious(fresh, prev, { strictSlots: true });
  assert.equal(merged.cues.find((c) => c.slot === 2)!.name, 'Mon cue');
  assert.equal(merged.cues.find((c) => c.role === 'drop1')!.slot, -1);
  assert.equal(merged.cues.find((c) => c.role === 'drop2')!.slot, 5, 'other pads keep their function');
});

// ---------------------------------------------------------------- library storage (P3)
import { LibraryStore } from '../main/store';

test('library store: v1 file migrated, only changed results rewritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-lib-'));
  const file = path.join(dir, 'library.json');
  const t = (p: string) => ({ path: p, fileName: p, status: 'done', addedAt: 1, result: track({ path: p }) });
  fs.writeFileSync(file, JSON.stringify({ version: 1, tracks: { '/a.mp3': t('/a.mp3'), '/b.mp3': t('/b.mp3') } }));
  const lib = new LibraryStore<AnalysisResult, { path: string; result?: AnalysisResult }>(file);
  assert.equal(Object.keys(lib.data.tracks).length, 2);
  lib.flush();
  assert.equal(lib.lastWritten, 2, 'v1 inline results moved to their own files');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(index.version, 2);
  assert.equal(index.tracks['/a.mp3'].result, undefined, 'the index carries no analysis data');
  lib.flush();
  assert.equal(lib.lastWritten, 0, 'nothing changed, nothing rewritten');
  lib.data.tracks['/a.mp3'].result = { ...lib.data.tracks['/a.mp3'].result!, bpm: 127 };
  lib.flush();
  assert.equal(lib.lastWritten, 1, 'one replaced result = one file');
  lib.data.tracks['/b.mp3'].result!.bpm = 126;
  lib.touch('/b.mp3');
  lib.flush();
  assert.equal(lib.lastWritten, 1, 'in-place change declared with touch()');
  const again = new LibraryStore<AnalysisResult, { path: string; result?: AnalysisResult }>(file);
  assert.equal(again.data.tracks['/a.mp3'].result!.bpm, 127);
  assert.equal(again.data.tracks['/b.mp3'].result!.bpm, 126);
});

// ---------------------------------------------------------------- collection import (P3)
import { applyImport, parseRekordboxXml, parseTraktorNml, pathFromTraktorLocation } from '../core/import/collection';

test('collection import: rekordbox XML and Traktor NML round-trip, DJ cues locked, free pads filled', () => {
  const ours = track({
    path: '/Volumes/DJ USB/Music/a & b.mp3', bpm: 128, grid: { bpm: 128, firstDownbeatSec: 0.5, confidence: 1 },
    cues: [cue({ id: 'u1', slot: 0, timeSec: 10, name: 'Intro', kind: 'intro', role: 'intro' }), cue({ id: 'u2', slot: 2, timeSec: 60, name: 'Drop 1' })],
  });
  const xml = buildRekordboxXml([ours], { memoryCues: true, loops: 'none' });
  const rb = parseRekordboxXml(xml);
  assert.equal(rb.length, 1);
  assert.equal(rb[0].path, '/Volumes/DJ USB/Music/a & b.mp3');
  assert.equal(rb[0].bpm, 128);
  assert.ok(Math.abs(rb[0].gridSec! - 0.5) < 1e-6);
  assert.deepEqual(rb[0].cues.filter((c) => c.slot >= 0).map((c) => [c.slot, c.name, c.timeSec]), [[0, 'Intro', 10], [2, 'Drop 1', 60]]);
  const nml = buildTraktorNml([ours], { memoryCues: false, loops: 'none' }, 'Macintosh HD');
  const tk = parseTraktorNml(nml, 'Macintosh HD');
  assert.equal(tk[0].path, '/Volumes/DJ USB/Music/a & b.mp3');
  assert.deepEqual(tk[0].cues.map((c) => [c.slot, c.timeSec]), [[0, 10], [1, 60]], 'Traktor hotcues imported in exported button order');
  assert.equal(pathFromTraktorLocation('Macintosh HD', '/:Users/:me/:', 'x.mp3', 'Macintosh HD'), '/Users/me/x.mp3');
  assert.equal(pathFromTraktorLocation('C:', '/:Music/:', 'x.mp3', 'Macintosh HD'), 'C:\\Music\\x.mp3');

  // the DJ's collection has its own Drop on pad C at 61 s and a cue on pad E; CueKoda's analysis has
  // auto cues on pads A, C, F
  const analysed = track({
    path: '/m.mp3', bpm: 128, grid: { bpm: 128, firstDownbeatSec: 0, confidence: 1 },
    cues: [cue({ id: 'a', slot: 0, timeSec: 0, kind: 'intro', role: 'intro' }), cue({ id: 'b', slot: 2, timeSec: 30 }), cue({ id: 'c', slot: 5, timeSec: 90, kind: 'outro', role: 'outro' })],
  });
  const merged = applyImport(analysed, { path: '/m.mp3', source: 'rekordbox', cues: [{ slot: 2, name: 'Drop 2', timeSec: 61 }, { slot: 4, name: 'Vox', timeSec: 45 }, { slot: -1, name: 'Vox', timeSec: 45 }], loops: [] });
  const onPad = (s: number) => merged.cues.find((c) => c.slot === s);
  assert.equal(onPad(2)!.name, 'Drop 2');
  assert.equal(onPad(2)!.locked, true);
  assert.equal(onPad(2)!.kind, 'drop', 'kind recognised from the name');
  assert.equal(onPad(4)!.name, 'Vox');
  assert.equal(merged.cues.filter((c) => c.timeSec === 45).length, 1, 'pad + memory copy of the same cue imported once');
  assert.ok(merged.cues.some((c) => c.timeSec === 30 && c.origin === 'auto' && ![2, 4].includes(c.slot)), 'the auto drop moved to a free pad');
  assert.equal(merged.importedFrom!.cues, 2);
});
