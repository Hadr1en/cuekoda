import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const ANALYSIS_SAMPLE_RATE = 22050;

/** Resolves the bundled ffmpeg binary, also when the app is packaged in an asar archive. */
export function ffmpegPath(): string {
  // Installed app: the binary for this OS / CPU is shipped in Resources/ffmpeg (see package.json "build").
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(bundled)) return bundled;
  }
  // Development / CLI: the binary installed by the ffmpeg-static package
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
  /** ffmpeg stopped with an error after producing audio: the decoded audio may be truncated */
  decodeError?: string;
}

interface DecodeOptions {
  channel?: 'left';
  maxDurationSec?: number;
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
export function decodeAudio(file: string, sampleRate = ANALYSIS_SAMPLE_RATE, options: DecodeOptions = {}): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const { channel, maxDurationSec = Infinity } = options;
    const sampleBytes = Float32Array.BYTES_PER_ELEMENT;
    const firstExcessByte = (Math.floor(maxDurationSec * sampleRate) + 1) * sampleBytes;
    const args = [
      '-hide_banner', '-nostats', '-v', 'info', '-nostdin',
      // The analysis queue already parallelizes independent tracks.
      '-filter_threads', '1', '-threads:a', '1',
      '-i', file, '-vn',
      '-af', 'ebur128=peak=true:framelog=quiet' + (channel === 'left' ? ',pan=mono|c0=c0' : ''),
      '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1',
    ];
    const ffmpeg = ffmpegPath();
    const candidate = process.env.CUEKODA_EXPERIMENT_PCM;
    const proc = candidate
      ? spawn(candidate, ['--ffmpeg', ffmpeg, 'pcm', '--sample-rate', String(sampleRate),
        ...(channel === 'left' ? ['--left'] : []), '--', file], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let decodedBytes = 0;
    let log = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      if (decodedBytes >= firstExcessByte) return;
      decodedBytes += chunk.length;
      if (decodedBytes < firstExcessByte) {
        chunks.push(chunk);
        return;
      }
      chunks.length = 0;
      reject(new Error(`fichier de plus de ${maxDurationSec / 60} min (mix DJ ?) — ignoré`));
      proc.kill();
    });
    proc.stderr.on('data', (c: Buffer) => {
      log += c.toString();
      if (log.length > 200_000) log = log.slice(-100_000); // keep the tail (summary is at the end)
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (decodedBytes >= firstExcessByte) return;
      const buf = Buffer.concat(chunks, decodedBytes);
      chunks.length = 0;
      const n = Math.floor(buf.length / sampleBytes);
      const lastErr = () => (log.trim().split('\n').filter((l) => /error|invalid/i.test(l)).pop() ?? log.trim().split('\n').pop() ?? '').slice(0, 200);
      if (code !== 0 && n === 0) {
        return reject(new Error(`fichier illisible ou corrompu (ffmpeg ${code}) : ${lastErr()}`));
      }
      if (n < sampleRate * 5) return reject(new Error('audio trop court ou illisible (< 5 s)'));
      // PCM is little-endian on all supported platforms. Most concatenated buffers are aligned.
      const out = buf.byteOffset % sampleBytes === 0
        ? new Float32Array(buf.buffer, buf.byteOffset, n)
        : new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n * sampleBytes));
      resolve({ samples: out, loudness: parseEbuR128(log), decodeError: code !== 0 ? `ffmpeg ${code} : ${lastErr()}` : undefined });
    });
  });
}

/** Backwards compatible helper (v0.1 API). */
export async function decodeToMono(file: string, sampleRate = ANALYSIS_SAMPLE_RATE): Promise<Float32Array> {
  return (await decodeAudio(file, sampleRate)).samples;
}

/**
 * MP3 without a Xing/Info (LAME) header: decoders cannot know the encoder delay, so ffmpeg — and therefore
 * CueKoda — places everything ~25 ms later than in the source, and DJ software may differ (see
 * `npm run offset-test`). Returns false for non-MP3 files and for MP3s that carry the header.
 */
export function mp3WithoutGaplessHeader(file: string): boolean {
  if (!/\.mp3$/i.test(file)) return false;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(10);
    fs.readSync(fd, head, 0, 10, 0);
    let off = 0;
    if (head.toString('latin1', 0, 3) === 'ID3') {
      off = 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
    }
    const frame = Buffer.alloc(4096);
    const n = fs.readSync(fd, frame, 0, frame.length, off);
    // first MPEG frame sync after the tag
    let s = 0;
    while (s < n - 1 && !(frame[s] === 0xff && (frame[s + 1] & 0xe0) === 0xe0)) s++;
    const first = frame.subarray(s, Math.min(n, s + 400)).toString('latin1');
    return !/Xing|Info|VBRI/.test(first);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
