import { decodeAudio } from './decode';

export interface Peaks {
  /** Values per second */
  perSec: number;
  /** Peak |amplitude| per bin, 0..1 (normalised to the track's max) */
  peak: number[];
  /** Peak of the low-passed (< 150 Hz) signal per bin, same scale */
  low: number[];
}

/** High-resolution waveform for the zoomable view, computed on demand for the opened track. */
export async function computePeaks(file: string, perSec = 200): Promise<Peaks> {
  const sr = 11025;
  const { samples } = await decodeAudio(file, sr);
  const binSize = sr / perSec;
  const n = Math.floor(samples.length / binSize);
  const peak = new Array<number>(n);
  const low = new Array<number>(n);
  const alpha = Math.exp((-2 * Math.PI * 150) / sr);
  let lp = 0;
  let max = 1e-9;
  for (let b = 0; b < n; b++) {
    const a = Math.floor(b * binSize);
    const e = Math.floor((b + 1) * binSize);
    let p = 0;
    let l = 0;
    for (let i = a; i < e; i++) {
      const v = samples[i];
      const av = v < 0 ? -v : v;
      if (av > p) p = av;
      lp = alpha * lp + (1 - alpha) * v;
      const al = lp < 0 ? -lp : lp;
      if (al > l) l = al;
    }
    peak[b] = p;
    low[b] = l;
    if (p > max) max = p;
  }
  const r = (v: number) => Math.round((v / max) * 1000) / 1000;
  return { perSec, peak: peak.map(r), low: low.map(r) };
}
