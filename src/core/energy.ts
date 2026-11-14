import { Bands, percentile, prefixSums, rangeMean } from './dsp';
import type { EnergyEvent, EnergyInfo } from './types';

/**
 * Energy mapping — an algorithmic estimate, not an objective measurement.
 *
 * Per bar, four features on *absolute* scales (so scores are comparable between tracks):
 *  - loudness   RMS of the mono mix, −32 dBFS → 0 … −8 dBFS → 1           (weight 0.45)
 *  - density    onsets per second, 0 → 0 … 8/s → 1                        (weight 0.25)
 *  - low end    share of power below 130 Hz, 0 → 0 … 50 % → 1              (weight 0.15)
 *  - brightness share of power above 2 kHz, 0 → 0 … 25 % → 1               (weight 0.15)
 * The 1–10 score maps the 75th percentile of the audible bars' curve to 1 + 9 × value.
 */
export function computeEnergy(
  x: Float32Array,
  sr: number,
  bands: Bands,
  d0: number,
  barLen: number,
  nBars: number,
  firstAudibleBar: number,
): EnergyInfo {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  // squared-sample prefix sums for exact per-bar RMS
  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i] * x[i];

  // onset peaks: local maxima of the onset envelope above an adaptive threshold
  const o = bands.onset;
  const thr = percentile(o, 70) * 1.6 + 1e-9;
  const peak = new Float32Array(o.length);
  for (let i = 1; i < o.length - 1; i++) if (o[i] > thr && o[i] >= o[i - 1] && o[i] > o[i + 1]) peak[i] = 1;
  const pPeak = prefixSums(peak);
  const pL = prefixSums(bands.eLow);
  const pM = prefixSums(bands.eMid);
  const pH = prefixSums(bands.eHigh);
  const frameOf = (t: number) => (t * bands.sr - bands.frameSize / 2) / bands.hop;

  const curve: number[] = [];
  for (let b = 0; b < nBars; b++) {
    const t0 = d0 + b * barLen;
    const t1 = t0 + barLen;
    const i0 = Math.max(0, Math.floor(t0 * sr));
    const i1 = Math.min(x.length, Math.floor(t1 * sr));
    const rms = i1 > i0 ? Math.sqrt((pre[i1] - pre[i0]) / (i1 - i0)) : 0;
    const rmsDb = 20 * Math.log10(rms + 1e-9);
    const f0 = frameOf(t0);
    const f1 = frameOf(t1);
    const onsetsPerSec = (rangeMean(pPeak, f0, f1) * bands.frameRate);
    const low = rangeMean(pL, f0, f1);
    const mid = rangeMean(pM, f0, f1);
    const high = rangeMean(pH, f0, f1);
    const tot = low + mid + high + 1e-12;
    const loudN = clamp01((rmsDb + 32) / 24);
    const densN = clamp01(onsetsPerSec / 8);
    const lowN = clamp01(low / tot / 0.5);
    const brightN = clamp01(high / tot / 0.25);
    curve.push(b < firstAudibleBar ? 0 : 0.45 * loudN + 0.25 * densN + 0.15 * lowN + 0.15 * brightN);
  }

  const audible = curve.slice(firstAudibleBar).filter((v) => v > 0.02);
  const score = audible.length ? Math.round((1 + 9 * percentile(audible, 75)) * 10) / 10 : 1;

  // Significant changes: 4-bar mean after vs before, local extrema of |delta| ≥ 0.12
  const mean = (a: number, b: number) => {
    let s = 0, k = 0;
    for (let i = Math.max(0, a); i < Math.min(nBars, b); i++) { s += curve[i]; k++; }
    return k ? s / k : 0;
  };
  const delta = curve.map((_, b) => (b < firstAudibleBar + 2 || b > nBars - 2 ? 0 : mean(b, b + 4) - mean(b - 4, b)));
  const events: EnergyEvent[] = [];
  for (let b = 1; b < nBars - 1; b++) {
    const v = delta[b];
    if (Math.abs(v) < 0.12) continue;
    let isExt = true;
    for (let j = Math.max(0, b - 3); j <= Math.min(nBars - 1, b + 3) && isExt; j++) {
      if (j !== b && Math.abs(delta[j]) > Math.abs(v)) isExt = false;
    }
    if (isExt) events.push({ bar: b, timeSec: d0 + b * barLen, type: v > 0 ? 'rise' : 'fall', delta: v });
  }
  // Peak: centre of the most intense 8-bar window
  let best = -1, bestV = -1;
  for (let b = firstAudibleBar; b + 8 <= nBars; b++) {
    const v = mean(b, b + 8);
    if (v > bestV) { bestV = v; best = b; }
  }
  if (best >= 0) events.push({ bar: best, timeSec: d0 + best * barLen, type: 'peak', delta: bestV });
  events.sort((a, b) => a.bar - b.bar);
  return { score, curve: curve.map((v) => Math.round(v * 1000) / 1000), events };
}
