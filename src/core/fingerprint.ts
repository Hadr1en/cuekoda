import { FFT } from './dsp';

/**
 * Acoustic fingerprint for duplicate / related-version detection (spec §15): a chromagram (energy of the
 * 12 pitch classes, 65 Hz–2 kHz) averaged per bar and quantised to 0–255. Small (~12 bytes per bar),
 * insensitive to the encoding (mp3 / flac / bitrate) and to loudness, aligned on the beat grid.
 */
export interface Fingerprint {
  /** nBars × 12 values, 0–255, each bar normalised to its own maximum */
  chroma: number[];
  bars: number;
  /** tempo the bars refer to (versions are only compared at the same tempo) */
  bpm: number;
}

export function computeFingerprint(
  x: Float32Array,
  sr: number,
  d0: number,
  barLen: number,
  nBars: number,
  bpm: number,
): Fingerprint {
  const N = 4096;
  const hop = 2048;
  const fft = new FFT(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  // bin → pitch class (A4 = 440 Hz), only the musically informative range
  const pc = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    if (f < 65 || f > 2000) continue;
    pc[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; // 0 = C
  }
  const frames = Math.max(0, Math.floor((x.length - N) / hop) + 1);
  const frameChroma = new Float32Array(frames * 12);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = x[off + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 1; k < N / 2; k++) {
      const p = pc[k];
      if (p < 0) continue;
      frameChroma[f * 12 + p] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
  }
  const chroma: number[] = [];
  const acc = new Float64Array(12);
  for (let b = 0; b < nBars; b++) {
    acc.fill(0);
    const f0 = Math.max(0, Math.floor(((d0 + b * barLen) * sr) / hop));
    const f1 = Math.min(frames, Math.floor(((d0 + (b + 1) * barLen) * sr) / hop));
    for (let f = f0; f < f1; f++) for (let p = 0; p < 12; p++) acc[p] += frameChroma[f * 12 + p];
    const max = Math.max(...acc, 1e-9);
    for (let p = 0; p < 12; p++) chroma.push(Math.round((acc[p] / max) * 255));
  }
  return { chroma, bars: nBars, bpm };
}

/**
 * Pearson correlation of two 12-dim bar vectors (−1..1): centring removes the colour shared by any two
 * tracks in the same key, so only the actual note pattern of the bar counts. Flat / silent bars never match.
 */
export function barSim(a: number[], ia: number, b: number[], ib: number): number {
  let ma = 0, mb = 0;
  for (let p = 0; p < 12; p++) {
    ma += a[ia * 12 + p];
    mb += b[ib * 12 + p];
  }
  ma /= 12;
  mb /= 12;
  let dot = 0, na = 0, nb = 0;
  for (let p = 0; p < 12; p++) {
    const x = a[ia * 12 + p] - ma, y = b[ib * 12 + p] - mb;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na > 1 && nb > 1 ? dot / Math.sqrt(na * nb) : 0;
}

export interface FingerprintMatch {
  /** bar offset of B relative to A at the best alignment */
  offsetBars: number;
  /** bars compared at that alignment */
  overlapBars: number;
  /** share of the overlapped bars that match (cosine ≥ 0.9) */
  matchRatio: number;
  /** longest run of consecutive matching bars */
  longestRunBars: number;
}

/**
 * Best bar alignment between two fingerprints (offsets up to ±64 bars). Returns null when tempi differ
 * by more than 1 % (bars would not line up).
 */
export function compareFingerprints(a: Fingerprint, b: Fingerprint): FingerprintMatch | null {
  if (!a.bars || !b.bars || Math.abs(a.bpm - b.bpm) / a.bpm > 0.01) return null;
  let best: FingerprintMatch | null = null;
  const maxOff = Math.min(64, Math.max(a.bars, b.bars));
  for (let off = -maxOff; off <= maxOff; off++) {
    let overlap = 0, matches = 0, run = 0, longest = 0;
    for (let i = 0; i < a.bars; i++) {
      const j = i + off;
      if (j < 0 || j >= b.bars) continue;
      overlap++;
      if (barSim(a.chroma, i, b.chroma, j) >= 0.9) {
        matches++;
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
    }
    if (overlap < 8) continue;
    const cand = { offsetBars: off, overlapBars: overlap, matchRatio: matches / overlap, longestRunBars: longest };
    if (!best || cand.longestRunBars > best.longestRunBars || (cand.longestRunBars === best.longestRunBars && cand.matchRatio > best.matchRatio)) best = cand;
  }
  return best;
}
