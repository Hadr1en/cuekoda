import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, arch, platform, release } from 'node:os';
import { extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const [binaryArgument, output, ...files] = process.argv.slice(2);
if (!binaryArgument || !output || !files.length) {
  console.error('Usage: node scripts/benchmark-waveforms.mjs /absolute/path/cuekoda-core report.json fixture.wav ...');
  process.exit(2);
}
const binary = resolve(binaryArgument);
const outfile = resolve('dist/benchmark-waveforms.cjs');
await build({
  stdin: { contents: "export { computePeaks } from './src/core/peaks'; export { rustWaveform } from './src/main/rustWaveform';",
    resolveDir: process.cwd(), loader: 'ts' },
  outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external',
});
const require = createRequire(import.meta.url);
const { computePeaks, rustWaveform } = require(outfile);
const bands = ['peak', 'low', 'mid', 'high'];

function compare(legacy, rust) {
  let difference = 0;
  if (legacy.perSec !== rust.perSec) throw new Error('Sample rate mismatch');
  for (const band of bands) {
    if (legacy[band].length !== rust[band].length) throw new Error('Waveform length mismatch');
    for (let i = 0; i < legacy[band].length; i++) {
      difference = Math.max(difference, Math.abs(legacy[band][i] - rust[band][i]));
    }
  }
  return difference;
}

function timing(runs) {
  const values = runs.toSorted((a, b) => a - b);
  return { median_ms: (values[4] + values[5]) / 2, p95_ms: values[9], raw_ms: runs };
}

const cases = [];
for (const input of files) {
  const path = resolve(input);
  const actions = { legacy: () => computePeaks(path), rust: () => rustWaveform(binary, path) };
  const samples = { legacy: [], rust: [] };
  let max_absolute_error = 0;
  let bins = 0;
  for (let i = 0; i < 10; i++) {
    const result = {};
    for (const mode of i % 2 === 0 ? ['legacy', 'rust'] : ['rust', 'legacy']) {
      const start = performance.now();
      result[mode] = await actions[mode]();
      samples[mode].push(performance.now() - start);
    }
    bins = result.legacy.peak.length;
    max_absolute_error = Math.max(max_absolute_error, compare(result.legacy, result.rust));
  }
  cases.push({
    extension: extname(path),
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    bins, max_absolute_error,
    legacy: timing(samples.legacy),
    rust: timing(samples.rust),
  });
}
const ffmpeg = require('ffmpeg-static');
const report = {
  host: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model, node: process.version },
  ffmpeg: execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0],
  os_cache: 'uncontrolled, alternating paired order',
  cases,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(cases.map(({extension, bins, max_absolute_error, legacy, rust}) => ({
  extension, bins, max_absolute_error, legacy_ms: legacy.median_ms, rust_ms: rust.median_ms,
})));
if (cases.some((item) => item.max_absolute_error > 0.001 + Number.EPSILON)) process.exitCode = 1;
