import { camelotRelation } from './matching';
import type { AnalysisResult, CueKind, SectionType, VocalInfo } from './types';

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
  /** Where the annotation comes from (DJ, dataset name) */
  source?: string;
  vocalSegments?: { startSec: number; endSec: number }[];
  /** Optional energy feeling given by the DJ (1–10) */
  energyRating?: number;
}

export function referenceFrom(r: AnalysisResult, energyRating?: number): Reference {
  const bar = (4 * 60) / r.bpm;
  const vocals = (r as AnalysisResult & { vocals?: VocalInfo }).vocals;
  return {
    version: 1,
    fileHash: r.fileHash ?? '',
    path: r.path,
    fileName: r.fileName,
    title: r.title,
    createdAt: new Date().toISOString(),
    engineVersion: r.engineVersion ?? '?',
    profileId: r.profileId,
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
  bpm?: { reference: number; detected: number; errorPct: number; octaveError: boolean };
  /** Phase error of the grid, in ms (−beat/2 … +beat/2), and whether the bar start is the same beat */
  grid?: { phaseErrorMs: number; downbeatOk: boolean };
  /** Beat / downbeat tracking against annotated beat times (Harmonix-style): share of beats within ±70 ms */
  beats?: { fMeasure: number; downbeatF: number };
  /** MIREX key score: 1 exact, 0.5 fifth, 0.3 relative, 0.2 parallel, 0 otherwise */
  key?: { reference: string; detected: string; score: number };
  /**
   * Cues, matched by kind (a reference cue of kind 'custom' matches any kind):
   *  - exact: on the right beat (±40 ms) — what a DJ accepts on a CDJ
   *  - matched: within ±1 beat (kept for comparison with earlier reports)
   */
  cues?: { exact: number; matched: number; reference: number; detected: number; precision: number; recall: number; meanOffsetBeats: number; misses: CueMiss[] };
  sections?: { matched: number; reference: number; detected: number; precision: number; recall: number };
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

/** Beat times of a constant grid (or tempo map) over [0, dur). */
function gridBeats(det: AnalysisResult): { beats: number[]; downbeats: number[] } {
  const beats: number[] = [], downbeats: number[] = [];
  const P = 60 / det.bpm;
  let t = det.grid.firstDownbeatSec - Math.floor(det.grid.firstDownbeatSec / P) * P;
  const k0 = Math.round((det.grid.firstDownbeatSec - t) / P);
  for (let k = 0; t < det.durationSec; k++, t += P) {
    beats.push(t);
    if ((k - k0) % 4 === 0) downbeats.push(t);
  }
  return { beats, downbeats };
}

const fMeasure = (ref: number[], det: number[], tol: number) => {
  if (!ref.length && !det.length) return 1;
  const m = matchTimes(ref, det, tol).length;
  return ref.length + det.length ? (2 * m) / (ref.length + det.length) : 0;
};

/**
 * Compares a fresh analysis (no corrections) with a reference. Every part of the reference is optional:
 * a public dataset may annotate only the tempo, the key or the beats.
 */
export function evaluateTrack(det: AnalysisResult, ref: Reference): TrackEvaluation {
  const out: TrackEvaluation = { fileName: ref.fileName };
  const refBpm = ref.bpm ?? det.bpm;
  const beat = 60 / refBpm;
  if (ref.bpm) {
    const bpmErr = ((det.bpm - ref.bpm) / ref.bpm) * 100;
    const octave = [0.5, 2, 1 / 3, 3, 2 / 3, 1.5].some((k) => Math.abs(det.bpm / ref.bpm! - k) < 0.02);
    out.bpm = { reference: ref.bpm, detected: det.bpm, errorPct: bpmErr, octaveError: Math.abs(bpmErr) > 2 && octave };
  }
  if (ref.firstDownbeatSec !== undefined && ref.bpm) {
    // grid phase: distance between the detected downbeat and the nearest reference beat
    const rel = (det.grid.firstDownbeatSec - ref.firstDownbeatSec) / beat;
    const phase = (rel - Math.round(rel)) * beat * 1000;
    const barRel = (det.grid.firstDownbeatSec - ref.firstDownbeatSec) / (beat * 4);
    out.grid = { phaseErrorMs: phase, downbeatOk: Math.abs(barRel - Math.round(barRel)) < 0.5 / 4 };
  }
  if (ref.beats?.length) {
    const g = gridBeats(det);
    out.beats = {
      fMeasure: fMeasure(ref.beats, g.beats, BEAT_TOL_SEC),
      downbeatF: ref.downbeats?.length ? fMeasure(ref.downbeats, g.downbeats, BEAT_TOL_SEC) : 0,
    };
  }
  if (ref.keyCamelot) out.key = { reference: ref.keyCamelot, detected: det.key.camelot, score: keyScore(ref.keyCamelot, det.key.camelot) };

  if (ref.cues) {
    const refCues = ref.cues;
    const same = (i: number, j: number) => refCues[i].kind === 'custom' || refCues[i].kind === det.cues[j].kind;
    const rt = refCues.map((c) => c.timeSec);
    const dt = det.cues.map((c) => c.timeSec);
    const exact = matchTimes(rt, dt, EXACT_CUE_SEC, same);
    const near = matchTimes(rt, dt, beat + 1e-6, same);
    const misses: CueMiss[] = refCues
      .filter((c) => !exact.some(([a]) => a === c.timeSec))
      .map((c) => {
        const cands = det.cues.filter((d) => c.kind === 'custom' || d.kind === c.kind);
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
  counts: { bpm: number; grid: number; beats: number; key: number; cues: number; sections: number };
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
  energySpearman: number | null;
}

export function summarize(evals: TrackEvaluation[]): EvaluationSummary {
  const of = <K extends keyof TrackEvaluation>(k: K) => evals.map((e) => e[k]).filter((v): v is NonNullable<TrackEvaluation[K]> => v !== undefined);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const f1 = (m: number, r: number, d: number) => (r + d ? (2 * m) / (r + d) : 1);
  const bpm = of('bpm'), grid = of('grid'), beats = of('beats'), key = of('key'), cues = of('cues'), sections = of('sections'), energy = of('energy');
  const phases = grid.map((g) => Math.abs(g.phaseErrorMs)).sort((a, b) => a - b);
  const sum = <T>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
  const cuesNear = sum(cues, (c) => c.matched);
  return {
    tracks: evals.length,
    counts: { bpm: bpm.length, grid: grid.length, beats: beats.length, key: key.length, cues: cues.length, sections: sections.length },
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
    energySpearman: spearman(energy.map((e) => e.reference), energy.map((e) => e.detected)),
  };
}
