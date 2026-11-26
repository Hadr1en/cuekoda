import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const [app, output] = process.argv.slice(2);
if (!['cuekoda-tauri', 'cuekoda-gpui'].includes(app) || !output) {
  console.error('Usage: node scripts/stage-native-experiment.mjs cuekoda-tauri|cuekoda-gpui DIRECTORY');
  process.exit(2);
}
const ext = process.platform === 'win32' ? '.exe' : '';
const files = [
  [`rust/${app}/target/release/${app}${ext}`, `bin/${app}${ext}`],
  [`rust/cuekoda-core/target/release/cuekoda-core${ext}`, `bin/cuekoda-core${ext}`],
  ['dist/cli/experiment-worker.js', 'dist/cli/experiment-worker.js'],
  ['dist/main/neural-runner.js', 'dist/main/neural-runner.js'],
  ['scripts/launch-native-experiment.mjs', 'scripts/launch-native-experiment.mjs'],
  ['package.json', 'package.json'],
  ['package-lock.json', 'package-lock.json'],
  ['LICENSE', 'LICENSE'],
  ['models', 'models'],
];
for (const [source, target] of files) {
  const path = join(output, target);
  await mkdir(join(path, '..'), { recursive: true });
  await cp(source, path, { recursive: true, force: true });
}
