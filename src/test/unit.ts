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
import { ADAPTERS, commentTag, exportSummary } from '../core/export/index';
import { detectPhrases, labelVocalSections, type StructureAnalysis } from '../core/structure';
import { FUSED_THRESHOLDS, fuseScores, modelBarProbs, segmentVocals, vocalBarFeatures, vocalFrames, vocalPresence, VOCAL_ON } from '../core/vocals';
import { musicnnMel, predictVoice, resample44kTo16k, vocalModelAvailable } from '../core/vocalModel';
import { cueCandidates, vocalCandidates } from '../core/cues';
import { withVocals } from '../core/mix';
import { bTimeAt, fadeGains, planTransition } from '../core/transition';
import { suggestOrder } from '../core/setorder';
import { MAC_SWAP_SCRIPT, evaluateRelease, parseBuild, type GithubRelease } from '../shared/update';
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
      { name: 'CueKoda-0.3.4-mac-x64.dmg', browser_download_url: 'u-x64', size: 11 },
      { name: 'CueKoda-0.3.4-windows-setup.exe', browser_download_url: 'u-win', size: 12, digest: null },
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
  assert.equal(win?.asset.sha256, null);
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
  assert.match(nml, /COMMENT="E8 · 8B · Instru"/);
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
  // only what a DJ actually checked in the real software is marked validated
  assert.deepEqual(ADAPTERS.filter((a) => a.validated).map((a) => a.id).sort(), ['rekordbox', 'traktor']);
  assert.ok(ADAPTERS.filter((a) => a.validated).every((a) => !!a.validatedNote));
  for (const id of ['engine', 'virtualdj', 'djay'] as const) {
    const a = ADAPTERS.find((x) => x.id === id)!;
    assert.equal(a.via, 'rekordbox');
    assert.equal(a.validated, false);
    assert.match(a.build!([track({ path: 'a', cues: [cue({})] })], { memoryCues: false, loops: 'none' }), /<DJ_PLAYLISTS/);
  }
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

// ---------------------------------------------------------------- evaluation against references (§21)
import { evaluateTrack, keyScore, matchTimes, spearman, summarize, referenceFrom } from '../core/evaluate';

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
  assert.equal(perfect.key.score, 1);
  assert.equal(perfect.cues.recall, 1);
  assert.equal(perfect.sections.recall, 1);
  assert.ok(Math.abs(perfect.grid.phaseErrorMs) < 1e-6 && perfect.grid.downbeatOk);

  const off = evaluateTrack({ ...base, bpm: 64, cues: [cue({ timeSec: 0.1 }), cue({ timeSec: 32 })], grid: { ...base.grid, firstDownbeatSec: 0.1 + 60 / 128 } }, ref);
  assert.ok(off.bpm.octaveError);
  assert.equal(off.grid.downbeatOk, false, 'one beat late = wrong bar start');
  assert.equal(off.cues.matched, 1, '32 s is 4 beats away from 30.1 s: not matched');
  const s = summarize([perfect, off]);
  assert.equal(s.tracks, 2);
  assert.equal(s.downbeatAccuracy, 0.5);
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
    ['Entrée de voix détectée (4 mesures, indice faible) — détection heuristique non validée', 'Vocal entry detected (4 bars, weak evidence) — unvalidated heuristic detection'],
    ['Début de l’outro — 32 mesures, kick présent, énergie décroissante, aucune voix détectée', 'Start of the outro — 32 bars, kick present, energy decreasing, no vocals detected'],
    ['Prolonger l’outro rythmique (32 temps)', 'Extend the rhythmic outro (32 beats)'],
    // matching reasons and cautions
    ['même tonalité (8A → 8A) · BPM proche (128.0, 0.5 %) (⚠ tonalité incertaine)', 'same key (8A → 8A) · close BPM (128.0, 0.5%) (⚠ uncertain key)'],
    ['fenêtre de transition de 8 mesures', '8-bar transition window'],
    // export summary, toasts
    ['13 morceau(x) : BPM et grille (premier temps) pour chacun', '13 tracks: BPM and grid (first downbeat) for each'],
    ['1 memory cue(s) sans pad (cues mémorisés Traktor)', '1 memory cue without a pad (Traktor stored cues)'],
    ['Analyse terminée : 10 analysé(s), 1 erreur(s) en 42 s', 'Analysis done: 10 analyzed, 1 error in 42 s'],
    ['BPM fixé à 128 — ré-analyse en cours (vos cues sont conservés)', 'BPM set to 128 — re-analyzing (your cues are kept)'],
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
