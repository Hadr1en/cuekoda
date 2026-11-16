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

/** Pearson similarity of an onset envelope with a delayed copy, interpolating fractional frames. */
function pulseSimilarity(onsets: Float32Array, lag: number): number {
  const offset = Math.floor(lag);
  const fraction = lag - offset;
  const n = onsets.length - offset - 1;
  if (n <= 0) return 0;
  let sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0;
  for (let i = 0; i < n; i++) {
    const a = onsets[i];
    const b = onsets[i + offset] * (1 - fraction) + onsets[i + offset + 1] * fraction;
    sumA += a;
    sumB += b;
    sumAA += a * a;
    sumBB += b * b;
    sumAB += a * b;
  }
  const variance = (sumAA - sumA * sumA / n) * (sumBB - sumB * sumB / n);
  return variance > 0 ? (sumAB - sumA * sumB / n) / Math.sqrt(variance) : 0;
}

function barPeriodicity(bands: Bands, candidates: CombFit[]): CombFit | undefined {
  const win = Math.round(bands.frameRate * 0.5);
  const envelopes = [bands.onset, bands.fluxLow, bands.fluxMid].map((onsets) => detrend(onsets, win));
  const ranked = candidates.map((candidate) => {
    const beat = 60 * bands.frameRate / candidate.bpm;
    // Half a bar, a bar and two bars. Repeating syncopation can support the correct pulse
    // even when the individual beats fit less well than a misleading 3:2 grid.
    const periodicity = envelopes.reduce((sum, o) => sum
      + 0.2 * pulseSimilarity(o, 2 * beat)
      + 0.6 * pulseSimilarity(o, 4 * beat)
      + 0.2 * pulseSimilarity(o, 8 * beat), 0) / envelopes.length;
    return { candidate, periodicity };
  });
  const base = ranked[0];
  const best = ranked.reduce((a, b) => b.periodicity > a.periodicity ? b : a, base);
  return best.periodicity > base.periodicity + 0.1 ? best.candidate : undefined;
}

/**
 * Validates Essentia's tempo on related pulses. In the EDM profile, repeated rhythmic
 * patterns can break a tie, provided the alternative already fits individual beats.
 */
export function chooseTempo(bands: Bands, rawBpm: number, min: number, max: number, preferRepeatedBars = false): { bpm: number; note?: string } {
  const base = foldBpm(rawBpm, min, max);
  const ratios = [1, 3 / 2, 2 / 3, 4 / 3, 3 / 4];
  const seen = new Set<number>();
  const candidates: { center: number; fit: CombFit }[] = [];
  for (const ratio of ratios) {
    const center = foldBpm(base * ratio, min, max);
    const key = Math.round(center);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ center, fit: fitGridComb(bands, center, 3.5) });
  }
  const first = candidates[0];
  const best = candidates.reduce((a, b) => b.fit.score > a.fit.score ? b : a, first);
  const selected = best.fit.score > first.fit.score * 1.15 ? best : first;
  if (preferRepeatedBars && selected.fit.score > 0 && bands.frames >= 20 * bands.frameRate) {
    const alternatives = candidates
      .filter((c) => c !== selected && c.fit.bpm >= min && c.fit.bpm < max && c.fit.score >= selected.fit.score * 0.85)
      .map((c) => c.fit);
    const preferred = alternatives.length ? barPeriodicity(bands, [selected.fit, ...alternatives]) : undefined;
    // Correct undercounted beats. A slower candidate can make a genuine three-beat
    // measure look like four beats by subdividing it, as in the Ballroom waltzes.
    if (preferred && preferred.bpm > selected.fit.bpm * 1.1) {
      return { bpm: preferred.bpm, note: `Tempo ${selected.center.toFixed(1)} remplacé par ${preferred.bpm.toFixed(1)} (motif rythmique récurrent)` };
    }
  }
  if (selected !== first) {
    return { bpm: selected.center, note: `Tempo Essentia ${rawBpm.toFixed(1)} remplacé par ${selected.center.toFixed(1)} (meilleur alignement de grille)` };
  }
  return { bpm: base };
}

/**
 * Rechecks an EDM estimate against periodicity peaks independently of the initial tempo family.
 * A faster grid needs corroboration from beat alignment, the onset envelope and the bass band.
 * Half-time readings remain available for review because both readings can fit the same breakbeat.
 */
export function recheckEdmTempo(bands: Bands, initialBpm: number): { bpm: number; halfTime?: number } {
  if (!Number.isFinite(initialBpm) || initialBpm <= 0 || bands.frames < 8 * bands.frameRate) {
    return { bpm: initialBpm };
  }
  const rate = bands.frameRate;
  const window = Math.round(rate * 0.5);
  const onsets = detrend(bands.onset, window);
  const bass = detrend(bands.fluxLow, window);
  const base = fitGridComb(bands, initialBpm, 3);
  if (base.score <= 0) return { bpm: initialBpm };
  const beat = (bpm: number) => 60 * rate / bpm;
  const measureEvidence = (lag: number) =>
    0.3 * pulseSimilarity(onsets, 2 * lag) + 0.5 * pulseSimilarity(onsets, 4 * lag) + 0.2 * pulseSimilarity(onsets, 8 * lag);
  const beatEvidence = (lag: number) => (pulseSimilarity(onsets, lag) + pulseSimilarity(bass, lag)) / 2;

  const baseLag = beat(base.bpm);
  const strengths: { lag: number; score: number }[] = [];
  for (let lag = 15; lag <= Math.ceil(beat(50)); lag++) {
    strengths.push({ lag, score: (beatEvidence(lag) + beatEvidence(lag * 2)) / 2 });
  }
  const peaks = strengths.filter((p, i) => i > 0 && i < strengths.length - 1
    && p.score >= strengths[i - 1].score && p.score > strengths[i + 1].score)
    .sort((a, b) => b.score - a.score).slice(0, 7);
  const fasterCenters = [base.bpm * 2, ...peaks.map(({ lag }) => 60 * rate / lag)];
  const minFasterBpm = base.bpm * 1.06;
  const minBeatEvidence = beatEvidence(baseLag) + 0.05;
  const minMeasureEvidence = measureEvidence(baseLag) + 0.08;
  let faster: CombFit | undefined;
  for (const [index, center] of fasterCenters.entries()) {
    if (center < 55 || center > 210 || center + 4 <= minFasterBpm) continue;
    const fit = fitGridComb(bands, center, index === 0 ? 2 : 4);
    if (fit.bpm > minFasterBpm && fit.bpm <= 210
      && fit.score >= base.score * 1.05 && fit.score > (faster?.score ?? 0)
      && measureEvidence(beat(fit.bpm)) >= minMeasureEvidence
      && beatEvidence(beat(fit.bpm)) >= minBeatEvidence) {
      faster = fit;
    }
  }
  if (faster) return { bpm: faster.bpm };

  if (base.bpm < 158 || base.bpm / 2 >= 92) return { bpm: initialBpm };
  const half = fitGridComb(bands, base.bpm / 2, 2);
  const halfLag = beat(half.bpm);
  if (half.bpm >= 90 || half.score < base.score * 1.1
    || pulseSimilarity(bass, halfLag) < pulseSimilarity(bass, baseLag) + 0.31
    || pulseSimilarity(onsets, 4 * halfLag) < pulseSimilarity(onsets, 4 * baseLag)) return { bpm: initialBpm };
  const third = bass.length / 3;
  const stableSections = [0, 1, 2].filter((i) =>
    pulseSimilarity(bass.subarray(Math.floor(i * third), Math.floor((i + 1) * third)), halfLag) >= 0.4);
  return { bpm: initialBpm, halfTime: stableSections.length >= 2 ? half.bpm : undefined };
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

const GRID_TOLERANCE_SEC = 0.012;

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
  if (idx.length < 8) return { intercept: 0, slope: 0, mad: 1, used: idx.length };
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
  return { intercept, slope, mad, used: idx.length };
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

/** Finds a steadier pulse in the bass when the general onset grid follows offbeat percussion. */
export function technoBassPhase(bands: Bands, grid: GridResult): number | undefined {
  if (grid.variable || bands.frames < 30 * bands.frameRate) return undefined;
  const bins = 40;
  const histograms = Array.from({ length: 3 }, () => new Float64Array(bins));
  const bass = detrend(bands.fluxLow, Math.round(bands.frameRate * 0.5));
  const period = 60 / grid.bpm;
  for (let i = 0; i < bass.length; i++) {
    const cycles = (frameTime(bands, i) - grid.firstBeatSec) / period;
    const phase = cycles - Math.floor(cycles);
    histograms[Math.floor(3 * i / bass.length)][Math.floor(bins * phase)] += bass[i];
  }
  const pool = Float64Array.from(histograms[0], (v, i) => v + histograms[1][i] + histograms[2][i]);
  const power = (h: Float64Array, i: number) => h[(i + bins - 1) % bins] + h[i] + h[(i + 1) % bins];
  let peak = 0;
  for (let i = 1; i < bins; i++) {
    if (power(pool, i) > power(pool, peak)) peak = i;
  }
  const shift = (peak + 0.5) / bins;
  if (shift < 0.35 || shift > 0.65 || power(pool, peak) < 0.2 * pool.reduce((a, b) => a + b, 0)) return undefined;
  // Require the same alternate pulse throughout the track, including before and after the break.
  if (!histograms.every((h) => {
    const current = Math.max(power(h, bins - 1), power(h, 0), power(h, 1));
    return power(h, peak) > 0 && power(h, peak) >= 1.75 * current;
  })) return undefined;
  return (grid.firstBeatSec + shift * period) % period;
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
    const strong = strongIdx(m);
    const beatSpan = strong.length > 1 ? m.k[strong[strong.length - 1]] - m.k[strong[0]] : 0;
    const periodSec = 60 / bpm;
    const candidates = new Set<number>([Math.round(bpm), Math.round(bpm * 2) / 2]);
    for (const c of candidates) {
      if (Math.abs(c - bpm) > 0.04) continue;
      const mc = measureOffsets(d, sr, c, phase, durSec, 0.02);
      const fc = robustFit(mc, false);
      if (fc.used < 8 || fc.mad > fit.mad * 1.25 + 0.0007) continue;
      const addedDrift = beatSpan * Math.abs(60 / c - periodSec);
      if (addedDrift > GRID_TOLERANCE_SEC / 2) {
        // A small median error can hide drift if only a few attacks line up.
        // Compare the number of aligned attacks over the full audible grid.
        const fitted = measureOffsets(d, sr, bpm, phase, durSec, 0.02);
        const rounded = measureOffsets(d, sr, c, phase + fc.intercept, durSec, 0.02);
        const alignedCount = (m: Measure) =>
          strongIdx(m).filter((i) => Math.abs(m.off[i]) <= GRID_TOLERANCE_SEC).length;
        if (alignedCount(rounded) < alignedCount(fitted) + fitted.k.length * 0.05) continue;
      }
      bpm = c;
      phase += fc.intercept;
      break;
    }
  }

  // final confidence at the chosen grid
  const P = 60 / bpm;
  phase = ((phase % P) + P) % P;
  const mf = measureOffsets(d, sr, bpm, phase, durSec, 0.02);
  const anchors = strongIdx(mf);
  const aligned = anchors.filter((i) => Math.abs(mf.off[i]) <= GRID_TOLERANCE_SEC);
  const confidence = anchors.length >= 16 ? aligned.length / anchors.length : 0;

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
  comparePhraseChanges = false,
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
  // Only frames lying fully inside each one-beat window: a frame straddling the beat line leaks the
  // next beat's attack into the previous window (a drop's first kick) and can shift the vote by a beat.
  const firstIn = (t: number) => Math.ceil((t * bands.sr) / bands.hop);
  const endIn = (t: number) => Math.floor((t * bands.sr - bands.frameSize) / bands.hop) + 1;
  for (let i = win; i < nBeats - win; i++) {
    const t = firstBeatSec + i * P;
    // the start of the music is not a section change (silence → sound would dominate the vote and
    // push the real drops under the threshold); it is used as the fallback below instead
    if (t < firstAudibleSec + 4.5 * P) continue; // first bar of music excluded
    const a0 = firstIn(t - win * P), a1 = endIn(t);
    const b0 = firstIn(t), b1 = endIn(t + win * P);
    if (a1 <= a0 || b1 <= b0) continue;
    let delta = 0;
    for (const pre of [pL, pM, pH]) {
      delta += Math.abs(lg(rangeMean(pre, b0, b1)) - lg(rangeMean(pre, a0, a1)));
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
    if (isMax) {
      score[i % 4] += D[i];
      if (process.env.CUEKODA_DEBUG) {
        const t = firstBeatSec + i * P;
        const parts = [pL, pM, pH].map((pre) => (lg(rangeMean(pre, firstIn(t), endIn(t + P))) - lg(rangeMean(pre, firstIn(t - P), endIn(t)))).toFixed(2));
        console.error(`#  vote t=${t.toFixed(2)} offset=${i % 4} D=${D[i].toFixed(2)} (low ${parts[0]} mid ${parts[1]} high ${parts[2]})`);
      }
    }
  }
  // Kick / bass entries (the low band jumps ≥ 6 dB from one beat to the next and stays up for 3 beats)
  // land on beat 1 in dance music: they vote too, and weigh more than generic energy changes.
  // Validated on 13 real tracks + the DJ's corrections (docs/ALGORITHMES.md).
  const lowDb = new Float64Array(Math.max(0, nBeats));
  for (let i = 0; i < nBeats; i++) {
    const t = firstBeatSec + i * P;
    const a = firstIn(t), b = endIn(t + P);
    lowDb[i] = b > a ? 10 * Math.log10(rangeMean(pL, a, b) + 1e-9) : -120;
  }
  // An entry is the beat where the low band REACHES its new level (within 2 dB of the median of the
  // next 4 beats) after a rise of ≥ 6 dB — not the first beat of a swell / riser leading into it
  // (on "Heroes" the sub swells over two beats before the drop's downbeat).
  const entry = [0, 0, 0, 0];
  for (let i = 3; i < nBeats - 4; i++) {
    if (firstBeatSec + i * P < firstAudibleSec + 4.5 * P) continue;
    const plateau = [lowDb[i], lowDb[i + 1], lowDb[i + 2], lowDb[i + 3]].sort((x, y) => x - y)[1] / 2 +
      [lowDb[i], lowDb[i + 1], lowDb[i + 2], lowDb[i + 3]].sort((x, y) => x - y)[2] / 2;
    const before = Math.min(lowDb[i - 1], lowDb[i - 2], lowDb[i - 3]);
    const rise = plateau - before;
    if (lowDb[i] >= plateau - 2 && lowDb[i - 1] <= plateau - 3 && rise >= 6) {
      entry[i % 4] += Math.min(rise, 20);
      i += 3; // one entry per event
    }
  }
  const total = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const sChange = total(score), sEntry = total(entry);
  // entries are the most reliable cue (confirmed by the DJ's corrections) once there is real evidence
  const wEntry = sEntry >= 12 ? (sChange > 0 ? 0.75 : 1) : sEntry > 0 ? 0.4 : 0;
  const combined = [0, 1, 2, 3].map(
    (o) => (sChange > 0 ? (1 - wEntry) * (score[o] / sChange) : 0) + (sEntry > 0 ? wEntry * (entry[o] / sEntry) : 0),
  );
  if (comparePhraseChanges) {
    // A short transient can mimic a section change. Require a sharp edge with different energy
    // on both sides across two, four and eight beats, then pool evidence along the track.
    const phrase = new Float64Array(D.length);
    let strongest = 0;
    for (let i = 8; i < nBeats - 8; i++) {
      const t = firstBeatSec + i * P;
      if (t < firstAudibleSec + 16 * P) continue;
      let change = Infinity;
      for (const span of [2, 4, 8]) {
        let delta = 0;
        for (const pre of [pL, pM, pH]) {
          delta += Math.abs(lg(rangeMean(pre, firstIn(t), endIn(t + span * P))) - lg(rangeMean(pre, firstIn(t - span * P), endIn(t))));
        }
        change = Math.min(change, delta / 3);
      }
      phrase[i] = change * Math.min(1.5, D[i] / 3);
      strongest = Math.max(strongest, phrase[i]);
    }
    const votes = [0, 0, 0, 0];
    const floor = Math.max(0.23, 0.37 * strongest);
    for (let i = 8; i < nBeats - 8; i++) {
      if (phrase[i] < floor) continue;
      if (phrase.subarray(i - 3, i + 4).every((value) => value <= phrase[i])) votes[i % 4] += phrase[i];
    }
    const totalVotes = total(votes);
    if (totalVotes > 0) {
      for (let i = 0; i < 4; i++) combined[i] = 0.75 * combined[i] + 0.25 * votes[i] / totalVotes;
    }
  }
  // Intros begin on a downbeat: the beat where the audio starts is the fallback answer.
  const first = Math.max(0, Math.ceil((firstAudibleSec - 0.15 * P - firstBeatSec) / P)) % 4;
  let best = 0;
  for (let o = 1; o < 4; o++) if (combined[o] > combined[best]) best = o;
  const second = Math.max(...combined.filter((_, o) => o !== best));
  const confident = combined[best] >= 1.5 * second && combined[best] > 0;
  // a close vote still beats an arbitrary guess: keep the best candidate, flagged as uncertain;
  // the start of the music is only used when there is no evidence at all
  const chosen = combined[best] > 0 ? best : first;
  if (process.env.CUEKODA_DEBUG) console.error(`# downbeat changes ${score.map((s) => s.toFixed(1)).join(' ')} entries ${entry.map((s) => s.toFixed(1)).join(' ')} -> ${chosen}${confident ? '' : combined[best] > 0 ? ' (incertain)' : ' (repli : début de la musique)'} (firstBeat=${firstBeatSec.toFixed(3)} firstAudible=${firstAudibleSec.toFixed(2)})`);
  return { offset: chosen, confident };
}
