import { parentPort, threadId } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { assertAudioRevision, hashAudioRevision } from '../core/hash';
import { ENGINE_VERSION, type AnalysisResult, type AnalyzeOptions } from '../core/types';
import { vocalModelAvailable } from '../core/vocalModel';

interface Job {
  id: number;
  file: string;
  options: Partial<AnalyzeOptions>;
  cacheDir: string;
  force: boolean;
}

/** Identify reusable analyses by audio content, engine version and analysis settings. */
function cacheKey(fileHash: string, options: Partial<AnalyzeOptions>): string {
  const opts = JSON.stringify({
    profile: options.profile ?? options.profileId,
    overrides: options.overrides ?? null,
    suppress: options.suppressKinds ?? [],
    minBpm: options.minBpm,
    maxBpm: options.maxBpm,
    wavePoints: options.wavePoints,
    // results differ with / without the local vocal model
    vocalModel: vocalModelAvailable(),
  });
  const h = createHash('sha1').update(opts).digest('hex').slice(0, 12);
  return `${fileHash}-${ENGINE_VERSION}-${h}.json`;
}

function readCache(file: string, fileHash: string): AnalysisResult | undefined {
  try {
    const value: AnalysisResult | null = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value?.fileHash === fileHash && value.engineVersion === ENGINE_VERSION
      && Number.isFinite(value.bpm) && value.bpm > 0 && Number.isFinite(value.grid?.firstDownbeatSec)
      && typeof value.key?.musical === 'string' && typeof value.key.camelot === 'string'
      && Array.isArray(value.cues) && Array.isArray(value.wave) && Array.isArray(value.waveLow)
      && Array.isArray(value.warnings)) return value;
  } catch {
    // Cache files can be removed or interrupted while the app is running. Recompute on a miss.
  }
}

parentPort!.on('message', async (m: Job) => {
  try {
    const source = await hashAudioRevision(m.file);
    const cachePath = path.join(m.cacheDir, cacheKey(source.fileHash, m.options));
    const cached = m.force ? undefined : readCache(cachePath, source.fileHash);
    if (cached) {
      await assertAudioRevision(m.file, source);
      cached.path = m.file;
      cached.fileName = path.basename(m.file);
      parentPort!.postMessage({ type: 'result', id: m.id, result: cached, cached: true });
      return;
    }
    const result = await analyzeFile(m.file, {
      ...m.options,
      onProgress: (stage, fraction) => parentPort!.postMessage({ type: 'progress', id: m.id, stage, fraction }),
    }, source);
    const temp = `${cachePath}.${process.pid}.${threadId}.tmp`;
    try {
      fs.mkdirSync(m.cacheDir, { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(result));
      fs.renameSync(temp, cachePath);
    } catch {
      try { fs.rmSync(temp, { force: true }); } catch { /* cache is best effort */ }
    }
    parentPort!.postMessage({ type: 'result', id: m.id, result, cached: false });
  } catch (e) {
    parentPort!.postMessage({ type: 'error', id: m.id, error: (e as Error).message });
  }
});
