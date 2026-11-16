import * as fs from 'node:fs';
import * as path from 'node:path';
import { FFT } from './dsp';
import { neuralAsset, neuralLogits } from './neuralModels';

/**
 * Local voice / instrumental classifier: Essentia's `voice_instrumental-musicnn-msd-2` (MTG, Pablo Alonso,
 * 2020). The same model can run in the native inference process or in TensorFlow.js WebAssembly.
 *
 *  - Licence of the weights: CC BY-NC-SA 4.0 (MTG) — usable because CueKoda is free and non-commercial.
 *    Credits: models/voice_instrumental-musicnn-msd-2/LICENSE + docs/ALGORITHMES.md.
 *  - Input: 16 kHz mono, 187 × 96 log-mel patches (frame 512, hop 256 → 3 s per patch).
 *  - Output: P(voice) per patch. The model was trained on whole-track labels (1000 excerpts): it says
 *    "this 3 s window sounds sung", it does not locate voice onsets precisely.
 *  - Model files are local (models/…): nothing is downloaded at analysis time. Missing files or a backend
 *    failure → `null`, and vocals.ts falls back to the spectral heuristic alone.
 */

export const VOCAL_MODEL_ID = 'voice_instrumental-musicnn-msd-2';
const SR = 16000;
const FRAME = 512;
const HOP = 256;
const BANDS = 96;
const PATCH = 187; // frames per patch (≈ 3 s)
/** Non-overlapping patches: halves the cost; bar resolution comes from the heuristic. */
const PATCH_HOP = 187;
const BATCH = 4;

export interface VocalModelOutput {
  model: string;
  runtime?: 'onnx' | 'wasm';
  /** P(voice) per patch */
  probs: Float32Array;
  /** Patch i covers [i * hopSec, i * hopSec + winSec) seconds */
  hopSec: number;
  winSec: number;
  ms: number;
}

const unpacked = (p: string) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

/** Model folder: $CUEKODA_MODELS_DIR, else `models/` next to the app (dev: project root, packaged: unpacked). */
export function findModelDir(): string | null {
  const roots = [
    process.env.CUEKODA_MODELS_DIR,
    path.join(__dirname, '..', '..', 'models'), // dist/<main|cli|test>/x.js → project root
    path.join(process.cwd(), 'models'),
  ].filter((p): p is string => !!p);
  for (const r of roots) {
    const dir = unpacked(path.join(r, VOCAL_MODEL_ID));
    if (fs.existsSync(path.join(dir, 'model.json'))) return dir;
  }
  return null;
}

export function vocalModelAvailable(): boolean {
  return process.env.CUEKODA_VOCAL_MODEL !== '0' && (!!neuralAsset('voice-musicnn.onnx') || findModelDir() !== null);
}

// ---------------------------------------------------------------- features

/**
 * 44.1 kHz → 16 kHz (exact ratio 160/441) with a Hann-windowed sinc low-pass at 7.6 kHz, 32 taps.
 */
export function resample44kTo16k(x: Float32Array): Float32Array {
  const L = 160, M = 441, TAPS = 16;
  const fc = 7600 / 44100; // cutoff, cycles per input sample
  const nOut = Math.floor((x.length * L) / M);
  const table = new Float32Array(L * 2 * TAPS); // per output phase
  for (let ph = 0; ph < L; ph++) {
    const frac = ((ph * M) % L) / L;
    let sum = 0;
    for (let k = -TAPS + 1; k <= TAPS; k++) {
      const t = k - frac;
      const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / TAPS);
      const v = Math.abs(t) < TAPS ? sinc * w : 0;
      table[ph * 2 * TAPS + k + TAPS - 1] = v;
      sum += v;
    }
    for (let k = 0; k < 2 * TAPS; k++) table[ph * 2 * TAPS + k] /= sum;
  }
  const y = new Float32Array(nOut);
  for (let n = 0; n < nOut; n++) {
    const pos = Math.floor((n * M) / L);
    const ph = n % L;
    const base = ph * 2 * TAPS;
    let acc = 0;
    for (let k = -TAPS + 1; k <= TAPS; k++) {
      const i = pos + k;
      if (i >= 0 && i < x.length) acc += x[i] * table[base + k + TAPS - 1];
    }
    y[n] = acc;
  }
  return y;
}

const hz2mel = (f: number) => (f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27));
const mel2hz = (m: number) => (m < 15 ? m * (200 / 3) : 1000 * Math.exp((m - 15) * (Math.log(6.4) / 27)));

let melFilters: { lo: number; w: Float32Array }[] | null = null;
function filters() {
  if (melFilters) return melFilters;
  const m1 = hz2mel(SR / 2);
  const edges = Array.from({ length: BANDS + 2 }, (_, i) => mel2hz((i * m1) / (BANDS + 1)));
  melFilters = [];
  for (let b = 0; b < BANDS; b++) {
    const [fl, fc, fh] = [edges[b], edges[b + 1], edges[b + 2]];
    const lo = Math.max(0, Math.floor((fl * FRAME) / SR));
    const hi = Math.min(FRAME / 2, Math.ceil((fh * FRAME) / SR));
    const w = new Float32Array(hi - lo + 1);
    for (let j = lo; j <= hi; j++) {
      const f = (j * SR) / FRAME;
      // unit-area triangles on a linear frequency axis ('unit_tri', 'linear' weighting)
      if (f > fl && f < fh) w[j - lo] = ((f <= fc ? (f - fl) / (fc - fl) : (fh - f) / (fh - fc)) * 2) / (fh - fl);
    }
    melFilters.push({ lo, w });
  }
  return melFilters;
}

/**
 * Log-mel spectrogram identical to Essentia's TensorflowInputMusiCNN (Hann 512, power spectrum,
 * 96 Slaney mel bands 0–8 kHz, log10(1 + 10000·x)) — checked against Essentia in the unit tests.
 * Returns frames × 96, row-major.
 */
export function musicnnMel(x16k: Float32Array): Float32Array {
  const nF = Math.max(0, Math.floor((x16k.length - FRAME) / HOP) + 1);
  const out = new Float32Array(nF * BANDS);
  const fft = new FFT(FRAME);
  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const pw = new Float32Array(FRAME / 2 + 1);
  const fb = filters();
  for (let f = 0; f < nF; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = x16k[off + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k <= FRAME / 2; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < BANDS; b++) {
      const { lo, w } = fb[b];
      let s = 0;
      for (let j = 0; j < w.length; j++) s += w[j] * pw[lo + j];
      out[f * BANDS + b] = Math.log10(1 + 10000 * s);
    }
  }
  return out;
}

// ---------------------------------------------------------------- inference

/* eslint-disable @typescript-eslint/no-explicit-any */
let loading: Promise<{ tf: any; model: any } | null> | null = null;
let lastError = '';

async function load(): Promise<{ tf: any; model: any } | null> {
  const dir = findModelDir();
  if (!dir) {
    lastError = 'modèle vocal absent';
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tf = require('@tensorflow/tfjs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wasm = require('@tensorflow/tfjs-backend-wasm');
    const wasmDir = unpacked(path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist')) + path.sep;
    wasm.setWasmPaths(wasmDir);
    await tf.setBackend('wasm');
    await tf.ready();
    const mj = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
    const specs = mj.weightsManifest.flatMap((g: any) => g.weights);
    const buf = Buffer.concat(mj.weightsManifest.flatMap((g: any) => g.paths.map((p: string) => fs.readFileSync(path.join(dir, p)))));
    const weightData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const model = await tf.loadGraphModel(tf.io.fromMemory({ modelTopology: mj.modelTopology, weightSpecs: specs, weightData, format: mj.format }));
    return { tf, model };
  } catch (e) {
    lastError = `modèle vocal indisponible : ${(e as Error).message}`;
    return null;
  }
}

export function vocalModelError(): string {
  return lastError;
}

/**
 * P(voice) for consecutive 3 s patches of a 44.1 kHz mono signal. `null` when the model is unavailable
 * (missing files, CUEKODA_VOCAL_MODEL=0, backend failure) — the caller falls back to the heuristic.
 */
export async function predictVoice(x44k: Float32Array): Promise<VocalModelOutput | null> {
  if (process.env.CUEKODA_VOCAL_MODEL === '0') return null;
  const t0 = Date.now();
  const canUseNative = !!neuralAsset('voice-musicnn.onnx');
  if (!canUseNative && !findModelDir()) {
    lastError = 'modèle vocal absent';
    return null;
  }
  const mel = musicnnMel(resample44kTo16k(x44k));
  const nF = mel.length / BANDS;
  if (nF < PATCH) return null;
  const nP = Math.floor((nF - PATCH) / PATCH_HOP) + 1;
  async function batches(infer: (data: Float32Array, count: number) => Promise<Float32Array | undefined>) {
    const probs = new Float32Array(nP);
    for (let p0 = 0; p0 < nP; p0 += BATCH) {
      const nb = Math.min(BATCH, nP - p0);
      const data = new Float32Array(nb * PATCH * BANDS);
      for (let i = 0; i < nb; i++) {
        const start = (p0 + i) * PATCH_HOP * BANDS;
        data.set(mel.subarray(start, start + PATCH * BANDS), i * PATCH * BANDS);
      }
      const v = await infer(data, nb);
      if (v?.length !== nb * 2) return undefined;
      for (let i = 0; i < nb; i++) probs[p0 + i] = v[i * 2 + 1]; // classes: [instrumental, voice]
    }
    return probs;
  }
  const output = (probs: Float32Array, runtime: 'onnx' | 'wasm'): VocalModelOutput => ({
    model: VOCAL_MODEL_ID, runtime, probs, hopSec: (PATCH_HOP * HOP) / SR,
    winSec: (PATCH * HOP + FRAME - HOP) / SR, ms: Date.now() - t0,
  });
  if (canUseNative) {
    try {
      const probs = await batches(async (data, count) => neuralLogits('voice-musicnn', 'mel', data, [count, PATCH, BANDS]));
      if (probs) return output(probs, 'onnx');
    } catch {
      // Use the existing WebAssembly runtime for a complete set of probabilities.
    }
  }
  loading ??= load();
  const m = await loading;
  if (!m) return null;
  const { tf, model } = m;
  const inputName = model.inputs[0].name;
  try {
    const probs = await batches(async (data, count) => {
      const input = tf.tensor3d(data, [count, PATCH, BANDS]);
      try {
        const result = model.execute({ [inputName]: input }, 'model/Sigmoid');
        try { return await result.data(); }
        finally { result.dispose(); }
      } finally { input.dispose(); }
    });
    if (probs) return output(probs, 'wasm');
  } catch (e) {
    lastError = `inférence vocale échouée : ${(e as Error).message}`;
  }
  return null;
}
