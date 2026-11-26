import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import electron from 'electron';

const [output, repeat = '10', size = '0'] = process.argv.slice(2);
const repetitions = Number(repeat);
const rows = Number(size);
if (!output || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100
  || ![0, 10, 100, 1000, 10000].includes(rows)) {
  console.error('Usage: node scripts/electron-desktop-benchmark.mjs output.json [1–100 runs] [0|10|100|1000|10000]');
  process.exit(2);
}

const root = mkdtempSync(join(tmpdir(), 'cuekoda-architecture-'));
const metricPrefix = 'CUEKODA_BENCHMARK_METRICS ';
const runs = [];
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function rssByPid(metrics) {
  if (platform() === 'win32') {
    return new Map(metrics.filter((metric) => Number.isFinite(metric.memory?.workingSetSize))
      .map((metric) => [metric.pid, metric.memory.workingSetSize]));
  }
  try {
    const table = execFileSync('ps', ['-o', 'pid=,rss=', '-p', metrics.map((metric) => metric.pid).join(',')], {
      encoding: 'utf8', timeout: 1000,
    });
    return new Map(table.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)));
  } catch {
    return new Map();
  }
}

async function launch(directory) {
  const start = performance.now();
  const child = spawn(electron, ['.'], {
    env: { ...process.env, CUEKODA_BENCHMARK_DATA: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const samples = [];
  let readyMs = null;
  let virtualCheck = null;
  let requestedStop = false;
  let error = null;
  let idleTimer;
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-2500); });
  const timeout = setTimeout(() => {
    error = 'Startup or sampling timeout';
    child.kill('SIGKILL');
  }, 30_000);
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (line === 'CUEKODA_BENCHMARK_READY') {
      readyMs = performance.now() - start;
      idleTimer = setTimeout(() => {
        requestedStop = true;
        child.kill();
      }, 2250);
    } else if (line.startsWith('CUEKODA_VIRTUAL_CHECK ')) {
      virtualCheck = JSON.parse(line.slice('CUEKODA_VIRTUAL_CHECK '.length));
    } else if (line.startsWith(metricPrefix)) {
      const metrics = JSON.parse(line.slice(metricPrefix.length));
      const rss = rssByPid(metrics);
      const processes = metrics.map(({ pid, type, cpu }) => ({
        pid, type, rss_kib: rss.get(pid) ?? null,
        cpu_percent: cpu.percentCPUUsage,
        cpu_seconds: cpu.cumulativeCPUUsage,
      }));
      samples.push({ elapsed_ms: performance.now() - start, processes });
    }
  });
  const result = await new Promise((resolve) => {
    child.on('error', (failure) => { error = failure.message; });
    child.on('close', (exitCode, signal) => resolve({ exit_code: exitCode, signal }));
  });
  clearTimeout(timeout);
  clearTimeout(idleTimer);
  if (!requestedStop || readyMs === null || !samples.length) error ??= 'Run ended before the observation window completed';
  return { ...result, ready_ms: readyMs, virtual_check: virtualCheck, samples, error, ...(error ? { stderr } : {}) };
}

function summarize(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return {
    count: values.length,
    median: (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2,
    p95: values[Math.ceil(values.length * 0.95) - 1],
  };
}

function totals(run, field) {
  // Skip the first second to separate startup settling from the idle window.
  return run.samples.filter((sample) => sample.elapsed_ms >= run.ready_ms + 1000)
    .map(({ processes }) => processes.every((process) => Number.isFinite(process[field]))
      ? processes.reduce((sum, process) => sum + process[field], 0) : null)
    .filter(Number.isFinite);
}

try {
  for (let i = 0; i < repetitions; i++) {
    const directory = join(root, String(i));
    mkdirSync(directory);
    const tracks = Object.fromEntries(Array.from({ length: rows }, (_, index) => {
      const path = join(directory, `Synthetic track ${index}.wav`);
      return [path, { path, status: 'error', addedAt: index, error: 'Synthetic library fixture' }];
    }));
    writeFileSync(join(directory, 'library.json'), JSON.stringify({ version: 2, tracks }));
    runs.push(await launch(directory));
  }
  const successful = runs.filter((run) => !run.error);
  const report = {
    schema_version: 1, revision, electron: JSON.parse(execFileSync(process.execPath, ['-p',
      'JSON.stringify(require("electron/package.json").version)'], { encoding: 'utf8' })),
    command: 'electron .', fixture: { rows, audio_files: 0, status: 'error' },
    host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logical_cpus: cpus().length, ram_bytes: totalmem(), node: process.version },
    virtual_library: process.env.CUEKODA_VIRTUAL_LIBRARY === '1',
    cache: { profile: 'fresh per run', system: 'uncontrolled' },
    summary: {
      renderer_ready_ms: summarize(successful.map((run) => run.ready_ms)),
      sampled_idle_rss_kib: summarize(successful.map((run) => summarize(totals(run, 'rss_kib'))?.median).filter(Number.isFinite)),
      sampled_idle_cpu_percent: summarize(successful.map((run) => summarize(totals(run, 'cpu_percent'))?.median).filter(Number.isFinite)),
    },
    failures: runs.length - successful.length,
    runs,
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ rows, ...report.summary, failures: report.failures }));
  if (report.failures) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
