// Cross-platform smoke launcher. Environment variables supplied by the caller
// take precedence; the historical samples/smoke-report.json defaults remain.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import electron from 'electron';

const audioExtensions = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.aiff']);
const hasAudio = (folder) => existsSync(folder) && readdirSync(folder, { withFileTypes: true })
  .some((entry) => entry.isFile() && audioExtensions.has(extname(entry.name).toLowerCase()));

function writeSyntheticTrack(file, bpm, rootHz, seconds = 90) {
  const sampleRate = 44_100;
  const samples = sampleRate * seconds;
  const pcm = Buffer.allocUnsafe(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const beat = (t * bpm / 60) % 1;
    const bar = Math.floor(t * bpm / 240);
    const section = Math.floor(bar / 8) % 4;
    const level = section === 0 ? 0.45 : section === 1 ? 0.75 : section === 2 ? 1 : 0.6;
    const kick = Math.exp(-beat * 22) * Math.sin(2 * Math.PI * (52 + 28 * Math.exp(-beat * 12)) * t);
    const tone = Math.sin(2 * Math.PI * rootHz * t) + 0.45 * Math.sin(2 * Math.PI * rootHz * 1.5 * t);
    const sample = Math.max(-1, Math.min(1, level * (0.22 * tone + 0.55 * kick)));
    pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  const wav = Buffer.allocUnsafe(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  writeFileSync(file, wav);
}

let temporaryAudio;
let smokeDir = process.env.CUEKODA_SMOKE_DIR;
if (!smokeDir) {
  smokeDir = hasAudio('samples') ? 'samples' : mkdtempSync(join(tmpdir(), 'cuekoda-smoke-audio-'));
  if (smokeDir !== 'samples') {
    temporaryAudio = smokeDir;
    writeSyntheticTrack(join(smokeDir, 'smoke-124.wav'), 124, 220);
    writeSyntheticTrack(join(smokeDir, 'smoke-132.wav'), 132, 261.6256);
  }
}
if (!hasAudio(smokeDir)) throw new Error(`Aucun fichier audio pour le smoke test : ${smokeDir}`);

const child = spawn(electron, ['.'], {
  env: {
    ...process.env,
    CUEKODA_SMOKE_DIR: smokeDir,
    CUEKODA_SMOKE_REPORT: process.env.CUEKODA_SMOKE_REPORT ?? 'smoke-report.json',
  },
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (temporaryAudio && existsSync(temporaryAudio) && statSync(temporaryAudio).isDirectory()) {
    rmSync(temporaryAudio, { recursive: true, force: true });
  }
  if (signal) console.error(`Electron interrompu par ${signal}`);
  process.exitCode = code ?? 1;
});
