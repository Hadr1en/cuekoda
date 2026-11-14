import { decodeAudio } from './decode';

export interface Peaks {
  /** Values per second */
  perSec: number;
  /** Peak |amplitude| per bin, 0..1 (normalised to the track's max) */
  peak: number[];
  /** Peak of the low-passed (< 150 Hz) signal per bin, same scale */
  low: number[];
  /** Peaks of the mids (150 Hz – 2.5 kHz) and highs (> 2.5 kHz), same scale */
  mid: number[];
  high: number[];
}

/**
 * Per-bin peaks of the full signal and of three bands (one-pole filters: cheap, no phase issue for a
 * display): lows < 150 Hz, mids 150 Hz – 2.5 kHz, highs > 2.5 kHz. Values are normalised to the full
 * signal's maximum, rounded to 3 decimals.
 */
export function bandPeaks(samples: Float32Array, sr: number, bins: number): { peak: number[]; low: number[]; mid: number[]; high: number[] } {
  const binSize = samples.length / bins;
  const aLo = Math.exp((-2 * Math.PI * 150) / sr);
  const aHi = Math.exp((-2 * Math.PI * 2500) / sr);
  const peak = new Array<number>(bins), low = new Array<number>(bins), mid = new Array<number>(bins), high = new Array<number>(bins);
  let lp = 0, lp2 = 0, max = 1e-9;
  for (let b = 0; b < bins; b++) {
    const a = Math.floor(b * binSize);
    const e = Math.min(samples.length, Math.floor((b + 1) * binSize));
    let p = 0, l = 0, m = 0, h = 0;
    for (let i = a; i < e; i++) {
      const v = samples[i];
      lp = aLo * lp + (1 - aLo) * v;
      lp2 = aHi * lp2 + (1 - aHi) * v;
      const av = Math.abs(v), al = Math.abs(lp), am = Math.abs(lp2 - lp), ah = Math.abs(v - lp2);
      if (av > p) p = av;
      if (al > l) l = al;
      if (am > m) m = am;
      if (ah > h) h = ah;
    }
    peak[b] = p; low[b] = l; mid[b] = m; high[b] = h;
    if (p > max) max = p;
  }
  const r = (v: number) => Math.round(Math.min(1, v / max) * 1000) / 1000;
  return { peak: peak.map(r), low: low.map(r), mid: mid.map(r), high: high.map(r) };
}

/** High-resolution waveform for the zoomable view, computed on demand for the opened track. */
export async function computePeaks(file: string, perSec = 200): Promise<Peaks> {
  const sr = 22050; // highs up to 11 kHz (hats, cymbals) for the 3-band view
  const { samples } = await decodeAudio(file, sr);
  const n = Math.floor(samples.length / (sr / perSec));
  return { perSec, ...bandPeaks(samples.subarray(0, Math.round(n * (sr / perSec))), sr, n) };
}
