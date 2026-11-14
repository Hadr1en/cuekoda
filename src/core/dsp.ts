/** Small DSP helpers: FFT, band energies / spectral flux, statistics. */

export function percentile(arr: ArrayLike<number>, p: number): number {
  const n = arr.length;
  if (n === 0) return 0;
  const a = Float64Array.from(arr as ArrayLike<number>).sort();
  const idx = Math.min(n - 1, Math.max(0, Math.round((p / 100) * (n - 1))));
  return a[idx];
}

export function median(arr: ArrayLike<number>): number {
  return percentile(arr, 50);
}

export function movingAverage(a: Float32Array, w: number): Float32Array {
  const n = a.length;
  const out = new Float32Array(n);
  const half = Math.max(1, Math.floor(w / 2));
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    out[i] = (pre[hi] - pre[lo]) / (hi - lo);
  }
  return out;
}

/** Prefix sums so that mean(a, i0, i1) is O(1). */
export function prefixSums(a: ArrayLike<number>): Float64Array {
  const pre = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i];
  return pre;
}

export function rangeMean(pre: Float64Array, i0: number, i1: number): number {
  const n = pre.length - 1;
  const lo = Math.max(0, Math.min(n, Math.floor(i0)));
  const hi = Math.max(lo + 1, Math.min(n, Math.ceil(i1)));
  if (hi <= lo) return 0;
  return (pre[hi] - pre[lo]) / (hi - lo);
}

/** Averages sample pairs: cheap, alias-tolerant 2:1 decimation (44.1 kHz -> 22.05 kHz). */
export function decimate2(x: Float32Array): Float32Array {
  const n = x.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * (x[2 * i] + x[2 * i + 1]);
  return out;
}

export class FFT {
  readonly n: number;
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;
  constructor(n: number) {
    this.n = n;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const c = this.cos[t];
          const s = -this.sin[t];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * c - im[b] * s;
          const xi = re[b] * s + im[b] * c;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

export interface Bands {
  sr: number;
  hop: number;
  frameSize: number;
  frameRate: number;
  frames: number;
  /** Band power per frame (linear). low < 130 Hz, mid 130 Hz - 2 kHz, high > 2 kHz */
  eLow: Float32Array;
  eMid: Float32Array;
  eHigh: Float32Array;
  /** Half-wave rectified log-spectral flux per band (onset activity) */
  fluxLow: Float32Array;
  fluxMid: Float32Array;
  fluxHigh: Float32Array;
  /** Combined, band-normalised onset strength used for beat grid fitting */
  onset: Float32Array;
}

export function frameTime(b: Bands, f: number): number {
  return (f * b.hop + b.frameSize / 2) / b.sr;
}

export function timeToFrame(b: Bands, t: number): number {
  return (t * b.sr - b.frameSize / 2) / b.hop;
}

export function analyseBands(x: Float32Array, sr: number): Bands {
  const frameSize = 1024;
  const hop = 512;
  const frames = Math.max(0, Math.floor((x.length - frameSize) / hop) + 1);
  const fft = new FFT(frameSize);
  const win = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);
  const half = frameSize / 2;
  const binHz = sr / frameSize;
  const lowEnd = Math.max(2, Math.round(130 / binHz));
  const midEnd = Math.round(2000 / binHz);

  const eLow = new Float32Array(frames);
  const eMid = new Float32Array(frames);
  const eHigh = new Float32Array(frames);
  const fLow = new Float32Array(frames);
  const fMid = new Float32Array(frames);
  const fHigh = new Float32Array(frames);
  let prev = new Float32Array(half);
  let cur = new Float32Array(half);

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < frameSize; i++) {
      re[i] = x[off + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    let pl = 0,
      pm = 0,
      ph = 0,
      fl = 0,
      fm = 0,
      fh = 0;
    for (let k = 1; k < half; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const lm = Math.log1p(Math.sqrt(p));
      cur[k] = lm;
      const d = f === 0 ? 0 : lm - prev[k];
      const pos = d > 0 ? d : 0;
      if (k < lowEnd) {
        pl += p;
        fl += pos;
      } else if (k < midEnd) {
        pm += p;
        fm += pos;
      } else {
        ph += p;
        fh += pos;
      }
    }
    eLow[f] = pl;
    eMid[f] = pm;
    eHigh[f] = ph;
    fLow[f] = fl;
    fMid[f] = fm;
    fHigh[f] = fh;
    const t = prev;
    prev = cur;
    cur = t;
  }

  const mean = (a: Float32Array) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return a.length ? s / a.length : 1;
  };
  const mL = mean(fLow) + 1e-9;
  const mM = mean(fMid) + 1e-9;
  const mH = mean(fHigh) + 1e-9;
  const onset = new Float32Array(frames);
  for (let f = 0; f < frames; f++) onset[f] = 1.0 * (fLow[f] / mL) + 0.5 * (fMid[f] / mM) + 0.5 * (fHigh[f] / mH);

  return {
    sr,
    hop,
    frameSize,
    frameRate: sr / hop,
    frames,
    eLow,
    eMid,
    eHigh,
    fluxLow: fLow,
    fluxMid: fMid,
    fluxHigh: fHigh,
    onset,
  };
}
