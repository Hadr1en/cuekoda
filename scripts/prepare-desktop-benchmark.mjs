import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';

const [fixture, output, reps, coreRoot, electronRustRoot, tauriRoot, gpuiRoot] = process.argv.slice(2);
if (![fixture, output, reps, coreRoot, electronRustRoot, tauriRoot, gpuiRoot].every(Boolean)) {
  console.error('Usage: node scripts/prepare-desktop-benchmark.mjs FIXTURE OUT RUNS CORE ELECTRON_RUST TAURI GPUI');
  process.exit(2);
}
const repetitions = Number(reps);
assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 100);
const source = realpathSync(fixture);
const revision = (cwd) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
const executable = (name) => platform() === 'win32' ? `${name}.exe` : name;
const core = resolve(coreRoot, 'rust/cuekoda-core/target/release', executable('cuekoda-core'));
const requireFrom = (root) => createRequire(resolve(root, 'package.json'));
const worker = resolve(coreRoot, 'dist/cli/experiment-worker.js');
const ffmpeg = requireFrom(coreRoot)('ffmpeg-static');
const common = {
  ...process.env, CUEKODA_EXPERIMENT_NODE: process.execPath, CUEKODA_EXPERIMENT_WORKER: worker,
  CUEKODA_EXPERIMENT_FFMPEG: ffmpeg, CUEKODA_EXPERIMENT_PCM: core,
};
const modes = [
  { name: 'electron', cwd: process.cwd(), cmd: requireFrom(process.cwd())('electron'), args: ['.'],
    extra: { CUEKODA_PREPARE_FILE: source, CUEKODA_EXPERIMENT_PCM: '', CUEKODA_WAVEFORM_ENGINE: '' } },
  { name: 'electron-rust', cwd: electronRustRoot, cmd: requireFrom(electronRustRoot)('electron'), args: ['.'],
    extra: { CUEKODA_PREPARE_FILE: source, CUEKODA_WAVEFORM_ENGINE: 'rust', CUEKODA_RUST_CORE: core } },
  { name: 'tauri', cwd: tauriRoot, cmd: resolve(tauriRoot, 'rust/cuekoda-tauri/target/debug', executable('cuekoda-tauri')),
    args: [source], extra: { CUEKODA_PREPARE_BENCHMARK: '1' } },
  { name: 'gpui', cwd: gpuiRoot, cmd: resolve(gpuiRoot, 'rust/cuekoda-gpui/target/debug', executable('cuekoda-gpui')),
    args: ['--analysis-smoke', source], extra: {} },
];
const runs = [];
const root = mkdtempSync(join(tmpdir(), 'cuekoda-desktop-prepare-'));

async function run(mode, data) {
  const start = performance.now();
  const child = spawn(mode.cmd, mode.args, {
    cwd: mode.cwd, env: { ...common, ...mode.extra, CUEKODA_EXPERIMENT_DATA: data },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  return new Promise((done) => {
    const result = { mode: mode.name, prepared_ms: null, summary: null, exit_code: null };
    let stderr = '';
    const timeout = setTimeout(() => { result.error = 'Timeout'; child.kill('SIGKILL'); }, 120_000);
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.startsWith('CUEKODA_PREPARED ')) return;
      try {
        result.summary = JSON.parse(line.slice('CUEKODA_PREPARED '.length));
        result.prepared_ms = performance.now() - start;
      } catch (error) { result.error = String(error); }
    });
    child.on('error', (error) => { result.error = error.message; });
    child.on('close', (code) => {
      clearTimeout(timeout);
      result.exit_code = code;
      result.wall_ms = performance.now() - start;
      if (code !== 0 || !result.summary) result.error ??= stderr.trim() || 'Missing prepared marker';
      done(result);
    });
  });
}

function summarize(values) {
  const sorted = values.toSorted((a, b) => a - b);
  if (!sorted.length) return null;
  return { median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

try {
  for (let i = 0; i < repetitions; i++) {
    for (const mode of [...modes.slice(i % modes.length), ...modes.slice(0, i % modes.length)]) {
      const data = mkdtempSync(join(root, `${mode.name}-`));
      const result = await run(mode, data);
      runs.push(result);
      console.log(JSON.stringify(result));
      if (result.error) break;
    }
    if (runs.at(-1)?.error) break;
  }
  const successful = runs.filter((item) => !item.error);
  const equivalent = successful.length === modes.length * repetitions && successful.every((run) =>
    JSON.stringify(Object.entries(run.summary).sort()) === JSON.stringify(Object.entries(successful[0].summary).sort()));
  writeFileSync(output, JSON.stringify({
    source_sha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
    host: { platform: platform(), cpu: cpus()[0]?.model, release: release(), node: process.version },
    core: revision(coreRoot), revisions: Object.fromEntries(modes.map(({ name, cwd }) => [name, revision(cwd)])),
    cache: 'fresh application data each run; uncontrolled OS cache',
    repeats: repetitions, equivalent, runs,
    stats: Object.fromEntries(modes.map(({name}) => [name, summarize(successful.filter((run) => run.mode === name)
      .map((run) => run.prepared_ms))])),
  }, null, 2) + '\n', { flag: 'wx' });
  if (!equivalent) process.exitCode = 1;
} finally {
  rmSync(root, { force: true, recursive: true });
}
