import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffmpegPath } from '../core/decode';
import type { Peaks } from '../core/peaks';

const execute = promisify(execFile);
const maxBins = 1800 * 200;

export async function rustWaveform(binary: string, path: string): Promise<Peaks> {
  const { stdout } = await execute(binary, ['--ffmpeg', ffmpegPath(), 'analyze', '--', path], {
    timeout: 65_000,
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true,
  });
  const { schemaVersion, waveform } = JSON.parse(stdout) as { schemaVersion?: unknown; waveform?: Peaks };
  if (schemaVersion !== 1 || !waveform || waveform.perSec !== 200
    || !Array.isArray(waveform.peak) || waveform.peak.length < 1000 || waveform.peak.length > maxBins
    || ![waveform.peak, waveform.low, waveform.mid, waveform.high].every((band) => Array.isArray(band)
      && band.length === waveform.peak.length && band.every((value) => Number.isFinite(value) && value >= 0 && value <= 1))) {
    throw new Error('Invalid CueKoda Rust waveform response');
  }
  return waveform;
}
