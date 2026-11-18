import { gridBeats } from './beatgrid';
import { beatportGenre, type GenreFamily, type RhythmMode } from './genres';
import { camelotRelation } from './matching';
import type { AnalysisResult, Confidence, CueKind, SectionType, VocalInfo } from './types';

/**
 * Reference annotations (spec §21): the state of a track AFTER the DJ checked it by ear and corrected it.
 * The engine is then evaluated by re-analysing the file from scratch (no corrections) and comparing.
 */
export interface Reference {
  version: 1;
  fileHash: string;
  path: string;
  fileName: string;
  title: string;
  createdAt: string;
  /** Engine version whose output was corrected */
  engineVersion: string;
  profileId?: string;
  /** Optional corpus dimensions used to detect blind spots in real-world evaluation. */
  genre?: string;
  genreFamily?: GenreFamily;
  rhythm?: RhythmMode;
  scenario?: 'steady' | 'variable' | 'live' | 'edit';
  vocalStyle?: 'instrumental' | 'sung' | 'rap-spoken' | 'crowd' | 'chops' | 'mixed' | 'unknown';
  /** Official corpus split. Thresholds are selected on validation and reported once on test. */
  partition?: 'train' | 'validation' | 'test';
  // Every annotation is optional: public datasets annotate only part of it (tempo, key, beats…).
  bpm?: number;
  firstDownbeatSec?: number;
  key?: string; // musical, e.g. "F#m"
  keyCamelot?: string;
  cues?: { kind: CueKind; name: string; timeSec: number }[];
  sections?: { type: SectionType; label: string; startSec: number }[];
  /** Annotated beat / downbeat times (s) */
  beats?: number[];
  downbeats?: number[];
  /** Known annotated span, for datasets that exclude leading and trailing audio from beat evaluation. */
  beatWindow?: [startSec: number, endSec: number];
  /** Meter inferred from the annotation, for stratified reporting. */
  beatsPerBar?: number;
  /** Where the annotation comes from (DJ, dataset name) */
  source?: string;
  vocalSegments?: { startSec: number; endSec: number }[];
  /** Clip-level label for corpora without temporal boundaries (e.g. AudioSet). */
  vocalPresence?: boolean;
  /** Optional energy feeling given by the DJ (1–10) */
  energyRating?: number;
}

export interface ReferenceDetails {
  genre?: string;
  genreFamily?: GenreFamily;
  rhythm?: RhythmMode;
  scenario?: Reference['scenario'];
  vocalStyle?: Reference['vocalStyle'];
  partition?: Reference['partition'];
  source?: string;
}

export function referenceFrom(r: AnalysisResult, energyRating?: number, details: ReferenceDetails = {}): Reference {
  const bar = (4 * 60) / r.bpm;
  const vocals = (r as AnalysisResult & { vocals?: VocalInfo }).vocals;
  const matchedGenre = beatportGenre(details.genre || r.genre);
  return {
    version: 1,
    fileHash: r.fileHash ?? '',
    path: r.path,
    fileName: r.fileName,
    title: r.title,
    createdAt: new Date().toISOString(),
    engineVersion: r.engineVersion ?? '?',
    profileId: r.profileId,
    genre: details.genre || matchedGenre?.name || r.genre || undefined,
    genreFamily: details.genreFamily ?? matchedGenre?.family,
    rhythm: details.rhythm ?? matchedGenre?.rhythm,
    scenario: details.scenario ?? (r.tempo?.variable ? 'variable' : 'steady'),
    vocalStyle: details.vocalStyle,
    partition: details.partition,
    source: details.source ?? 'CueKoda quick review',
    bpm: r.bpm,
    firstDownbeatSec: r.grid.firstDownbeatSec,
    key: r.key.musical,
    keyCamelot: r.key.camelot,
    cues: r.cues.map((c) => ({ kind: c.kind, name: c.name, timeSec: c.timeSec })),
    sections: (r.sections ?? []).map((s) => ({ type: s.type, label: s.label, startSec: s.startSec })),
    vocalSegments: vocals?.segments.map((s) => ({
      startSec: r.grid.firstDownbeatSec + s.startBar * bar,
      endSec: r.grid.firstDownbeatSec + s.endBar * bar,
    })),
    energyRating,
  };
}

export interface CueMiss {
  kind: CueKind;
  name: string;
  timeSec: number;
  /** signed error of the nearest detected cue of the same kind, in beats (null = none detected) */
  errorBeats: number | null;
}

export interface TrackEvaluation {
  fileName: string;
  genre?: string;
  genreFamily?: GenreFamily;
  rhythm?: RhythmMode;
  scenario?: Reference['scenario'];
  vocalStyle?: Reference['vocalStyle'];
  partition?: Reference['partition'];
  performance?: { analysisMs: number; cpuMs: number; rssDeltaMb: number; fileSizeMb: number };
  bpm?: { reference: number; detected: number; errorPct: number; octaveError: boolean; confidence?: Confidence; competingBpm?: number };
  /** Phase error of the grid, in ms (−beat/2 … +beat/2), and whether the bar start is the same beat */
  grid?: { phaseErrorMs: number; downbeatOk: boolean };
  /** Beat / downbeat tracking against annotated beat times (Harmonix-style): share of beats within ±70 ms */
  beats?: { fMeasure: number; downbeatF: number; referenceBeatsPerBar?: number };
  /** MIREX key score: 1 exact, 0.5 fifth, 0.3 relative, 0.2 parallel, 0 otherwise */
  key?: { reference: string; detected: string; score: number };
  /**
   * Cues, matched by kind (a reference cue of kind 'custom' matches any kind):
   *  - exact: on the right beat (±40 ms) — what a DJ accepts on a CDJ
   *  - matched: within ±1 beat (kept for comparison with earlier reports)
   */
  cues?: { exact: number; matched: number; reference: number; detected: number; precision: number; recall: number; meanOffsetBeats: number; misses: CueMiss[] };
  sections?: { matched: number; reference: number; detected: number; precision: number; recall: number };
  /** Duration-weighted vocal-presence score against manually annotated intervals. */
  vocals?: {
    truePositiveSec: number;
    referenceSec: number;
    detectedSec: number;
    precision: number;
    recall: number;
    f1: number;
    intersectionOverUnion: number;
    /** Brier score of the per-bar detector curve (0 is perfectly calibrated). */
    brier: number;
    bars: number;
    thresholds: { threshold: number; truePositive: number; falsePositive: number; falseNegative: number; trueNegative: number }[];
  };
  vocalClip?: { expected: boolean; detected: boolean };
  energy?: { reference: number; detected: number };
}

/** MIREX-style key comparison on Camelot codes. */
export function keyScore(ref: string, det: string): number {
  if (!ref || !det) return 0;
  if (ref === det) return 1;
  const rel = camelotRelation(ref, det);
  if (rel === 'adjacent') return 0.5; // perfect fifth up / down
  if (rel === 'relative') return 0.3;
  // parallel major/minor: C = 8B ↔ Cm = 5A, A = 11B ↔ Am = 8A → major number = minor number + 3
  const n = (k: string) => parseInt(k, 10);
  const r = ref.slice(-1), d = det.slice(-1);
  if (r !== d) {
    const minor = r === 'A' ? n(ref) : n(det);
    const major = r === 'A' ? n(det) : n(ref);
    if ((((major - minor) % 12) + 12) % 12 === 3) return 0.2;
  }
  return 0;
}

/** Greedy one-to-one matching of time points within a tolerance; returns matched pairs. */
export function matchTimes(ref: number[], det: number[], tol: number, compatible: (i: number, j: number) => boolean = () => true): [number, number][] {
  const pairs: { i: number; j: number; d: number }[] = [];
  ref.forEach((r, i) => det.forEach((t, j) => {
    const d = Math.abs(r - t);
    if (d <= tol && compatible(i, j)) pairs.push({ i, j, d });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const usedR = new Set<number>(), usedD = new Set<number>();
  const out: [number, number][] = [];
  for (const p of pairs) {
    if (usedR.has(p.i) || usedD.has(p.j)) continue;
    usedR.add(p.i);
    usedD.add(p.j);
    out.push([ref[p.i], det[p.j]]);
  }
  return out;
}

const ratio = (a: number, b: number) => (b ? a / b : 1);

/** A cue lands "on the right beat" within this tolerance (s). */
export const EXACT_CUE_SEC = 0.04;
/** Beat tracking tolerance (MIREX convention). */
const BEAT_TOL_SEC = 0.07;

const fMeasure = (ref: number[], det: number[], tol: number) => {
  if (!ref.length && !det.length) return 1;
  const m = matchTimes(ref, det, tol).length;
  return ref.length + det.length ? (2 * m) / (ref.length + det.length) : 0;
};

type Interval = { startSec: number; endSec: number };

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((v) => v.endSec > v.startSec)
    .map((v) => ({ ...v })).sort((a, b) => a.startSec - b.startSec);
  const out: Interval[] = [];
  for (const current of sorted) {
    const previous = out[out.length - 1];
    if (previous && current.startSec <= previous.endSec) previous.endSec = Math.max(previous.endSec, current.endSec);
    else out.push(current);
  }
  return out;
}

const intervalDuration = (intervals: Interval[]) => intervals.reduce((sum, v) => sum + v.endSec - v.startSec, 0);

function overlapDuration(a: Interval[], b: Interval[]): number {
  let i = 0, j = 0, total = 0;
  while (i < a.length && j < b.length) {
    total += Math.max(0, Math.min(a[i].endSec, b[j].endSec) - Math.max(a[i].startSec, b[j].startSec));
    if (a[i].endSec < b[j].endSec) i++; else j++;
  }
  return total;
}

/**
 * Compares a fresh analysis (no corrections) with a reference. Every part of the reference is optional:
 * a public dataset may annotate only the tempo, the key or the beats.
 */
export function evaluateTrack(det: AnalysisResult, ref: Reference): TrackEvaluation {
  const out: TrackEvaluation = {
    fileName: ref.fileName,
    genre: ref.genre,
    genreFamily: ref.genreFamily,
    rhythm: ref.rhythm,
    scenario: ref.scenario,
    vocalStyle: ref.vocalStyle,
    partition: ref.partition,
  };
  const refBpm = ref.bpm ?? det.bpm;
  const beat = 60 / refBpm;
  if (ref.bpm) {
    const bpmErr = ((det.bpm - ref.bpm) / ref.bpm) * 100;
    const octave = [0.5, 2, 1 / 3, 3, 2 / 3, 1.5].some((k) => Math.abs(det.bpm / ref.bpm! - k) < 0.02);
    out.bpm = { reference: ref.bpm, detected: det.bpm, errorPct: bpmErr, octaveError: Math.abs(bpmErr) > 2 && octave, confidence: det.tempo?.confidence, competingBpm: det.tempo?.competingBpm };
  }
  // Annotated beat times give a more meaningful comparison than extrapolating
  // a constant 4/4 grid from the reference's median tempo.
  if (!ref.beats?.length && ref.firstDownbeatSec !== undefined && ref.bpm) {
    // grid phase: distance between the detected downbeat and the nearest reference beat
    const rel = (det.grid.firstDownbeatSec - ref.firstDownbeatSec) / beat;
    const phase = (rel - Math.round(rel)) * beat * 1000;
    const barRel = (det.grid.firstDownbeatSec - ref.firstDownbeatSec) / (beat * 4);
    out.grid = { phaseErrorMs: phase, downbeatOk: Math.abs(barRel - Math.round(barRel)) < 0.5 / 4 };
  }
  if (ref.beats?.length) {
    const [start, end] = ref.beatWindow ?? [0, det.durationSec];
    const g = gridBeats(det).filter(({ timeSec }) => timeSec >= start - BEAT_TOL_SEC && timeSec <= end + BEAT_TOL_SEC);
    out.beats = {
      ...(ref.beatsPerBar !== undefined ? { referenceBeatsPerBar: ref.beatsPerBar } : {}),
      fMeasure: fMeasure(ref.beats, g.map((b) => b.timeSec), BEAT_TOL_SEC),
      downbeatF: ref.downbeats?.length ? fMeasure(ref.downbeats, g.filter((b) => b.downbeat).map((b) => b.timeSec), BEAT_TOL_SEC) : 0,
    };
  }
  if (ref.keyCamelot) out.key = { reference: ref.keyCamelot, detected: det.key.camelot, score: keyScore(ref.keyCamelot, det.key.camelot) };

  if (ref.cues) {
    const refCues = ref.cues;
    const acceptsAnyKind = refCues.some((cue) => cue.kind === 'custom');
    const annotatedKinds = new Set(refCues.map((cue) => cue.kind));
    // A partial corpus such as M-DJCUE annotates only mix-in/out. Other CueKoda cue kinds are not false positives.
    const detCues = acceptsAnyKind ? det.cues : det.cues.filter((cue) => annotatedKinds.has(cue.kind));
    const same = (i: number, j: number) => refCues[i].kind === 'custom' || refCues[i].kind === detCues[j].kind;
    const rt = refCues.map((c) => c.timeSec);
    const dt = detCues.map((c) => c.timeSec);
    const exact = matchTimes(rt, dt, EXACT_CUE_SEC, same);
    const near = matchTimes(rt, dt, beat + 1e-6, same);
    const misses: CueMiss[] = refCues
      .filter((c) => !exact.some(([a]) => a === c.timeSec))
      .map((c) => {
        const cands = detCues.filter((d) => c.kind === 'custom' || d.kind === c.kind);
        const best = cands.sort((a, b) => Math.abs(a.timeSec - c.timeSec) - Math.abs(b.timeSec - c.timeSec))[0];
        return { kind: c.kind, name: c.name, timeSec: c.timeSec, errorBeats: best ? (best.timeSec - c.timeSec) / beat : null };
      });
    out.cues = {
      exact: exact.length,
      matched: near.length,
      reference: rt.length,
      detected: dt.length,
      precision: ratio(exact.length, dt.length),
      recall: ratio(exact.length, rt.length),
      meanOffsetBeats: near.length ? near.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / near.length / beat : 0,
      misses,
    };
  }
  if (ref.sections) {
    const refSec = ref.sections.map((s) => s.startSec).slice(1); // the first boundary is the track start
    const detSec = (det.sections ?? []).map((s) => s.startSec).slice(1);
    const secPairs = matchTimes(refSec, detSec, beat * 4);
    out.sections = {
      matched: secPairs.length,
      reference: refSec.length,
      detected: detSec.length,
      precision: ratio(secPairs.length, detSec.length),
      recall: ratio(secPairs.length, refSec.length),
    };
  }
  if (ref.vocalSegments) {
    const reference = mergeIntervals(ref.vocalSegments);
    const vocals = det.vocals;
    const barSec = 240 / det.bpm;
    const detected = mergeIntervals((vocals?.segments ?? []).map((segment) => ({
      startSec: det.grid.firstDownbeatSec + segment.startBar * barSec,
      endSec: det.grid.firstDownbeatSec + segment.endBar * barSec,
    })));
    const referenceSec = intervalDuration(reference);
    const detectedSec = intervalDuration(detected);
    const truePositiveSec = overlapDuration(reference, detected);
    const precision = detectedSec ? truePositiveSec / detectedSec : referenceSec ? 0 : 1;
    const recall = referenceSec ? truePositiveSec / referenceSec : detectedSec ? 0 : 1;
    // Calibrate the exact smoothed fused score consumed by segmentVocals, not the raw model output.
    const curve = vocals?.curve ?? [];
    let brier = 0;
    const thresholds = Array.from({ length: 9 }, (_, index) => ({
      threshold: (index + 1) / 10, truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0,
    }));
    for (let bar = 0; bar < curve.length; bar++) {
      const midpoint = det.grid.firstDownbeatSec + (bar + 0.5) * barSec;
      const expected = reference.some((v) => midpoint >= v.startSec && midpoint < v.endSec) ? 1 : 0;
      brier += (curve[bar] - expected) ** 2;
      for (const stat of thresholds) {
        const present = curve[bar] >= stat.threshold;
        if (present && expected) stat.truePositive++;
        else if (present) stat.falsePositive++;
        else if (expected) stat.falseNegative++;
        else stat.trueNegative++;
      }
    }
    out.vocals = {
      truePositiveSec,
      referenceSec,
      detectedSec,
      precision,
      recall,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
      intersectionOverUnion: referenceSec + detectedSec - truePositiveSec
        ? truePositiveSec / (referenceSec + detectedSec - truePositiveSec) : 1,
      brier: curve.length ? brier / curve.length : 0,
      bars: curve.length,
      thresholds,
    };
  }
  if (ref.vocalPresence !== undefined) out.vocalClip = {
    expected: ref.vocalPresence,
    detected: Boolean(det.vocals?.segments.length),
  };
  if (ref.energyRating !== undefined && det.energy) out.energy = { reference: ref.energyRating, detected: det.energy.score };
  return out;
}

/** Spearman rank correlation (energy ratings vs scores across tracks). */
export function spearman(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

export interface EvaluationSummary {
  tracks: number;
  /** number of tracks each figure is computed on */
  counts: { bpm: number; grid: number; beats: number; key: number; cues: number; sections: number; vocals: number; vocalClips: number };
  bpmWithin1Pct: number;
  bpmOctaveErrors: number;
  medianPhaseErrorMs: number;
  downbeatAccuracy: number;
  beatF: number;
  downbeatF: number;
  keyMirexScore: number;
  keyExact: number;
  /** F1 of cues on the right beat (±40 ms, same kind) */
  cueExactF1: number;
  /** Share of reference cues found on the right beat */
  cueExactRecall: number;
  /** F1 of cues within ±1 beat (same kind) */
  cueF1: number;
  cueMeanOffsetBeats: number;
  sectionF1: number;
  vocalPrecision: number;
  vocalRecall: number;
  vocalF1: number;
  vocalIntersectionOverUnion: number;
  vocalBrier: number;
  vocalFalsePositiveSec: number;
  /** Best fused MusiCNN + spectral score threshold on this set; never applied automatically. */
  vocalBestThreshold: number;
  vocalThresholdF1: number;
  vocalClipPrecision: number;
  vocalClipRecall: number;
  vocalClipF1: number;
  vocalClipFalsePositives: number;
  energySpearman: number | null;
}

export function summarize(evals: TrackEvaluation[]): EvaluationSummary {
  const of = <K extends keyof TrackEvaluation>(k: K) => evals.map((e) => e[k]).filter((v): v is NonNullable<TrackEvaluation[K]> => v !== undefined);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const f1 = (m: number, r: number, d: number) => (r + d ? (2 * m) / (r + d) : 1);
  const bpm = of('bpm'), grid = of('grid'), beats = of('beats'), key = of('key'), cues = of('cues'), sections = of('sections'), vocals = of('vocals'), vocalClips = of('vocalClip'), energy = of('energy');
  const phases = grid.map((g) => Math.abs(g.phaseErrorMs)).sort((a, b) => a - b);
  const sum = <T>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
  const cuesNear = sum(cues, (c) => c.matched);
  const thresholdStats = Array.from({ length: 9 }, (_, index) => {
    const threshold = (index + 1) / 10;
    const stats = vocals.flatMap((v) => v.thresholds.filter((value) => value.threshold === threshold));
    const tp = sum(stats, (v) => v.truePositive), fp = sum(stats, (v) => v.falsePositive), fn = sum(stats, (v) => v.falseNegative);
    return { threshold, f1: 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 1 };
  });
  const bestThreshold = thresholdStats.sort((a, b) => b.f1 - a.f1 || Math.abs(a.threshold - 0.5) - Math.abs(b.threshold - 0.5))[0];
  const clipTp = vocalClips.filter((v) => v.expected && v.detected).length;
  const clipFp = vocalClips.filter((v) => !v.expected && v.detected).length;
  const clipFn = vocalClips.filter((v) => v.expected && !v.detected).length;
  return {
    tracks: evals.length,
    counts: { bpm: bpm.length, grid: grid.length, beats: beats.length, key: key.length, cues: cues.length, sections: sections.length, vocals: vocals.length, vocalClips: vocalClips.length },
    bpmWithin1Pct: mean(bpm.map((b) => (Math.abs(b.errorPct) <= 1 ? 1 : 0))),
    bpmOctaveErrors: bpm.filter((b) => b.octaveError).length,
    medianPhaseErrorMs: phases.length ? phases[Math.floor(phases.length / 2)] : 0,
    downbeatAccuracy: mean(grid.map((g) => (g.downbeatOk ? 1 : 0))),
    beatF: mean(beats.map((b) => b.fMeasure)),
    downbeatF: mean(beats.map((b) => b.downbeatF)),
    keyMirexScore: mean(key.map((k) => k.score)),
    keyExact: mean(key.map((k) => (k.score === 1 ? 1 : 0))),
    cueExactF1: f1(sum(cues, (c) => c.exact), sum(cues, (c) => c.reference), sum(cues, (c) => c.detected)),
    cueExactRecall: ratio(sum(cues, (c) => c.exact), sum(cues, (c) => c.reference)),
    cueF1: f1(cuesNear, sum(cues, (c) => c.reference), sum(cues, (c) => c.detected)),
    cueMeanOffsetBeats: cuesNear ? sum(cues, (c) => c.meanOffsetBeats * c.matched) / cuesNear : 0,
    sectionF1: f1(sum(sections, (c) => c.matched), sum(sections, (c) => c.reference), sum(sections, (c) => c.detected)),
    vocalPrecision: ratio(sum(vocals, (v) => v.truePositiveSec), sum(vocals, (v) => v.detectedSec)),
    vocalRecall: ratio(sum(vocals, (v) => v.truePositiveSec), sum(vocals, (v) => v.referenceSec)),
    vocalF1: f1(sum(vocals, (v) => v.truePositiveSec), sum(vocals, (v) => v.referenceSec), sum(vocals, (v) => v.detectedSec)),
    vocalIntersectionOverUnion: ratio(
      sum(vocals, (v) => v.truePositiveSec),
      sum(vocals, (v) => v.referenceSec + v.detectedSec - v.truePositiveSec),
    ),
    vocalBrier: ratio(sum(vocals, (v) => v.brier * v.bars), sum(vocals, (v) => v.bars)),
    vocalFalsePositiveSec: sum(vocals, (v) => v.detectedSec - v.truePositiveSec),
    vocalBestThreshold: vocals.length ? bestThreshold.threshold : 0,
    vocalThresholdF1: vocals.length ? bestThreshold.f1 : 0,
    vocalClipPrecision: clipTp + clipFp ? clipTp / (clipTp + clipFp) : 1,
    vocalClipRecall: clipTp + clipFn ? clipTp / (clipTp + clipFn) : 1,
    vocalClipF1: 2 * clipTp + clipFp + clipFn ? 2 * clipTp / (2 * clipTp + clipFp + clipFn) : 1,
    vocalClipFalsePositives: clipFp,
    energySpearman: spearman(energy.map((e) => e.reference), energy.map((e) => e.detected)),
  };
}
