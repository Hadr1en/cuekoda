/** Deterministic local stress test for the rhythm families CueKoda claims to support. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';

const SR = 44100;
const DURATION = 24;

interface Case {
  id: string;
  bpm: number;
  profileId: string;
  pattern: 'dnb' | 'trap' | 'ukg' | 'global' | 'techno';
  expectNoDrop?: boolean;
  breakRange?: [number, number];
  expectedDropBeat?: number;
}

const cases: Case[] = [
  { id: 'dnb-174', bpm: 174, profileId: 'drumandbass', pattern: 'dnb' },
  { id: 'trap-half-time-140', bpm: 140, profileId: 'bass', pattern: 'trap' },
  { id: 'uk-garage-break-edit-132', bpm: 132, profileId: 'bass', pattern: 'ukg', breakRange: [16, 32], expectedDropBeat: 32 },
  { id: 'afro-latin-no-drop-live-120', bpm: 120, profileId: 'global', pattern: 'global', expectNoDrop: true },
  { id: 'hard-techno-200', bpm: 200, profileId: 'harddance', pattern: 'techno', expectNoDrop: true },
];

function addHit(samples: Float32Array, time: number, frequency: number, duration: number, amplitude: number, noise = 0) {
  const start = Math.round(time * SR);
  const length = Math.round(duration * SR);
  for (let i = 0; i < length && start + i < samples.length; i++) {
    const t = i / SR;
    const deterministicNoise = Math.sin(i * 12.9898 + start * 0.0001);
    const value = Math.sin(2 * Math.PI * frequency * t) * (1 - noise)
      + deterministicNoise * noise;
    samples[start + i] += amplitude * value * Math.exp(-t / (duration / 4));
  }
}

function render(test: Case): Float32Array {
  const samples = new Float32Array(SR * DURATION);
  const beat = 60 / test.bpm;
  const addBeat = (index: number, offset: number, kind: 'kick' | 'snare' | 'hat', amplitude = 1) => {
    const time = 1 + (index + offset) * beat;
    if (time >= DURATION - 0.2) return;
    if (kind === 'kick') addHit(samples, time, 58, 0.13, amplitude);
    else if (kind === 'snare') addHit(samples, time, 190, 0.08, amplitude, 0.72);
    else addHit(samples, time, 5200, 0.025, amplitude, 0.82);
  };
  const beats = Math.floor((DURATION - 1) / beat);
  for (let i = 0; i < beats; i++) {
    if (test.breakRange && i >= test.breakRange[0] && i < test.breakRange[1]) continue;
    const inBar = i % 4;
    const accent = inBar === 0 ? 1 : 0.72;
    if (test.pattern === 'techno') addBeat(i, 0, 'kick', accent);
    if (test.pattern === 'dnb') {
      if (inBar === 0) addBeat(i, 0, 'kick', accent);
      if (inBar === 2) addBeat(i, 0.5, 'kick', 0.7);
      if (inBar === 1 || inBar === 3) addBeat(i, 0, 'snare', 0.78);
    }
    if (test.pattern === 'trap') {
      if (inBar === 0) addBeat(i, 0, 'kick', accent);
      if (inBar === 2) addBeat(i, 0.75, 'kick', 0.7);
      if (inBar === 2) addBeat(i, 0, 'snare', 0.9);
    }
    if (test.pattern === 'ukg') {
      if (inBar === 0 || inBar === 2.5) addBeat(i, 0, 'kick', accent);
      if (inBar === 1 || inBar === 3) addBeat(i, 0, 'snare', 0.72);
    }
    if (test.pattern === 'global') {
      if (inBar === 0 || inBar === 2) addBeat(i, 0, 'kick', accent);
      if (inBar === 1 || inBar === 3) addBeat(i, 0.5, 'snare', 0.65);
    }
    addBeat(i, test.pattern === 'global' ? 0.25 : 0.5, 'hat', 0.24);
  }
  return samples;
}

function wav(samples: Float32Array): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + samples.length * 2, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(samples.length * 2, 40);
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  return Buffer.concat([header, data]);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-rhythm-'));
  const results = [];
  try {
    for (const test of cases) {
      const file = path.join(dir, `${test.id}.wav`);
      fs.writeFileSync(file, wav(render(test)));
      const rss = process.memoryUsage().rss;
      const cpu = process.cpuUsage();
      const detected = await analyzeFile(file, { profileId: test.profileId });
      const usedCpu = process.cpuUsage(cpu);
      const errorPct = ((detected.bpm - test.bpm) / test.bpm) * 100;
      const beat = 60 / test.bpm;
      const relative = (detected.grid.firstDownbeatSec - 1) / beat;
      const phaseErrorMs = (relative - Math.round(relative)) * beat * 1000;
      const octaveError = [0.5, 2].some((ratio) => Math.abs(detected.bpm / test.bpm - ratio) < 0.025);
      const expectedDropSec = test.expectedDropBeat === undefined ? undefined : 1 + test.expectedDropBeat * beat;
      const nearestDrop = expectedDropSec === undefined ? undefined : detected.cues.filter((cue) => cue.kind === 'drop')
        .sort((a, b) => Math.abs(a.timeSec - expectedDropSec) - Math.abs(b.timeSec - expectedDropSec))[0];
      results.push({
        id: test.id, profileId: test.profileId, referenceBpm: test.bpm, detectedBpm: detected.bpm,
        errorPct, octaveError, phaseErrorMs, downbeatOk: Math.abs(relative / 4 - Math.round(relative / 4)) < 0.125,
        analysisMs: detected.analysisMs, cpuMs: (usedCpu.user + usedCpu.system) / 1000,
        rssDeltaMb: (process.memoryUsage().rss - rss) / 1048576,
        falseDropCues: test.expectNoDrop ? detected.cues.filter((cue) => cue.kind === 'drop').length : 0,
        dropErrorBeats: expectedDropSec === undefined ? null : nearestDrop ? (nearestDrop.timeSec - expectedDropSec) / beat : null,
      });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.table(results.map((result) => ({
    cas: result.id, bpm: `${result.detectedBpm.toFixed(2)}/${result.referenceBpm}`,
    erreur: `${result.errorPct.toFixed(2)} %`, octave: result.octaveError ? 'OUI' : 'non',
    phase: `${result.phaseErrorMs.toFixed(1)} ms`, downbeat: result.downbeatOk ? 'OK' : 'FAUX',
    fauxDrops: result.falseDropCues,
    drop: result.dropErrorBeats === null ? '—' : `${result.dropErrorBeats.toFixed(1)} temps`,
    cpu: `${result.cpuMs.toFixed(0)} ms`, rss: `${result.rssDeltaMb.toFixed(1)} Mio`,
  })));
  const json = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : '';
  if (json) fs.writeFileSync(json, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  if (results.some((result) => Math.abs(result.errorPct) > 2 || result.octaveError || Math.abs(result.phaseErrorMs) > 80
    || result.falseDropCues > 0 || (result.id.includes('break-edit') && (result.dropErrorBeats === null || Math.abs(result.dropErrorBeats) > 4)))) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
