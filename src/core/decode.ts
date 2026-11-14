import { spawn } from 'node:child_process';

export const ANALYSIS_SAMPLE_RATE = 22050;

/** Resolves the bundled ffmpeg binary, also when the app is packaged in an asar archive. */
export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const p: string | null = require('ffmpeg-static');
  if (!p) throw new Error('ffmpeg-static: no binary available for this platform');
  return p.replace('app.asar', 'app.asar.unpacked');
}

export interface EbuR128 {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbtp: number | null;
}

export interface Decoded {
  samples: Float32Array;
  /** EBU R128 measured on the original channels (before the mono downmix) */
  loudness: EbuR128;
}

function parseEbuR128(log: string): EbuR128 {
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const num = (re: RegExp) => {
    const m = summary.match(re);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  if (!log.includes('Summary:')) return { integratedLufs: null, loudnessRangeLu: null, truePeakDbtp: null };
  return {
    integratedLufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    loudnessRangeLu: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeakDbtp: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}

/**
 * Decodes any audio file ffmpeg understands into mono float32 PCM and, in the same pass,
 * measures EBU R128 loudness and true peak (ffmpeg `ebur128` filter) on the original channels.
 */
export function decodeAudio(file: string, sampleRate = ANALYSIS_SAMPLE_RATE): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-nostats', '-v', 'info', '-nostdin',
      '-i', file, '-vn',
      '-af', 'ebur128=peak=true:framelog=quiet',
      '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1',
    ];
    const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let log = '';
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => {
      log += c.toString();
      if (log.length > 200_000) log = log.slice(-100_000); // keep the tail (summary is at the end)
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 4);
      if (code !== 0 && n === 0) {
        const lastErr = log.trim().split('\n').filter((l) => /error|invalid/i.test(l)).pop() ?? log.trim().split('\n').pop() ?? '';
        return reject(new Error(`fichier illisible ou corrompu (ffmpeg ${code}) : ${lastErr.slice(0, 200)}`));
      }
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
      if (n < sampleRate * 5) return reject(new Error('audio trop court ou illisible (< 5 s)'));
      resolve({ samples: out, loudness: parseEbuR128(log) });
    });
  });
}

/** Backwards compatible helper (v0.1 API). */
export async function decodeToMono(file: string, sampleRate = ANALYSIS_SAMPLE_RATE): Promise<Float32Array> {
  return (await decodeAudio(file, sampleRate)).samples;
}
