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
  bpm: number;
  firstDownbeatSec: number;
  key: string; // musical, e.g. "F#m"
  keyCamelot: string;
  cues: { kind: CueKind; name: string; timeSec: number }[];
  sections: { type: SectionType; label: string; startSec: number }[];
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

export interface TrackEvaluation {
  fileName: string;
  bpm: { reference: number; detected: number; errorPct: number; octaveError: boolean };
  /** Phase error of the grid, in ms (−beat/2 … +beat/2), and whether the bar start is the same beat */
  grid: { phaseErrorMs: number; downbeatOk: boolean };
  /** MIREX key score: 1 exact, 0.5 fifth, 0.3 relative, 0.2 parallel, 0 otherwise */
  key: { reference: string; detected: string; score: number };
  cues: { matched: number; reference: number; detected: number; precision: number; recall: number; meanOffsetBeats: number };
  sections: { matched: number; reference: number; detected: number; precision: number; recall: number };
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
export function matchTimes(ref: number[], det: number[], tol: number): [number, number][] {
  const pairs: { i: number; j: number; d: number }[] = [];
  ref.forEach((r, i) => det.forEach((t, j) => {
    const d = Math.abs(r - t);
    if (d <= tol) pairs.push({ i, j, d });
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

/**
 * Compares a fresh analysis (no corrections) with the DJ's reference.
 * Tolerances: cues ±1 beat, section boundaries ±1 bar — what matters on a CDJ / controller.
 */
export function evaluateTrack(det: AnalysisResult, ref: Reference): TrackEvaluation {
  const beat = 60 / ref.bpm;
  const bpmErr = ((det.bpm - ref.bpm) / ref.bpm) * 100;
  const octave = [0.5, 2, 1 / 3, 3, 2 / 3, 1.5].some((k) => Math.abs(det.bpm / ref.bpm - k) < 0.02);
  // grid phase: distance between the detected downbeat and the nearest reference beat
  const rel = (det.grid.firstDownbeatSec - ref.firstDownbeatSec) / beat;
  const phase = (rel - Math.round(rel)) * beat * 1000;
  const barRel = (det.grid.firstDownbeatSec - ref.firstDownbeatSec) / (beat * 4);
  const downbeatOk = Math.abs(barRel - Math.round(barRel)) < 0.5 / 4; // same beat within the bar

  const refCues = ref.cues.map((c) => c.timeSec);
  const detCues = det.cues.map((c) => c.timeSec);
  const cuePairs = matchTimes(refCues, detCues, beat);
  const meanOffset = cuePairs.length ? cuePairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / cuePairs.length / beat : 0;

  const refSec = ref.sections.map((s) => s.startSec).slice(1); // the first boundary is the track start
  const detSec = (det.sections ?? []).map((s) => s.startSec).slice(1);
  const secPairs = matchTimes(refSec, detSec, beat * 4);

  return {
    fileName: ref.fileName,
    bpm: { reference: ref.bpm, detected: det.bpm, errorPct: bpmErr, octaveError: Math.abs(bpmErr) > 2 && octave },
    grid: { phaseErrorMs: phase, downbeatOk },
    key: { reference: ref.keyCamelot, detected: det.key.camelot, score: keyScore(ref.keyCamelot, det.key.camelot) },
    cues: {
      matched: cuePairs.length,
      reference: refCues.length,
      detected: detCues.length,
      precision: ratio(cuePairs.length, detCues.length),
      recall: ratio(cuePairs.length, refCues.length),
      meanOffsetBeats: meanOffset,
    },
    sections: {
      matched: secPairs.length,
      reference: refSec.length,
      detected: detSec.length,
      precision: ratio(secPairs.length, detSec.length),
      recall: ratio(secPairs.length, refSec.length),
    },
    energy: ref.energyRating !== undefined && det.energy ? { reference: ref.energyRating, detected: det.energy.score } : undefined,
  };
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
  bpmWithin1Pct: number;
  bpmOctaveErrors: number;
  medianPhaseErrorMs: number;
  downbeatAccuracy: number;
  keyMirexScore: number;
  keyExact: number;
  cueF1: number;
  cueMeanOffsetBeats: number;
  sectionF1: number;
  energySpearman: number | null;
}

export function summarize(evals: TrackEvaluation[]): EvaluationSummary {
  const n = evals.length || 1;
  const sum = (f: (e: TrackEvaluation) => number) => evals.reduce((s, e) => s + f(e), 0);
  const f1 = (m: number, r: number, d: number) => (r + d ? (2 * m) / (r + d) : 1);
  const phases = evals.map((e) => Math.abs(e.grid.phaseErrorMs)).sort((a, b) => a - b);
  const energy = evals.filter((e) => e.energy);
  const cuesMatched = sum((e) => e.cues.matched);
  return {
    tracks: evals.length,
    bpmWithin1Pct: sum((e) => (Math.abs(e.bpm.errorPct) <= 1 ? 1 : 0)) / n,
    bpmOctaveErrors: sum((e) => (e.bpm.octaveError ? 1 : 0)),
    medianPhaseErrorMs: phases.length ? phases[Math.floor(phases.length / 2)] : 0,
    downbeatAccuracy: sum((e) => (e.grid.downbeatOk ? 1 : 0)) / n,
    keyMirexScore: sum((e) => e.key.score) / n,
    keyExact: sum((e) => (e.key.score === 1 ? 1 : 0)) / n,
    cueF1: f1(cuesMatched, sum((e) => e.cues.reference), sum((e) => e.cues.detected)),
    cueMeanOffsetBeats: cuesMatched ? sum((e) => e.cues.meanOffsetBeats * e.cues.matched) / cuesMatched : 0,
    sectionF1: f1(sum((e) => e.sections.matched), sum((e) => e.sections.reference), sum((e) => e.sections.detected)),
    energySpearman: spearman(energy.map((e) => e.energy!.reference), energy.map((e) => e.energy!.detected)),
  };
}
