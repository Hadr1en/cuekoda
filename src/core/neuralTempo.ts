import { FFT } from './dsp';
import { averageSoftmax, neuralAsset, neuralLogits, strongestClass } from './neuralModels';

const RATE = 22050;
const CLIP = RATE * 8;
const FRAME = 2048;
const HOP = 512;
const FRAMES = Math.floor(CLIP / HOP) + 1;
const BANDS = 8;
const BPM_CLASSES = 256;
const fft = new FFT(FRAME);
const hann = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME));
const edges = Array.from({ length: BANDS + 1 }, (_, i) => i === BANDS ? 1025 : Math.round(1025 ** (i / BANDS) - 1));

// The reference spaces clip indices with NumPy's half-to-even rounding.
function clipIndex(position: number): number {
  const lower = Math.floor(position);
  return position - lower === 0.5 ? lower + lower % 2 : Math.round(position);
}

/** Five short excerpts spanning the central two minutes, with DeepRhythm's eight onset bands. */
function tempoFeatures(audio: Float32Array) {
  const length = Math.min(audio.length, RATE * 120);
  const total = Math.floor(length / CLIP);
  if (!total) return undefined;
  const clips = Math.min(total, 5);
  const start = Math.floor((audio.length - length) / 2);
  const real = new Float32Array(FRAME);
  const imag = new Float32Array(FRAME);
  const magnitude = new Float32Array(FRAME / 2 + 1);
  const result = new Float32Array(clips * BANDS * FRAMES);
  let maxDb = -Infinity;
  for (let i = 0; i < clips; i++) {
    const position = clips === 1 ? 0 : clipIndex(i * (total - 1) / (clips - 1));
    const clipStart = start + position * CLIP;
    for (let frame = 0; frame < FRAMES; frame++) {
      const pos = frame * HOP - FRAME / 2;
      imag.fill(0);
      for (let n = 0; n < FRAME; n++) {
        let offset = pos + n;
        if (offset < 0) offset = -offset;
        else if (offset >= CLIP) offset = 2 * CLIP - offset - 2;
        real[n] = audio[clipStart + offset] * hann[n];
      }
      fft.transform(real, imag);
      for (let bin = 0; bin < magnitude.length; bin++) {
        magnitude[bin] = Math.sqrt(real[bin] ** 2 + imag[bin] ** 2);
      }
      for (let band = 0; band < BANDS; band++) {
        const lo = edges[band];
        const hi = edges[band + 1];
        let sum = 0;
        for (let bin = lo; bin < hi; bin++) sum += magnitude[bin];
        const db = 10 * Math.log10(Math.max(1e-10, sum / (hi - lo)));
        result[(i * BANDS + band) * FRAMES + frame] = db;
        maxDb = Math.max(maxDb, db);
      }
    }
  }
  const floor = maxDb - 80;
  for (let off = 0; off < result.length; off += FRAMES) {
    for (let j = FRAMES - 1; j >= 3; j--) {
      result[off + j] = Math.max(0, Math.max(floor, result[off + j - 2]) - Math.max(floor, result[off + j - 3]));
    }
    result.fill(0, off, off + 3);
  }
  return { result, clips };
}

export async function predictTempo(audio: Float32Array): Promise<number | undefined> {
  if (audio.length < CLIP * 3 || !neuralAsset('deep-rhythm.onnx')) return undefined;
  try {
    const features = tempoFeatures(audio);
    if (!features) return undefined;
    const { result, clips } = features;
    const logits = await neuralLogits('deep-rhythm', 'onsets', result, [clips, BANDS, FRAMES]);
    if (logits?.length !== clips * BPM_CLASSES) return undefined;
    const scores = averageSoftmax(logits, BPM_CLASSES);
    const winner = strongestClass(scores);
    let matches = 0;
    for (let i = 0; i < clips; i++) {
      if (strongestClass(logits, i * BPM_CLASSES, BPM_CLASSES) === winner) matches++;
    }
    if (scores[winner] >= 0.65 && matches / clips >= 0.7) return winner + 30;
  } catch {
    // The caller can still generate a complete analysis with Essentia.
  }
}
