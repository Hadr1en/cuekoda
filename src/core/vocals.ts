import { FFT, percentile } from './dsp';
import type { Confidence, VocalInfo, VocalSegment } from './types';
import type { VocalModelOutput } from './vocalModel';

/**
 * Local vocal detection — spectral heuristic (no model, no network, no dependency).
 *
 * Idea (after the "fluctogram" of Lehner, Widmer & Sonnleitner, ICASSP 2014): a sung voice is a
 * harmonic sound whose pitch is never still — vibrato, glides between notes, expressive drift — and
 * all its harmonics move *together*. Pads, chords, basses and most synth leads hold their pitch
 * between notes; drums and noise risers are not harmonic.
 *
 *  1. STFT (2048 / hop 512 at 22.05 kHz) → log-magnitude resampled on a log-frequency axis
 *     (400 Hz – 4 kHz, 25-cent steps).
 *  2. For 5 overlapping one-octave bands, the pitch shift between frame t-2 and t is the lag
 *     (±100 cents, parabolic refinement) that best correlates the two band spectra.
 *  3. A band "moves" when its shift stays within 5–90 cents per 46 ms for ≥ 2 consecutive frames;
 *     a frame is "moving" when ≥ 2 bands move in the same direction (coherent movement of a harmonic
 *     source). No majority vote across bands: in a real mix the voice rarely dominates every band.
 *  4. Per bar: share of moving frames, discounted when the movement is one-directional (risers,
 *     pitch sweeps). Hysteresis + minimum length turn the per-bar score into segments.
 *
 * When the local MusiCNN voice/instrumental model is available (core/vocalModel.ts), its per-patch
 * P(voice) is the main evidence and this heuristic only sharpens it to the bar (see fuseScores).
 *
 * Known blind spots of the heuristic alone (documented in docs/ALGORITHMES.md): hard-tuned / vocoded vocals (pitch flattened)
 * may be missed; synth leads with LFO vibrato, pitch-bent leads, strings or woodwinds may be detected
 * as voice; a voice buried under loud pads is not seen. Never validated on an annotated corpus, so
 * confidence never goes above 'medium'.
 */

export const VOCAL_METHOD = 'spectral-fluctuation-v1';

const N = 2048;
const HOP = 512;
const LAG = 2; // compare frame t with t-2 (46 ms): pitch movement twice as large as the jitter floor
const FMIN = 400; // below ~400 Hz: bass lines, and 25 cents is a fraction of an FFT bin
const FMAX = 4000;
const STEPS_PER_OCT = 48; // 25 cents
const CENTS_PER_STEP = 1200 / STEPS_PER_OCT;
const BAND = 48; // one octave
const BAND_HOP = 24;
const MAX_SHIFT = 4; // ±100 cents
const MIN_CORR = 0.6;
const MIN_BANDS = 2;
const MIN_MOVE_CENTS = 5;
/** A band's movement must last ≥ MIN_RUN consecutive frames (≈ 46 ms): isolated frames are jitter. */
const MIN_RUN = 2;

/** Per-bar thresholds: start / keep a vocal segment (hysteresis) and "clear voice" level. */
export interface VocalThresholds {
  on: number;
  off: number;
  strong: number;
}
/** Heuristic score alone */
export const HEURISTIC_THRESHOLDS: VocalThresholds = { on: 0.2, off: 0.13, strong: 0.32 };
/** Fused model + heuristic score (fuseScores) */
export const FUSED_THRESHOLDS: VocalThresholds = { on: 0.35, off: 0.25, strong: 0.55 };
export const VOCAL_ON = HEURISTIC_THRESHOLDS.on;
/** Below this share of tonal frames (400 Hz–4 kHz) the detector has nothing to judge: 'unknown'. */
const MIN_TONAL_SHARE = 0.15;

export interface VocalFrames {
  frameRate: number;
  /** Mean shift (cents per LAG frames) of the bands moving together, NaN when the frame is not moving */
  shift: Float32Array;
  /** 1 = coherent, non-zero pitch movement */
  moving: Uint8Array;
  /** 1 = at least MIN_BANDS tonal bands (something harmonic to judge) */
  tonal: Uint8Array;
  /** Per-band shift (cents), frame-major [f * nBands + j], NaN when the band is not tonal */
  bandShift: Float32Array;
  nBands: number;
}

/** Frame-level coherent pitch movement (step 1–3). Exported for diagnostics. */
export function vocalFrames(x: Float32Array, sr: number): VocalFrames {
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const fft = new FFT(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const binHz = sr / N;
  const nLog = Math.floor(Math.log2(FMAX / FMIN) * STEPS_PER_OCT) + 1;
  const kf = new Float32Array(nLog);
  for (let i = 0; i < nLog; i++) kf[i] = (FMIN * Math.pow(2, i / STEPS_PER_OCT)) / binHz;
  const bands: number[] = [];
  for (let b0 = 0; b0 + BAND <= nLog; b0 += BAND_HOP) bands.push(b0);

  // ring buffer of the last LAG+1 log spectra + band powers
  const ring: Float32Array[] = Array.from({ length: LAG + 1 }, () => new Float32Array(nLog));
  const ringPow: Float32Array[] = Array.from({ length: LAG + 1 }, () => new Float32Array(bands.length));
  const shift = new Float32Array(frames).fill(NaN);
  const bandShift = new Float32Array(frames * bands.length).fill(NaN);
  const moving = new Uint8Array(frames);
  const tonal = new Uint8Array(frames);
  let cents = 0;
  const corr = new Float64Array(2 * MAX_SHIFT + 1);
  const power = new Float64Array(nLog);
  const mag = new Float32Array(N / 2);
  // Per-band power floor (cheap pre-pass): bands 45 dB below their loud frames are ignored.
  const floor = bandFloors(x, bands, kf, fft, win);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < N; i++) {
      re[i] = x[off + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    const cur = ring[f % (LAG + 1)];
    const curPow = ringPow[f % (LAG + 1)];
    for (let i = 0; i < nLog; i++) {
      const k = kf[i];
      const k0 = Math.floor(k);
      const a = k - k0;
      const m = (1 - a) * mag[k0] + a * mag[Math.min(N / 2 - 1, k0 + 1)];
      cur[i] = Math.log(1e-5 + m);
      power[i] = Math.exp(2 * cur[i]);
    }
    bands.forEach((b0, j) => {
      let p = 0;
      for (let i = b0; i < b0 + BAND; i++) p += power[i];
      curPow[j] = p / BAND;
    });
    if (f < LAG) continue;
    const prev = ring[(f - LAG) % (LAG + 1)];
    const prevPow = ringPow[(f - LAG) % (LAG + 1)];
    cents = 0;
    for (let j = 0; j < bands.length; j++) {
      if (curPow[j] < floor[j] || prevPow[j] < floor[j]) continue;
      const lo = bands[j] + MAX_SHIFT;
      const hi = bands[j] + BAND - MAX_SHIFT;
      const n = hi - lo;
      let sa = 0, saa = 0;
      for (let i = lo; i < hi; i++) {
        const a = cur[i];
        sa += a;
        saa += a * a;
      }
      const va = saa - (sa * sa) / n;
      // correlation coefficient of cur[i] with prev[i - s]
      let best = -2;
      let bs = 0;
      for (let s = -MAX_SHIFT; s <= MAX_SHIFT; s++) {
        let sb = 0, sbb = 0, sab = 0;
        for (let i = lo; i < hi; i++) {
          const a = cur[i];
          const b = prev[i - s];
          sb += b; sbb += b * b; sab += a * b;
        }
        const vb = sbb - (sb * sb) / n;
        const c = va > 1e-9 && vb > 1e-9 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : 0;
        corr[s + MAX_SHIFT] = c;
        if (c > best) {
          best = c;
          bs = s;
        }
      }
      if (best < MIN_CORR) continue;
      let d = 0;
      if (bs > -MAX_SHIFT && bs < MAX_SHIFT) {
        const cm = corr[bs + MAX_SHIFT - 1];
        const c0 = corr[bs + MAX_SHIFT];
        const cp = corr[bs + MAX_SHIFT + 1];
        const den = cm - 2 * c0 + cp;
        if (den < 0) d = Math.max(-0.5, Math.min(0.5, (0.5 * (cm - cp)) / den));
      } else {
        continue; // at the edge of the search range: a jump, not a glide
      }
      cents++;
      bandShift[f * bands.length + j] = (bs + d) * CENTS_PER_STEP;
    }
    if (cents >= MIN_BANDS) tonal[f] = 1;
  }

  // Sustained movement per band: |shift| in [MIN_MOVE_CENTS, 90] for ≥ MIN_RUN consecutive frames.
  // A frame is "moving" when ≥ MIN_BANDS bands move that way in the same direction: a voice rarely
  // dominates every band (pads / leads hold the others still), so no majority vote across bands.
  const nb = bands.length;
  const bandMoving = new Uint8Array(frames * nb);
  for (let j = 0; j < nb; j++) {
    let run = 0;
    for (let f = 0; f <= frames; f++) {
      const c = f < frames ? Math.abs(bandShift[f * nb + j]) : NaN;
      if (c >= MIN_MOVE_CENTS && c <= 90) {
        run++;
        continue;
      }
      if (run >= MIN_RUN) for (let i = f - run; i < f; i++) bandMoving[i * nb + j] = 1;
      run = 0;
    }
  }
  for (let f = 0; f < frames; f++) {
    let up = 0, down = 0, sumUp = 0, sumDown = 0;
    for (let j = 0; j < nb; j++) {
      if (!bandMoving[f * nb + j]) continue;
      const c = bandShift[f * nb + j];
      if (c > 0) { up++; sumUp += c; } else { down++; sumDown += c; }
    }
    if (up >= MIN_BANDS || down >= MIN_BANDS) {
      moving[f] = 1;
      shift[f] = up >= down ? sumUp / up : sumDown / down;
    }
  }
  return { frameRate: sr / HOP, shift, moving, tonal, bandShift, nBands: bands.length };
}

/** Power floor per band: 45 dB below the 95th percentile of the band's power (sampled every 8th frame). */
function bandFloors(x: Float32Array, bands: number[], kf: Float32Array, fft: FFT, win: Float32Array): number[] {
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const pw: number[][] = bands.map(() => []);
  for (let f = 0; f < frames; f += 8) {
    const off = f * HOP;
    for (let i = 0; i < N; i++) {
      re[i] = x[off + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    bands.forEach((b0, j) => {
      const k0 = Math.floor(kf[b0]);
      const k1 = Math.ceil(kf[b0 + BAND - 1]);
      let p = 0;
      for (let k = k0; k <= k1; k++) p += re[k] * re[k] + im[k] * im[k];
      pw[j].push(p / (k1 - k0 + 1));
    });
  }
  // Same scale as the main pass (mean of interpolated |X|² over log bins ≈ mean of |X|² over bins).
  return pw.map((a) => (a.length ? percentile(a, 95) * 10 ** -4.5 : 0));
}

export interface VocalBarFeatures {
  /** Share of the bar's frames with coherent pitch movement */
  moving: number[];
  /** |Σ shift| / Σ|shift| over moving frames: 1 = one-way sweep (riser), ~0 = vibrato / back-and-forth */
  direction: number[];
  /** Share of the bar's frames that are tonal at all */
  tonal: number[];
  score: number[];
}

export function vocalBarFeatures(v: VocalFrames, d0: number, barLen: number, nBars: number): VocalBarFeatures {
  const out: VocalBarFeatures = { moving: [], direction: [], tonal: [], score: [] };
  const center = (N / 2) / HOP; // frame index offset of the window centre, in frames
  for (let b = 0; b < nBars; b++) {
    const f0 = Math.max(0, Math.ceil((d0 + b * barLen) * v.frameRate - center));
    const f1 = Math.min(v.moving.length, Math.ceil((d0 + (b + 1) * barLen) * v.frameRate - center));
    let n = 0, mv = 0, tn = 0, sum = 0, sumAbs = 0;
    for (let f = f0; f < f1; f++) {
      n++;
      if (v.tonal[f]) tn++;
      if (v.moving[f]) {
        mv++;
        sum += v.shift[f];
        sumAbs += Math.abs(v.shift[f]);
      }
    }
    const m = n ? mv / n : 0;
    const dir = sumAbs > 0 ? Math.abs(sum) / sumAbs : 0;
    // one-way movement (sweeps) is not a voice: full discount from 70 % directionality
    const penalty = Math.max(0, Math.min(1, (dir - 0.35) / 0.35));
    out.moving.push(m);
    out.direction.push(dir);
    out.tonal.push(n ? tn / n : 0);
    out.score.push(m * (1 - penalty));
  }
  return out;
}

function median3(a: number[]): number[] {
  return a.map((v, i) => {
    const w = [a[Math.max(0, i - 1)], v, a[Math.min(a.length - 1, i + 1)]].sort((x, y) => x - y);
    return w[1];
  });
}

/**
 * Turns per-bar scores into segments: 3-bar median smoothing, hysteresis (on / off), one-bar gaps
 * bridged, segments shorter than 2 bars dropped. Pure — unit tested.
 */
export function segmentVocals(
  score: number[],
  d0: number,
  barLen: number,
  durSec: number,
  origin = 0,
  t: VocalThresholds = HEURISTIC_THRESHOLDS,
): { present: boolean[]; segments: VocalSegment[]; curve: number[] } {
  const n = score.length;
  const curve = median3(score).map((v, b) => (b < origin ? 0 : Math.round(Math.min(1, v) * 1000) / 1000));
  const present = new Array<boolean>(n).fill(false);
  let on = false;
  for (let b = 0; b < n; b++) {
    if (!on && curve[b] >= t.on) on = true;
    else if (on && curve[b] < t.off) on = false;
    present[b] = on;
  }
  // bridge 1-bar gaps
  for (let b = 1; b < n - 1; b++) if (!present[b] && present[b - 1] && present[b + 1]) present[b] = true;
  const segments: VocalSegment[] = [];
  let s = -1;
  for (let b = 0; b <= n; b++) {
    const v = b < n && present[b];
    if (v && s < 0) s = b;
    if (!v && s >= 0) {
      if (b - s >= 2) {
        let sum = 0;
        for (let i = s; i < b; i++) sum += curve[i];
        const mean = sum / (b - s);
        const strong = mean >= t.strong;
        // Never 'high': the detector has not been validated on annotated material.
        const confidence: Confidence = strong && b - s >= 4 ? 'medium' : 'low';
        segments.push({
          startBar: s,
          endBar: b,
          startSec: Math.max(0, d0 + s * barLen),
          endSec: Math.min(durSec, d0 + b * barLen),
          score: Math.round(mean * 1000) / 1000,
          strength: strong ? 'strong' : 'light',
          confidence,
        });
      } else {
        for (let i = s; i < b; i++) present[i] = false;
      }
      s = -1;
    }
  }
  return { present, segments, curve };
}

/** Model P(voice) per bar: mean of the patches overlapping the bar, weighted by overlap (NaN if none). */
export function modelBarProbs(m: VocalModelOutput, d0: number, barLen: number, nBars: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < nBars; b++) {
    const t0 = d0 + b * barLen;
    const t1 = t0 + barLen;
    let w = 0, sum = 0;
    const i0 = Math.max(0, Math.floor((t0 - m.winSec) / m.hopSec));
    for (let i = i0; i < m.probs.length; i++) {
      const p0 = i * m.hopSec;
      if (p0 >= t1) break;
      const ov = Math.min(t1, p0 + m.winSec) - Math.max(t0, p0);
      if (ov > 0) {
        w += ov;
        sum += ov * m.probs[i];
      }
    }
    out.push(w > 0 ? sum / w : NaN);
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Fused per-bar evidence: 0.7 × model (P(voice) mapped 0.5 → 0, 0.9 → 1) + 0.3 × heuristic (0 → 0,
 * 0.4 → 1). The model decides, the heuristic sharpens edges and backs up processed / chopped vocals.
 * Bars without a model patch fall back to the heuristic alone. Pure — unit tested.
 */
export function fuseScores(heuristic: number[], model: number[]): number[] {
  return heuristic.map((h, b) => {
    const p = model[b];
    const hn = clamp01(h / 0.4);
    if (!Number.isFinite(p)) return h;
    return 0.7 * clamp01((p - 0.5) / 0.4) + 0.3 * hn;
  });
}

/**
 * Fuses the spectral evidence with the model output and places vocal segments on the bar grid.
 */
export function detectVocals(
  feats: VocalBarFeatures,
  d0: number,
  barLen: number,
  durSec: number,
  origin: number,
  model?: VocalModelOutput | null,
  modelError?: string,
): VocalInfo {
  const nBars = feats.score.length;
  const modelCurve = model ? modelBarProbs(model, d0, barLen, nBars) : undefined;
  const score = modelCurve ? fuseScores(feats.score, modelCurve) : feats.score;
  if (process.env.CUEKODA_DEBUG) {
    feats.score.forEach((s, b) =>
      console.error(`vocal bar ${String(b).padStart(3)} heur=${s.toFixed(3)} model=${modelCurve?.[b]?.toFixed(3) ?? '-'} fused=${score[b].toFixed(3)} dir=${feats.direction[b].toFixed(2)} tonal=${feats.tonal[b].toFixed(2)}`),
    );
  }
  const { present, segments, curve } = segmentVocals(score, d0, barLen, durSec, origin, model ? FUSED_THRESHOLDS : HEURISTIC_THRESHOLDS);
  const audible = Math.max(1, nBars - origin);
  const coverage = present.filter(Boolean).length / audible;
  const tonalShare = feats.tonal.slice(origin).reduce((a, v) => a + v, 0) / audible;
  // The model judges any audio; the heuristic alone needs harmonic content to say anything.
  const informative = !!model || tonalShare >= MIN_TONAL_SHARE;
  const notes: string[] = [];
  if (!informative) notes.push('Voix difficile à détecter');
  else if (!segments.length) notes.push('Aucune voix détectée');
  if (!model) notes.push(`Heuristique seule${modelError ? ` (${modelError})` : ''}`);
  const round = (a: number[]) => a.map((v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0));
  return {
    method: model ? `${model.model}+${VOCAL_METHOD}` : VOCAL_METHOD,
    validated: false,
    curve,
    present,
    segments,
    coverage: Math.round(coverage * 1000) / 1000,
    tonalShare: Math.round(tonalShare * 1000) / 1000,
    informative,
    level: !informative ? 'low' : segments.some((s) => s.confidence === 'medium') ? 'medium' : 'low',
    ...(modelCurve ? { modelCurve: round(modelCurve), heuristicCurve: round(feats.score) } : {}),
    ...(model?.runtime ? { runtime: model.runtime } : {}),
    ...(notes.length ? { note: notes.join(' · ') } : {}),
  };
}

// ---------------------------------------------------------------- helpers for cues / mix / sections

export type VocalPresence = 'none' | 'light' | 'strong' | 'unknown';

/** What the detector says about bars [a, b): share of vocal bars and whether a strong segment is involved. */
export function vocalPresence(v: VocalInfo | undefined, a: number, b: number): { presence: VocalPresence; share: number } {
  if (!v || v.informative === false || (v.informative === undefined && v.tonalShare < MIN_TONAL_SHARE)) return { presence: 'unknown', share: 0 };
  const lo = Math.max(0, a);
  const hi = Math.min(v.present.length, b);
  if (hi <= lo) return { presence: 'none', share: 0 };
  let k = 0;
  for (let i = lo; i < hi; i++) if (v.present[i]) k++;
  const share = k / (hi - lo);
  if (share === 0) return { presence: 'none', share };
  const strong = v.segments.some((s) => s.strength === 'strong' && s.startBar < hi && s.endBar > lo);
  return { presence: strong && share >= 0.25 ? 'strong' : 'light', share };
}
