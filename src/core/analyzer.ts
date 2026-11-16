import * as path from 'node:path';
import * as fs from 'node:fs';
import { decodeAudio, mp3WithoutGaplessHeader } from './decode';
import { analyseBands, decimate2 } from './dsp';
import { chooseTempo, estimateGrid, foldBpm, pickDownbeatOffset, recheckEdmTempo, corroboratedBassPhase } from './rhythm';
import { allKeys, electronicKeyFromVotes, keyFromMusical, keyFromTonic, type KeyVote } from './key';
import { camelotRelation } from './matching';
import { analyzeStructure, computeBarFeatures, detectPhrases, firstAudibleBar } from './structure';
import { computeEnergy } from './energy';
import { computeFingerprint } from './fingerprint';
import { buildTempoMap, type TempoMarker } from './tempomap';
import { prepareTrack } from './preparation';
import { detectVocals } from './vocals';
import { predictVoice, vocalModelError } from './vocalModel';
import { predictTempo } from './neuralTempo';
import { predictKey } from './neuralKey';
import { findProfile, sanitizeProfile } from './profiles';
import { assertAudioRevision, hashAudioRevision, type AudioRevision } from './hash';
import { bandPeaks } from './peaks';
import {
  AnalysisResult,
  AnalyzeOptions,
  Confidence,
  DEFAULT_OPTIONS,
  ENGINE_VERSION,
  KeyAlternative,
  KeyChange,
  KeyResult,
  TempoInfo,
  TrackInfo,
} from './types';

const SR_FULL = 44100; // Essentia's rhythm extractor is designed for 44.1 kHz material
const SR_DSP = SR_FULL / 2; // own DSP runs at 22.05 kHz
const MAX_DURATION_SEC = 20 * 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let essentiaInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function essentia(): any {
  if (!essentiaInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Essentia, EssentiaWASM } = require('essentia.js');
    essentiaInstance = new Essentia(EssentiaWASM);
  }
  return essentiaInstance;
}

function excerpt(x: Float32Array, sr: number, startSec: number, lenSec: number): Float32Array {
  const a = Math.max(0, Math.floor(startSec * sr));
  const b = Math.min(x.length, a + Math.floor(lenSec * sr));
  return x.subarray(a, b);
}

/** Coarse tempo from Essentia on an excerpt taken from the middle of the track (full groove playing). */
function essentiaTempo(x: Float32Array, durSec: number): number {
  const e = essentia();
  const len = Math.min(durSec, 120);
  const seg = excerpt(x, SR_FULL, Math.max(0, durSec * 0.5 - len / 2), len);
  const v = e.arrayToVector(seg);
  try {
    const r = e.RhythmExtractor2013(v, 208, 'multifeature', 70);
    const bpm = r.bpm as number;
    for (const k of ['ticks', 'estimates', 'bpmIntervals']) r[k]?.delete?.();
    return bpm;
  } finally {
    v.delete();
  }
}

type Vote = { tonic: string; scale: 'major' | 'minor'; w: number };

function keyVote(votes: Map<string, Vote>, seg: Float32Array, profile: string): number {
  const e = essentia();
  const v = e.arrayToVector(seg);
  try {
    const r = e.KeyExtractor(v, true, 4096, 4096, 12, 3500, 60, 25, 0.2, profile, SR_FULL);
    const scale = r.scale === 'major' ? 'major' : 'minor';
    const id = `${r.key}-${scale}`;
    const cur = votes.get(id) ?? { tonic: r.key as string, scale, w: 0 };
    const w = Math.max(0.05, r.strength as number);
    cur.w += w;
    votes.set(id, cur);
    return w;
  } finally {
    v.delete();
  }
}

/**
 * Key detection: votes over three 50 s excerpts (25 %, 50 %, 75 %) with the EDM profile. When the
 * votes disagree, a complementary analysis (two other key profiles on the central 2 minutes) is run,
 * and if it stays split the result is flagged ambiguous with its alternatives instead of a falsely
 * precise answer.
 */
function detectKey(x: Float32Array, durSec: number): KeyResult {
  const votes = new Map<string, Vote>();
  const seglen = Math.min(50, durSec / 3);
  let total = 0;
  let strengthSum = 0;
  for (const pos of [0.25, 0.5, 0.75]) {
    const w = keyVote(votes, excerpt(x, SR_FULL, Math.max(0, durSec * pos - seglen / 2), seglen), 'edma');
    total += w;
    strengthSum += w;
  }
  const rank = () => [...votes.values()].sort((a, b) => b.w - a.w);
  let ranked = rank();
  let ambiguous = !ranked.length || ranked[0].w / total < 0.6 || (ranked[1] && ranked[1].w / ranked[0].w > 0.6);
  let complementary = false;
  if (ambiguous) {
    complementary = true;
    const mid = excerpt(x, SR_FULL, Math.max(0, durSec / 2 - 60), 120);
    for (const prof of ['bgate', 'temperley']) total += keyVote(votes, mid, prof);
    ranked = rank();
    ambiguous = !ranked.length || ranked[0].w / total < 0.55 || (ranked[1] && ranked[1].w / ranked[0].w > 0.7);
  }
  const unknown: KeyResult = { camelot: '', musical: '', openKey: '', confidence: 0, level: 'low', ambiguous: true };
  if (!ranked.length) return unknown;
  const best = ranked[0];
  const share = best.w / (total || 1);
  const meanStrength = strengthSum / 3;
  const confidence = Math.min(1, share * Math.min(1, meanStrength / 0.6));
  const level: Confidence = ambiguous ? 'low' : share >= 0.8 && meanStrength >= 0.6 && !complementary ? 'high' : 'medium';
  const alternatives: KeyAlternative[] = ranked
    .slice(1)
    .filter((v) => v.w / total >= 0.15)
    .slice(0, 3)
    .map((v) => {
      const k = keyFromTonic(v.tonic, v.scale, 0)!;
      return { camelot: k.camelot, musical: k.musical, openKey: k.openKey, weight: v.w / total };
    })
    .filter((a) => a.camelot);
  const res = keyFromTonic(best.tonic, best.scale, confidence);
  return res ? { ...res, level, ambiguous, alternatives } : unknown;
}

/** Key of one excerpt (EDM profile) with its strength. */
function keyOf(seg: Float32Array, profile = 'edma', sampleRate = SR_FULL): KeyVote {
  const frameSize = sampleRate === SR_DSP ? 2048 : 4096;
  const e = essentia();
  const v = e.arrayToVector(seg);
  try {
    const r = e.KeyExtractor(v, true, frameSize, frameSize, 12, 3500, 60, 25, 0.2, profile, sampleRate);
    return { tonic: r.key as string, scale: r.scale === 'major' ? 'major' : 'minor', strength: r.strength as number };
  } finally {
    v.delete();
  }
}

/** EDM: combine the local votes with two profiles on the harmonically richer central passage. */
export function detectElectronicKey(x: Float32Array, durSec: number, sampleRate = SR_FULL): KeyResult {
  const length = Math.min(50, durSec / 3);
  const variants = [0.25, 0.5, 0.75].map((center) =>
    keyOf(excerpt(x, sampleRate, Math.max(0, durSec * center - length / 2), length), 'edma', sampleRate));
  const middle = excerpt(x, sampleRate, Math.max(0, durSec / 2 - 60), 120);
  return electronicKeyFromVotes(variants, keyOf(middle, 'bgate', sampleRate), keyOf(middle, 'edmm', sampleRate));
}

/**
 * Key changes: the key of 30 s windows (hop 15 s); a run of ≥ 3 consecutive windows (≥ 60 s) that agree on
 * a key other than the main one, each with strength ≥ 0.55, is reported. Relative major / minor (same notes,
 * a classic detector confusion) does not count as a change.
 */
export function findKeyChanges(
  windows: { startSec: number; endSec: number; camelot: string; strength: number }[],
  mainCamelot: string,
): { startSec: number; endSec: number; camelot: string }[] {
  const out: { startSec: number; endSec: number; camelot: string }[] = [];
  const differs = (c: string) => c !== mainCamelot && camelotRelation(mainCamelot, c) !== 'relative';
  for (let i = 0; i < windows.length; ) {
    const w = windows[i];
    if (!differs(w.camelot) || w.strength < 0.55) { i++; continue; }
    let j = i;
    while (j + 1 < windows.length && windows[j + 1].camelot === w.camelot && windows[j + 1].strength >= 0.55) j++;
    if (j - i + 1 >= 3) out.push({ startSec: w.startSec, endSec: windows[j].endSec, camelot: w.camelot });
    i = j + 1;
  }
  return out;
}

function detectKeyChanges(x: Float32Array, durSec: number, main: KeyResult, sampleRate = SR_FULL): KeyChange[] {
  if (!main.camelot || durSec < 120) return [];
  const windows: { startSec: number; endSec: number; camelot: string; strength: number }[] = [];
  for (let t = 0; t + 30 <= durSec; t += 15) {
    const k = keyOf(excerpt(x, sampleRate, t, 30), 'edma', sampleRate);
    const res = keyFromTonic(k.tonic, k.scale, k.strength);
    if (res) windows.push({ startSec: t, endSec: t + 30, camelot: res.camelot, strength: k.strength });
  }
  // A disagreement throughout the song is not evidence of a modulation.
  if (main.method === 'openkeyscan' && !windows.some((w) => w.camelot === main.camelot && w.strength >= 0.55)) return [];
  return findKeyChanges(windows, main.camelot).map((c) => {
    const k = allKeys().find((a) => a.camelot === c.camelot)!;
    return { startSec: c.startSec, endSec: Math.min(durSec, c.endSec), camelot: k.camelot, musical: k.musical, openKey: k.openKey };
  });
}

function waveform(x: Float32Array, points: number): { wave: number[]; waveLow: number[]; waveMid: number[]; waveHigh: number[] } {
  const b = bandPeaks(x, SR_DSP, points);
  return { wave: b.peak, waveLow: b.low, waveMid: b.mid, waveHigh: b.high };
}

async function readInfo(file: string, durationFallback: number): Promise<TrackInfo> {
  const st = fs.statSync(file);
  const ext = path.extname(file).toLowerCase().replace('.', '');
  const info: TrackInfo = {
    path: file,
    fileName: path.basename(file),
    title: path.basename(file, path.extname(file)),
    artist: '',
    album: '',
    genre: '',
    year: '',
    durationSec: durationFallback,
    bitrate: 0,
    sampleRate: 44100,
    sizeBytes: st.size,
    kind: `${ext.toUpperCase()} File`,
  };
  try {
    // music-metadata is ESM-only since v8: dynamic import() so esbuild bundles it into the CommonJS output
    // (loaded lazily, no runtime ESM resolution inside the asar archive).
    const mm = await import('music-metadata');
    const meta = await mm.parseFile(file, { duration: true, skipCovers: true });
    const c = meta.common;
    if (c.title) info.title = c.title;
    info.artist = c.artist ?? '';
    info.album = c.album ?? '';
    info.genre = (c.genre ?? []).join(', ');
    info.year = c.year ? String(c.year) : '';
    if (meta.format.duration) info.durationSec = meta.format.duration;
    info.bitrate = meta.format.bitrate ? Math.round(meta.format.bitrate) : 0;
    info.sampleRate = meta.format.sampleRate ?? 44100;
    info.channels = meta.format.numberOfChannels;
    info.codec = meta.format.codec;
    info.container = meta.format.container;
    info.lossless = meta.format.lossless;
    if (c.bpm) info.tagBpm = Number(c.bpm);
    if (c.key) info.tagKey = String(c.key);
  } catch {
    /* files without tags are fine */
  }
  return info;
}

export async function analyzeFile(
  file: string, options: Partial<AnalyzeOptions> = {}, revision?: AudioRevision,
): Promise<AnalysisResult> {
  const t0 = Date.now();
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const progress = opt.onProgress ?? (() => {});
  const profile = sanitizeProfile(opt.profile ?? findProfile(opt.profileId));
  const { minBpm, maxBpm } = opt;
  if (!Number.isFinite(minBpm) || !Number.isFinite(maxBpm) || minBpm <= 0 || maxBpm <= minBpm) {
    throw new Error('Plage de tempo invalide : le BPM maximal doit être supérieur au BPM minimal (positif).');
  }
  const ov = opt.overrides ?? {};
  const warnings: string[] = [];

  progress('décodage', 0.02);
  // Read the revision before the decoder opens the file. The worker already hashed it for the cache.
  const initial = revision?.stat ?? await fs.promises.stat(file, { bigint: true });
  const [decoded, source] = await Promise.all([decodeAudio(file, SR_FULL), revision ?? hashAudioRevision(file, initial)]);
  await assertAudioRevision(file, source);
  let full = decoded.samples;
  const durSec = full.length / SR_FULL;
  if (durSec > MAX_DURATION_SEC) throw new Error(`fichier de plus de ${MAX_DURATION_SEC / 60} min (mix DJ ?) — ignoré`);
  const info = await readInfo(file, durSec);
  // A decoding error, or decoded audio clearly shorter than the duration the file announces, means the
  // analysis only saw part of the track (truncated download, damaged tail): say so instead of hiding it.
  const announced = info.durationSec;
  const missing = announced - durSec;
  if (decoded.decodeError) warnings.push(`Fichier endommagé : décodage interrompu (${decoded.decodeError}) — analyse partielle`);
  else if (missing > 2 && missing / announced > 0.03) {
    warnings.push(`Fichier probablement tronqué : ${Math.round(durSec)} s décodées sur ${Math.round(announced)} s annoncées — analyse partielle`);
  }
  info.durationSec = durSec;
  if (mp3WithoutGaplessHeader(file)) {
    warnings.push('MP3 sans en-tête LAME : délai d’encodage inconnu, cues possiblement décalés d’environ 25 ms selon le logiciel DJ');
  }

  // ffmpeg measures the original channels before downmix. Recover an audible stereo file whose
  // channels cancel in mono, but never generate a tempo or key from digital silence.
  let audible = full.some((sample) => Math.abs(sample) > 1e-7);
  if (!audible && (decoded.loudness.truePeakDbtp ?? -Infinity) > -100) {
    const left = await decodeAudio(file, SR_FULL, 'left');
    full = left.samples;
    audible = full.some((sample) => Math.abs(sample) > 1e-7);
    if (audible) warnings.push('Les canaux s’annulent en mono : analyse sur le canal gauche.');
  }
  if (!audible) throw new Error('Aucun signal audio exploitable après conversion mono.');

  // --- loudness / dynamics (algorithmic, separate from tag metadata) -------------
  let sq = 0;
  let pk = 0;
  for (let i = 0; i < full.length; i++) {
    sq += full[i] * full[i];
    pk = Math.max(pk, Math.abs(full[i]));
  }
  const rmsDb = 10 * Math.log10(sq / full.length + 1e-12);
  const loudness = { ...decoded.loudness, rmsDb, crestDb: 20 * Math.log10(pk + 1e-9) - rmsDb };

  // --- tempo -------------------------------------------------------------------
  progress('tempo', 0.3);
  const x = decimate2(full);
  const bands = analyseBands(x, SR_DSP);
  const automaticRange = options.minBpm === undefined && options.maxBpm === undefined;
  const fromRaw = (raw: number) => {
    const tempo = chooseTempo(bands, raw, minBpm, maxBpm, automaticRange);
    const rechecked = automaticRange ? recheckEdmTempo(bands, tempo.bpm) : { bpm: tempo.bpm, halfTime: undefined };
    return { raw, tempo, rechecked };
  };
  let grid: ReturnType<typeof estimateGrid>;
  let estimate: ReturnType<typeof fromRaw> | undefined;
  let method: TempoInfo['method'] = 'essentia';
  if (ov.bpm) {
    method = 'manual';
    progress('grille', 0.5);
    grid = estimateGrid(x, SR_DSP, bands, ov.bpm, { fixedBpm: true, fixedPhaseSec: ov.firstDownbeatSec });
  } else {
    const proposal = automaticRange ? await predictTempo(x) : undefined;
    let verifiedGrid: ReturnType<typeof estimateGrid> | undefined;
    if (proposal !== undefined) {
      const candidate = fromRaw(proposal);
      const fit = estimateGrid(x, SR_DSP, bands, candidate.rechecked.bpm);
      if (!fit.variable && fit.confidence >= 0.7 && Math.abs(fit.bpm - foldBpm(proposal, minBpm, maxBpm)) <= 1.5) {
        estimate = candidate;
        verifiedGrid = fit;
        method = 'deep-rhythm';
      }
    }
    estimate ??= fromRaw(essentiaTempo(full, durSec));
    progress('grille', 0.5);
    grid = verifiedGrid ?? estimateGrid(x, SR_DSP, bands, estimate.rechecked.bpm);
    if (estimate.tempo.note) warnings.push(estimate.tempo.note);
    if (estimate.rechecked.bpm !== estimate.tempo.bpm) {
      warnings.push(`Tempo ${estimate.tempo.bpm.toFixed(1)} remplacé par ${estimate.rechecked.bpm.toFixed(1)} (pulsation plus rapide mieux alignée)`);
    }
  }
  const bpmEst = estimate?.rechecked.bpm ?? grid.bpm;
  const halfTime = estimate?.rechecked.halfTime;
  const rawBpm = estimate?.raw ?? 0;
  const bpm = grid.bpm;
  const P = 60 / bpm;
  const barLen = 4 * P;
  if (grid.variable) warnings.push(`Tempo variable (${grid.localMin.toFixed(1)}–${grid.localMax.toFixed(1)} BPM) : grille fixe approximative`);
  else if (grid.confidence < 0.4) warnings.push('Grille rythmique peu fiable — à vérifier');
  if (!ov.bpm && Math.abs(bpm - bpmEst) > 2.5) warnings.push(`BPM corrigé de ${bpmEst.toFixed(1)} à ${bpm.toFixed(2)}`);
  const folded = rawBpm ? foldBpm(rawBpm, minBpm, maxBpm) : bpm;
  const alternativeBpm = halfTime !== undefined && Math.abs(halfTime / bpm - 0.5) < 0.015
    ? Math.round(halfTime * 100) / 100 : undefined;
  const tempoLevel: Confidence = ov.bpm
    ? 'high'
    : alternativeBpm !== undefined || grid.variable || grid.confidence < 0.4
      ? 'low'
      : grid.confidence >= 0.8 && Math.abs(folded - bpm) < 1.5
        ? 'high'
        : 'medium';
  const alternatives = [alternativeBpm ?? bpm / 2, bpm * 2, ...(rawBpm && Math.abs(folded - bpm) >= 1.5 ? [folded] : [])]
    .filter((b) => b >= 50 && b <= 240)
    .map((b) => Math.round(b * 100) / 100);
  const tempo: TempoInfo = {
    method,
    bpm,
    confidence: tempoLevel,
    variable: grid.variable,
    localMin: grid.localMin,
    localMax: grid.localMax,
    alternatives,
    ...(alternativeBpm ? { competingBpm: alternativeBpm } : {}),
    rawEstimate: rawBpm || bpm,
  };

  // --- downbeat ----------------------------------------------------------------
  let firstDownbeatSec: number;
  let downbeatConfidence: Confidence;
  if (ov.firstDownbeatSec !== undefined) {
    firstDownbeatSec = ((ov.firstDownbeatSec % barLen) + barLen) % barLen;
    downbeatConfidence = 'high';
  } else {
    const bassPhase = !ov.bpm ? corroboratedBassPhase(bands, grid) : undefined;
    if (bassPhase !== undefined) grid.firstBeatSec = bassPhase;
    const probe = computeBarFeatures(bands, grid.firstBeatSec, barLen, durSec);
    const audible = firstAudibleBar(probe);
    const firstAudibleSec = grid.firstBeatSec + audible * barLen;
    const downbeatMode = grid.variable ? 'standard' : bassPhase !== undefined ? 'bass-aligned' : 'common';
    const db = pickDownbeatOffset(bands, bpm, grid.firstBeatSec, firstAudibleSec, durSec, downbeatMode);
    firstDownbeatSec = grid.firstBeatSec + db.offset * P;
    downbeatConfidence = db.confident ? 'high' : 'low';
    if (!db.confident) warnings.push('Premier temps (downbeat) incertain — vérifie la grille');
  }

  // --- structure, phrases, energy, sections ---------------------------------------
  progress('structure', 0.65);
  const feats = computeBarFeatures(bands, firstDownbeatSec, barLen, durSec);
  // energy first: drops are defined by reaching (and holding) the track's top energy tier
  const energy = computeEnergy(x, SR_DSP, bands, firstDownbeatSec, barLen, feats.nBars, firstAudibleBar(feats), loudness.integratedLufs);
  const structure = analyzeStructure(feats, energy.curve);
  const phrases = detectPhrases(structure);
  const fingerprint = computeFingerprint(x, SR_DSP, firstDownbeatSec, barLen, feats.nBars, bpm);
  // Tempo changes: beat-by-beat tracking → constant-tempo segments → markers (only for "variable" tracks)
  let tempoMap: TempoMarker[] | undefined;
  if (grid.variable && !ov.bpm) {
    const markers = buildTempoMap(x, SR_DSP, bands, bpm, firstDownbeatSec);
    if (markers.length >= 2) {
      tempoMap = markers;
      warnings.push(`Changements de tempo : ${markers.map((m) => `${m.bpm} BPM à ${Math.floor(m.startSec / 60)}:${String(Math.floor(m.startSec % 60)).padStart(2, '0')}`).join(' → ')} (marqueurs exportés vers rekordbox)`);
    }
  }
  progress('voix', 0.72);
  const voiceModel = await predictVoice(full);
  const vocals = detectVocals(x, SR_DSP, firstDownbeatSec, barLen, feats.nBars, durSec, structure.origin, voiceModel, vocalModelError());
  if (process.env.CUEKODA_DEBUG) {
    console.error(`# ${path.basename(file)} bpm=${bpm.toFixed(3)} d0=${firstDownbeatSec.toFixed(3)} origin=${structure.origin}`);
    feats.energyDb.forEach((e, b) =>
      console.error(
        `bar ${String(b).padStart(3)}  E=${e.toFixed(1)}  bright=${feats.brightDb[b].toFixed(1)}  low=${feats.lowDb[b].toFixed(1)}  kick=${feats.kick[b].toFixed(2)}  nrg=${energy.curve[b].toFixed(2)}`,
      ),
    );
  }

  // --- key -----------------------------------------------------------------------
  progress('tonalité', 0.85);
  let key: KeyResult;
  const manualKey = ov.key ? keyFromMusical(ov.key, 1) : null;
  if (manualKey) {
    key = { ...manualKey, method: 'manual', level: 'high', ambiguous: false, alternatives: [] };
  } else {
    const neural = await predictKey(full);
    const profileEstimate = !neural || neural.confidence < 0.25 || neural.confidence >= 0.8
      ? detectElectronicKey(x, durSec, SR_DSP) : undefined;
    const keepProfiles = neural && neural.confidence < 0.25 && profileEstimate?.level === 'high';
    if (neural && !keepProfiles) {
      key = { ...neural, method: 'openkeyscan' };
      if (neural.confidence >= 0.8 && profileEstimate) {
        if (profileEstimate.camelot === neural.camelot && profileEstimate.level === 'high') key.level = 'high';
        else if (profileEstimate.level === 'high') {
          key.level = 'low';
          key.ambiguous = true;
          if (!key.alternatives?.some((alternative) => alternative.camelot === profileEstimate.camelot)) {
            const { camelot, musical, openKey } = profileEstimate;
            key.alternatives = [{ camelot, musical, openKey }, ...(key.alternatives ?? [])].slice(0, 3);
          }
        }
      }
    } else {
      key = profileEstimate ?? detectKey(full, durSec);
      key.method = 'profiles';
    }
    if (key.ambiguous) {
      const alts = (key.alternatives ?? []).map((a) => a.camelot).join(', ');
      warnings.push(`Tonalité ambiguë${alts ? ` (aussi plausible : ${alts})` : ''}`);
    }
    const changes = detectKeyChanges(x, durSec, key, SR_DSP);
    if (changes.length) {
      key.changes = changes;
      const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      warnings.push(`Changement de tonalité probable : ${changes.map((c) => `${c.camelot} de ${mmss(c.startSec)} à ${mmss(c.endSec)}`).join(', ')} (tonalité principale ${key.camelot})`);
    }
  }

  const { wave, waveLow, waveMid, waveHigh } = waveform(x, opt.wavePoints);
  await assertAudioRevision(file, source);

  const result = prepareTrack({
    ...info,
    engineVersion: ENGINE_VERSION,
    fileHash: source.fileHash,
    bpm,
    tempo,
    grid: { bpm, firstDownbeatSec, confidence: grid.confidence, downbeatConfidence },
    key,
    loudness,
    energy,
    fingerprint,
    tempoMap,
    phrases,
    cues: [],
    preparation: { feats, structure },
    vocals,
    overrides: Object.keys(ov).length ? ov : undefined,
    wave,
    waveLow,
    waveMid,
    waveHigh,
    warnings,
    analysisMs: 0,
  }, profile, opt.suppressKinds);
  result.analysisMs = Date.now() - t0;
  progress('terminé', 1);
  return result;
}
