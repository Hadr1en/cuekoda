import { Bands, frameTime, median, movingAverage, percentile, prefixSums, rangeMean, timeToFrame } from './dsp';

/** Folds a tempo by octaves into [min, max). Handles Essentia's habit of returning 87 for 174 bpm DnB etc. */
export function foldBpm(bpm: number, min: number, max: number): number {
  if (!isFinite(bpm) || bpm <= 0) return bpm;
  let b = bpm;
  let guard = 0;
  while (b < min && guard++ < 6) b *= 2;
  while (b >= max && guard++ < 12) b /= 2;
  return b;
}

/**
 * Validates Essentia's tempo. Beat trackers sometimes lock on a 3:2 / 4:3 related pulse
 * (e.g. 116 instead of 174). We score the beat grid at a few related tempi, folded into the
 * allowed range, and only abandon Essentia's estimate if another candidate clearly fits better.
 */
export function chooseTempo(bands: Bands, rawBpm: number, min: number, max: number): { bpm: number; note?: string } {
  const base = foldBpm(rawBpm, min, max);
  const ratios = [1, 3 / 2, 2 / 3, 4 / 3, 3 / 4];
  const seen = new Set<number>();
  let best = { bpm: base, score: -1 };
  let baseScore = -1;
  for (const r of ratios) {
    const cand = foldBpm(base * r, min, max);
    const key = Math.round(cand);
    if (seen.has(key)) continue;
    seen.add(key);
    // Window must cover Essentia's usual error (up to ~2 bpm, e.g. 124.05 for a true 126).
    const s = fitGridComb(bands, cand, 3.5).score;
    if (r === 1) baseScore = s;
    if (s > best.score) best = { bpm: cand, score: s };
  }
  if (best.bpm !== base && best.score > baseScore * 1.15) {
    return { bpm: best.bpm, note: `Tempo Essentia ${rawBpm.toFixed(1)} remplacé par ${best.bpm.toFixed(1)} (meilleur alignement de grille)` };
  }
  return { bpm: base };
}

/**
 * Local tempo of consecutive 64-beat segments, each fitted independently within ±8 % of `bpm`.
 * Segments without a clear pulse (breakdowns) are skipped: score below half of the whole-track score.
 */
export function localTempi(bands: Bands, bpm: number, durSec: number): number[] {
  const o = detrend(bands.onset, Math.round(bands.frameRate * 0.5));
  const fr = bands.frameRate;
  const global = combScore(o, fr, bpm).s;
  const segSec = (64 * 60) / bpm;
  const out: number[] = [];
  for (let t0 = 0; t0 + segSec <= durSec; t0 += segSec) {
    const f0 = Math.max(0, Math.floor(timeToFrame(bands, t0)));
    const f1 = Math.floor(timeToFrame(bands, t0 + segSec));
    let best = { bpm, s: -1 };
    for (let b = bpm * 0.92; b <= bpm * 1.08; b += 0.05) {
      const r = combScore(o, fr, b, f0, f1);
      if (r.s > best.s) best = { bpm: b, s: r.s };
    }
    const c = best.bpm;
    for (let b = c - 0.06; b <= c + 0.06; b += 0.005) {
      const r = combScore(o, fr, b, f0, f1);
      if (r.s > best.s) best = { bpm: b, s: r.s };
    }
    if (best.s >= 0.5 * global) out.push(best.bpm);
  }
  return out;
}

/** Removes the slow-moving baseline so that only peaks (onsets) remain. */
export function detrend(o: Float32Array, win: number): Float32Array {
  const base = movingAverage(o, win);
  const out = new Float32Array(o.length);
  for (let i = 0; i < o.length; i++) out[i] = Math.max(0, o[i] - base[i]);
  return out;
}

interface CombFit {
  bpm: number;
  /** phase in seconds (time of a beat within the first period) */
  phaseSec: number;
  score: number;
}

/** Coarse grid fit: finds the tempo (around `bpmEst`) and phase that best explains the onset envelope. */
/** Mean onset strength on the best-phased grid of `bpm`, over frames [f0, f1). */
export function combScore(o: Float32Array, fr: number, bpm: number, f0 = 0, f1 = o.length): { s: number; ph: number } {
  const P = (fr * 60) / bpm;
  const nPh = Math.max(8, Math.round(P * 2));
  const end = Math.min(o.length - 1, f1);
  let best = -1;
  let bestPh = 0;
  for (let i = 0; i < nPh; i++) {
    const ph = (P * i) / nPh;
    let s = 0;
    let n = 0;
    for (let t = f0 + ph; t < end; t += P) {
      const i0 = t | 0;
      const w = t - i0;
      s += o[i0] * (1 - w) + o[i0 + 1] * w;
      n++;
    }
    s = n ? s / n : 0;
    if (s > best) {
      best = s;
      bestPh = ph;
    }
  }
  return { s: best, ph: bestPh };
}

export function fitGridComb(bands: Bands, bpmEst: number, span = 3): CombFit {
  const o = detrend(bands.onset, Math.round(bands.frameRate * 0.5));
  const fr = bands.frameRate;
  const scoreAt = (bpm: number) => combScore(o, fr, bpm);

  let bestBpm = bpmEst;
  let best = scoreAt(bpmEst);
  for (let b = bpmEst - span; b <= bpmEst + span; b += 0.05) {
    if (b < 40) continue;
    const r = scoreAt(b);
    if (r.s > best.s) {
      best = r;
      bestBpm = b;
    }
  }
  const centre = bestBpm;
  for (let b = centre - 0.06; b <= centre + 0.06; b += 0.005) {
    const r = scoreAt(b);
    if (r.s > best.s) {
      best = r;
      bestBpm = b;
    }
  }
  // Convert frame phase (in frames) to seconds of the *frame centre* timeline.
  const phaseFrames = best.ph;
  const phaseSec = frameTime(bands, 0) + phaseFrames / fr;
  return { bpm: bestBpm, phaseSec, score: best.s };
}

/**
 * Sharp "attack" envelope in the time domain (positive derivative of a smoothed |x|),
 * used to place the beat grid with millisecond accuracy.
 */
export function attackEnvelope(x: Float32Array, sr: number): Float32Array {
  const a1 = Math.exp(-1 / (0.002 * sr));
  const a2 = Math.exp(-1 / (0.001 * sr));
  const d = new Float32Array(x.length);
  let env = 0;
  let prev = 0;
  let sm = 0;
  for (let i = 0; i < x.length; i++) {
    env = a1 * env + (1 - a1) * Math.abs(x[i]);
    const diff = env - prev;
    prev = env;
    sm = a2 * sm + (1 - a2) * (diff > 0 ? diff : 0);
    d[i] = sm;
  }
  return d;
}

interface Measure {
  k: number[];
  off: number[];
  str: number[];
}

function measureOffsets(d: Float32Array, sr: number, bpm: number, phaseSec: number, durSec: number, win = 0.04): Measure {
  const P = 60 / bpm;
  const k: number[] = [];
  const off: number[] = [];
  const str: number[] = [];
  const w = Math.round(win * sr);
  for (let i = 0; ; i++) {
    const t = phaseSec + i * P;
    if (t > durSec - win) break;
    const c = Math.round(t * sr);
    const lo = Math.max(0, c - w);
    const hi = Math.min(d.length - 1, c + w);
    let bi = lo;
    let bv = -1;
    for (let n = lo; n <= hi; n++) {
      if (d[n] > bv) {
        bv = d[n];
        bi = n;
      }
    }
    k.push(i);
    off.push(bi / sr - t);
    str.push(bv);
  }
  return { k, off, str };
}

interface RobustFit {
  intercept: number;
  slope: number;
  mad: number;
  inlierFrac: number;
  used: number;
}

function strongIdx(m: Measure): number[] {
  const thr = 0.5 * percentile(m.str, 75);
  const idx: number[] = [];
  for (let i = 0; i < m.str.length; i++) if (m.str[i] >= thr) idx.push(i);
  return idx;
}

function robustFit(m: Measure, fitSlope: boolean): RobustFit {
  const idx = strongIdx(m);
  if (idx.length < 8) return { intercept: 0, slope: 0, mad: 1, inlierFrac: 0, used: idx.length };
  let slope = 0;
  if (fitSlope && idx.length >= 32) {
    // Theil-Sen estimator on a subsample
    const step = Math.max(1, Math.floor(idx.length / 160));
    const sub = idx.filter((_, j) => j % step === 0);
    const slopes: number[] = [];
    for (let a = 0; a < sub.length; a++) {
      for (let b = a + 1; b < sub.length; b++) {
        const dk = m.k[sub[b]] - m.k[sub[a]];
        if (dk >= 16) slopes.push((m.off[sub[b]] - m.off[sub[a]]) / dk);
      }
    }
    if (slopes.length) slope = median(slopes);
  }
  const adj = idx.map((i) => m.off[i] - slope * m.k[i]);
  const intercept = median(adj);
  const res = adj.map((v) => Math.abs(v - intercept));
  const mad = median(res);
  let inl = 0;
  for (const r of res) if (r <= 0.012) inl++;
  return { intercept, slope, mad, inlierFrac: inl / res.length, used: idx.length };
}

export interface GridResult {
  bpm: number;
  /** time (s) of a beat in [0, period) */
  firstBeatSec: number;
  confidence: number;
  /** local tempo range over ~64-beat segments, and whether it varies by more than 1 % */
  localMin: number;
  localMax: number;
  variable: boolean;
}

/**
 * Full grid estimation: comb fit on the onset envelope, then ms-accurate refinement with
 * the time-domain attack envelope (phase + tempo drift), then snap to "round" tempos
 * (integer or .5 bpm, typical for DAW-produced dance music) when that fits equally well.
 */
export function estimateGrid(
  x: Float32Array,
  sr: number,
  bands: Bands,
  bpmEst: number,
  opts: { fixedBpm?: boolean; fixedPhaseSec?: number } = {},
): GridResult {
  const durSec = x.length / sr;
  const d = attackEnvelope(x, sr);
  let bpm: number;
  let phase: number;

  if (opts.fixedBpm && opts.fixedPhaseSec !== undefined) {
    // Fully user-defined grid: keep it as is, only measure how well it fits.
    bpm = bpmEst;
    phase = opts.fixedPhaseSec;
  } else if (opts.fixedBpm) {
    // User-defined tempo: only the phase is fitted.
    bpm = bpmEst;
    const comb = fitGridComb(bands, bpm, 0);
    phase = comb.phaseSec;
    const m = measureOffsets(d, sr, bpm, ((phase % (60 / bpm)) + 60 / bpm) % (60 / bpm), durSec);
    const fit = robustFit(m, false);
    if (fit.used >= 8) phase += fit.intercept;
  } else {
    const comb = fitGridComb(bands, bpmEst);
    bpm = comb.bpm;
    phase = comb.phaseSec;
    const P0 = 60 / bpm;
    phase = ((phase % P0) + P0) % P0;

    // pass 1: tempo + phase from time-domain offsets
    let m = measureOffsets(d, sr, bpm, phase, durSec);
    let fit = robustFit(m, true);
    if (fit.used >= 8) {
      const P = 60 / bpm + fit.slope;
      bpm = 60 / P;
      phase += fit.intercept;
    }
    // pass 2: re-centre windows
    m = measureOffsets(d, sr, bpm, phase, durSec, 0.02);
    fit = robustFit(m, true);
    if (fit.used >= 8) {
      const P = 60 / bpm + fit.slope;
      bpm = 60 / P;
      phase += fit.intercept;
    }

    // snap to round tempos if equally good
    const fitted = { bpm, phase, mad: fit.mad };
    const candidates = new Set<number>([Math.round(bpm), Math.round(bpm * 2) / 2]);
    for (const c of candidates) {
      if (Math.abs(c - bpm) > 0.04) continue;
      const mc = measureOffsets(d, sr, c, phase, durSec, 0.02);
      const fc = robustFit(mc, false);
      if (fc.used >= 8 && fc.mad <= fitted.mad * 1.25 + 0.0007) {
        bpm = c;
        phase += fc.intercept;
        break;
      }
    }
  }

  // final confidence at the chosen grid
  const P = 60 / bpm;
  phase = ((phase % P) + P) % P;
  const mf = measureOffsets(d, sr, bpm, phase, durSec, 0.02);
  const ff = robustFit(mf, false);
  const confidence = ff.used >= 16 ? ff.inlierFrac : 0;

  // Tempo stability: tempo of each ~64-beat segment estimated on its own (grid fit within ±8 % of the
  // global tempo), so a tempo step is seen even when the global grid drifts far away from the beats.
  const local = localTempi(bands, bpm, durSec);
  const localMin = local.length ? Math.min(...local) : bpm;
  const localMax = local.length ? Math.max(...local) : bpm;
  const variable = local.length >= 2 && (localMax - localMin) / bpm > 0.01;
  return { bpm, firstBeatSec: phase, confidence, localMin, localMax, variable };
}

/**
 * Finds which of the 4 beats of a bar is the downbeat (beat 1).
 * Musical changes (new phrase, drop, breakdown) land on bar boundaries, so the beat phase
 * (mod 4) with the largest energy change around it is the downbeat.
 * Returns offset k0 in 0..3 (beats with index i where i % 4 === k0 are downbeats) and whether
 * the vote was decisive (otherwise the beat where the audio starts is used).
 */
export function pickDownbeatOffset(
  bands: Bands,
  bpm: number,
  firstBeatSec: number,
  firstAudibleSec: number,
  durSec: number,
): { offset: number; confident: boolean } {
  const P = 60 / bpm;
  const pL = prefixSums(bands.eLow);
  const pM = prefixSums(bands.eMid);
  const pH = prefixSums(bands.eHigh);
  const nBeats = Math.floor((durSec - firstBeatSec) / P);
  const score = [0, 0, 0, 0];
  // One-beat windows give a sharp, single-beat peak exactly on a section boundary
  // (wider windows saturate in the log domain and blur the position by a beat or two).
  const win = 1;
  const lg = (v: number) => Math.log10(v + 1e-6);
  // Section-change strength at every beat: how different is the next beat from the previous one?
  const D = new Float64Array(Math.max(0, nBeats));
  for (let i = win; i < nBeats - win; i++) {
    const t = firstBeatSec + i * P;
    const fa = timeToFrame(bands, t - win * P);
    const fb = timeToFrame(bands, t);
    const fc = timeToFrame(bands, t + win * P);
    let delta = 0;
    for (const pre of [pL, pM, pH]) {
      delta += Math.abs(lg(rangeMean(pre, fb, fc)) - lg(rangeMean(pre, fa, fb)));
    }
    D[i] = delta;
  }
  // Only the strong, sharp peaks (drops, breakdowns, phrase changes) vote: they sit on bar
  // boundaries, whereas the ripple between them (claps, hats) would drown a plain sum.
  let dMax = 0;
  for (let i = 0; i < D.length; i++) dMax = Math.max(dMax, D[i]);
  const thr = Math.max(0.4 * dMax, 0.15);
  for (let i = win; i < nBeats - win; i++) {
    if (D[i] < thr) continue;
    let isMax = true;
    for (let j = i - 2; j <= i + 2 && isMax; j++) if (j !== i && D[j] > D[i]) isMax = false;
    if (isMax) score[i % 4] += D[i];
  }
  // Intros begin on a downbeat: the beat where the audio starts is the fallback answer.
  const first = Math.max(0, Math.ceil((firstAudibleSec - 0.15 * P - firstBeatSec) / P)) % 4;
  let best = 0;
  for (let o = 1; o < 4; o++) if (score[o] > score[best]) best = o;
  const second = Math.max(...score.filter((_, o) => o !== best));
  const confident = score[best] >= 1.5 * second && score[best] > 0;
  const chosen = confident ? best : first;
  if (process.env.CUEKODA_DEBUG) console.error(`# downbeat scores ${score.map((s) => s.toFixed(1)).join(' ')} -> ${chosen}${confident ? '' : ' (fallback: first audible beat)'} (firstBeat=${firstBeatSec.toFixed(3)} firstAudible=${firstAudibleSec.toFixed(2)})`);
  return { offset: chosen, confident };
}
