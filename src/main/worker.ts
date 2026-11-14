import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { hashFile } from '../core/hash';
import { ENGINE_VERSION, type AnalyzeOptions } from '../core/types';
import { vocalModelAvailable } from '../core/vocalModel';

interface Job {
  id: number;
  file: string;
  options: Partial<AnalyzeOptions>;
  cacheDir: string;
  force: boolean;
}

/**
 * Cache key = file content + engine version + every option that changes the result
 * (profile, manual overrides, learned suppressions). An unchanged file is never re-analysed.
 */
function cacheKey(fileHash: string, options: Partial<AnalyzeOptions>): string {
  const opts = JSON.stringify({
    profile: options.profile ?? options.profileId,
    overrides: options.overrides ?? null,
    suppress: options.suppressKinds ?? [],
    // results differ with / without the local vocal model
    vocalModel: vocalModelAvailable(),
  });
  const h = createHash('sha1').update(opts).digest('hex').slice(0, 12);
  return `${fileHash}-${ENGINE_VERSION}-${h}.json`;
}

parentPort!.on('message', async (m: Job) => {
  try {
    const fileHash = await hashFile(m.file);
    const cachePath = path.join(m.cacheDir, cacheKey(fileHash, m.options));
    if (!m.force && fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      // same content may live under another path (copy): re-target the cached result
      cached.path = m.file;
      cached.fileName = path.basename(m.file);
      parentPort!.postMessage({ type: 'result', id: m.id, result: cached, cached: true });
      return;
    }
    const result = await analyzeFile(m.file, {
      ...m.options,
      onProgress: (stage, fraction) => parentPort!.postMessage({ type: 'progress', id: m.id, stage, fraction }),
    });
    try {
      fs.mkdirSync(m.cacheDir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(result));
    } catch {
      /* cache is best effort */
    }
    parentPort!.postMessage({ type: 'result', id: m.id, result, cached: false });
  } catch (e) {
    parentPort!.postMessage({ type: 'error', id: m.id, error: (e as Error).message });
  }
});
