import { InferenceSession, Tensor } from 'onnxruntime-node';
import type { NeuralRequest, NeuralReply } from '../core/neuralProtocol';

const sessions = new Map<string, Promise<InferenceSession>>();

async function infer(request: NeuralRequest): Promise<NeuralReply> {
  try {
    let loading = sessions.get(request.file);
    if (!loading) {
      loading = InferenceSession.create(request.file, {
        executionProviders: ['cpu'],
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        logSeverityLevel: 3,
      });
      sessions.set(request.file, loading);
    }
    const session = await loading;
    const tensor = new Tensor('float32', request.data, request.dimensions);
    const output = (await session.run({ [request.input]: tensor })).logits;
    const logits = output?.data;
    if (logits instanceof Float32Array && logits.every(Number.isFinite)) return { id: request.id, logits };
  } catch {
    // A bad or unavailable model is handled by the original detector in the analysis worker.
  }
  return { id: request.id };
}

let pending = Promise.resolve();
process.on('message', (request: NeuralRequest) => {
  pending = pending.then(async () => {
    const result = await infer(request);
    if (process.connected) process.send?.(result, () => {});
  });
});
process.once('disconnect', () => {
  void pending.then(() => Promise.allSettled([...sessions.values()].map(async (s) => (await s).release())));
});
