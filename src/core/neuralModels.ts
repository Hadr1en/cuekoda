import fs from 'node:fs';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import type { NeuralReply, NeuralRequest } from './neuralProtocol';

type Model = 'deep-rhythm' | 'openkeyscan-int8' | 'voice-musicnn';

function modelDir(): string | undefined {
  if (process.env.CUEKODA_NEURAL_MODELS === '0') return undefined;
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const roots = [
    process.env.CUEKODA_MODELS_DIR,
    resources && path.join(resources, 'app.asar.unpacked', 'models'),
    path.join(__dirname, '..', '..', 'models'),
    path.join(process.cwd(), 'models'),
  ];
  return roots.filter((root): root is string => !!root)
    .map((root) => path.join(root, 'neural'))
    .find((root) => fs.existsSync(root));
}

export function neuralModelAssets() {
  const dir = modelDir();
  const has = (file: string) => !!dir && fs.existsSync(path.join(dir, file));
  return {
    tempo: has('deep-rhythm.onnx'),
    key: has('openkeyscan-int8.onnx') && has('cqt-filters.json'),
    voice: has('voice-musicnn.onnx'),
  };
}

export function neuralAsset(file: string): string | undefined {
  const dir = modelDir();
  const asset = dir && path.join(dir, file);
  return asset && fs.existsSync(asset) ? asset : undefined;
}

type Request = { resolve: (value?: Float32Array) => void; timer: NodeJS.Timeout };
const pending = new Map<number, Request>();
let service: ChildProcess | undefined;
let retryAfter = 0;
let sequence = 0;
let failures = 0;

export function neuralModelFailures(): number {
  return failures;
}

function complete(id: number, logits?: Float32Array): void {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  clearTimeout(request.timer);
  if (!logits) failures++;
  request.resolve(logits);
}

function startService(): ChildProcess | undefined {
  if (service?.connected) return service;
  if (Date.now() < retryAfter) return undefined;
  const entry = [
    path.join(__dirname, '..', 'main', 'neural-runner.js'),
    path.join(process.cwd(), 'dist', 'main', 'neural-runner.js'),
  ].find((file) => fs.existsSync(file));
  if (!entry) return undefined;
  // Keep native sessions out of worker threads, which can be stopped mid-inference.
  const child = fork(entry, [], {
    execArgv: [],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  service = child;
  child.unref();
  child.channel?.unref();
  const lost = () => {
    if (service !== child) return;
    retryAfter = Date.now() + 30_000;
    service = undefined;
    for (const id of pending.keys()) complete(id);
    if (child.connected) child.disconnect();
  };
  child.once('error', lost);
  child.once('exit', lost);
  child.once('disconnect', lost);
  child.on('message', ({ id, logits }: NeuralReply) => complete(id, logits));
  return child;
}

export function neuralLogits(
  model: Model, input: string, data: Float32Array, dimensions: number[],
): Promise<Float32Array | undefined> | undefined {
  const file = neuralAsset(`${model}.onnx`);
  if (!file) return undefined;
  let child: ChildProcess | undefined;
  try { child = startService(); } catch { retryAfter = Date.now() + 30_000; }
  if (!child) {
    failures++;
    return undefined;
  }
  const running = child;
  const id = ++sequence;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      complete(id);
      running.kill();
    }, 20_000);
    pending.set(id, { resolve, timer });
    const request: NeuralRequest = { id, file, input, data, dimensions };
    running.send(request, (error) => {
      if (error) complete(id);
    });
  });
}

export async function checkNeuralModels(): Promise<boolean> {
  const outputs = await Promise.all([
    neuralLogits('deep-rhythm', 'onsets', new Float32Array(8 * 345), [1, 8, 345]),
    neuralLogits('openkeyscan-int8', 'audio', new Float32Array(105 * 320), [1, 1, 105, 320]),
    neuralLogits('voice-musicnn', 'mel', new Float32Array(187 * 96), [1, 187, 96]),
  ]);
  return outputs[0]?.length === 256 && outputs[1]?.length === 24 && outputs[2]?.length === 2;
}

export function averageSoftmax(logits: Float32Array, classes: number): Float64Array {
  const probs = new Float64Array(classes);
  const count = logits.length / classes;
  for (let i = 0; i < logits.length; i += classes) {
    let peak = -Infinity;
    for (let j = 0; j < classes; j++) peak = Math.max(peak, logits[i + j]);
    let total = 0;
    for (let j = 0; j < classes; j++) total += Math.exp(logits[i + j] - peak);
    for (let j = 0; j < classes; j++) probs[j] += Math.exp(logits[i + j] - peak) / (total * count);
  }
  return probs;
}

export function strongestClass(values: ArrayLike<number>, offset = 0, size = values.length): number {
  let best = 0;
  for (let i = 1; i < size; i++) if (values[offset + i] > values[offset + best]) best = i;
  return best;
}
