import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const [app, ...inputs] = process.argv.slice(2);
if (!app) {
  console.error('Usage: node scripts/launch-native-experiment.mjs APPLICATION [FILES...]');
  process.exit(2);
}
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const binary = process.platform === 'win32' ? 'cuekoda-core.exe' : 'cuekoda-core';
const staged = resolve('bin', binary);
const decoder = existsSync(staged) ? staged : resolve('rust/cuekoda-core/target/release', binary);
const child = spawn(resolve(app), inputs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    CUEKODA_EXPERIMENT_FFMPEG: ffmpeg,
    CUEKODA_EXPERIMENT_NODE: process.execPath,
    CUEKODA_EXPERIMENT_PCM: decoder,
    CUEKODA_EXPERIMENT_WORKER: resolve('dist/cli/experiment-worker.js'),
  },
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
