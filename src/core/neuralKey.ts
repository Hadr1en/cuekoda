import fs from 'node:fs';
import RealFFT from 'fft.js';
import { allKeys } from './key';
import { averageSoftmax, neuralAsset, neuralLogits } from './neuralModels';
import type { KeyResult } from './types';

const BINS = 105;
const HOP = 8820; // 200 ms at 44.1 kHz
const CAMELOT_KEYS = allKeys().sort((a, b) => {
  const mode = a.camelot.at(-1)!.localeCompare(b.camelot.at(-1)!);
  return mode || Number.parseInt(a.camelot, 10) - Number.parseInt(b.camelot, 10);
});

interface Filter {
  bin: number;
  indices: number[];
  real: number[];
  imag: number[];
}

interface Group {
  size: number;
  hop: number;
  kernels: Filter[];
}

function buildGroups(file: string) {
  const filters: Group[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const groups: Group[] = [];
  for (const filter of filters) {
    const prior = groups.at(-1);
    if (prior && prior.size === filter.size && prior.hop === filter.hop) prior.kernels.push(...filter.kernels);
    else groups.push(filter);
  }
  return groups.map((group) => ({
    ...group,
    fft: new RealFFT(group.size),
    kernels: group.kernels.map((filter) => ({
      bin: filter.bin,
      indices: Uint16Array.from(filter.indices, (i) => i * 2),
      real: Float32Array.from(filter.real),
      imag: Float32Array.from(filter.imag),
    })),
  }));
}
let activeFilters: { path: string; groups: ReturnType<typeof buildGroups> } | undefined;

// Blackman-windowed half-band FIR. The sqrt(2) gain preserves the CQT's octave scaling.
const half = Array.from({ length: 8 }, (_, i) => {
  const tap = 2 * i + 1;
  const window = 0.42 + 0.5 * Math.cos(Math.PI * tap / 16) + 0.08 * Math.cos(2 * Math.PI * tap / 16);
  return Math.sin(Math.PI * tap / 2) / (Math.PI * tap) * window;
});
const gain = Math.SQRT2 / (0.5 + 2 * half.reduce((sum, tap) => sum + tap, 0));

function decimate(input: Float32Array): Float32Array {
  const out = new Float32Array(Math.ceil(input.length / 2));
  for (let i = 0; i < out.length; i++) {
    const center = i * 2;
    let value = 0.5 * input[center];
    if (center >= 15 && center + 15 < input.length) {
      for (let j = 0; j < half.length; j++) {
        const k = 2 * j + 1;
        value += half[j] * (input[center - k] + input[center + k]);
      }
    } else {
      for (let j = 0; j < half.length; j++) {
        const k = 2 * j + 1;
        value += half[j] * ((input[center - k] ?? 0) + (input[center + k] ?? 0));
      }
    }
    out[i] = value * gain;
  }
  return out;
}

function keyFeatures(audio: Float32Array, groups: ReturnType<typeof buildGroups>) {
  // Centered windows, with the two trailing frames removed as in OpenKeyScan.
  const frames = Math.floor(audio.length / HOP) - 1;
  if (frames < 8) return undefined;
  let input = audio;
  let hop = HOP;
  const values = new Float32Array(BINS * frames);
  for (const group of groups) {
    while (hop > group.hop) {
      input = decimate(input);
      hop /= 2;
    }
    const time = new Float32Array(group.size);
    const spectrum = group.fft.createComplexArray();
    for (let f = 0; f < frames; f++) {
      const offset = f * group.hop - group.size / 2;
      if (offset >= 0 && offset + group.size <= input.length) time.set(input.subarray(offset, offset + group.size));
      else {
        time.fill(0);
        const lo = Math.max(0, offset);
        time.set(input.subarray(lo, offset + group.size), lo - offset);
      }
      group.fft.realTransform(spectrum, time);
      for (const filter of group.kernels) {
        let real = 0;
        let imag = 0;
        for (let i = 0; i < filter.indices.length; i++) {
          const j = filter.indices[i];
          real += spectrum[j] * filter.real[i] - spectrum[j + 1] * filter.imag[i];
          imag += spectrum[j] * filter.imag[i] + spectrum[j + 1] * filter.real[i];
        }
        values[filter.bin * frames + f] = Math.log1p(Math.sqrt(real * real + imag * imag));
      }
    }
  }
  return { values, frames };
}

export async function predictKey(audio: Float32Array): Promise<KeyResult | undefined> {
  const path = neuralAsset('cqt-filters.json');
  if (audio.length < 30 * 44100 || !path || !neuralAsset('openkeyscan-int8.onnx')) return undefined;
  try {
    if (activeFilters?.path !== path) activeFilters = { path, groups: buildGroups(path) };
    const features = keyFeatures(audio, activeFilters.groups);
    if (!features) return undefined;
    const { values, frames } = features;
    const logits = await neuralLogits('openkeyscan-int8', 'audio', values, [1, 1, BINS, frames]);
    if (logits?.length !== CAMELOT_KEYS.length) return undefined;
    const scores = averageSoftmax(logits, CAMELOT_KEYS.length);
    const ranked = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
    const confidence = scores[ranked[0]];
    const ambiguous = confidence < 0.45 || confidence - scores[ranked[1]] < 0.15;
    const alternatives = ranked.slice(1, 4).filter((i) => scores[i] >= 0.10)
      .map((i) => ({ ...CAMELOT_KEYS[i], weight: scores[i] }));
    return { ...CAMELOT_KEYS[ranked[0]], confidence, level: ambiguous ? 'low' : 'medium', ambiguous, alternatives };
  } catch {
    // The caller uses the tonal profiles if an asset or the inference runtime is unavailable.
  }
}
