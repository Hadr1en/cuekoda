// Bundles every entry point with esbuild and copies the static renderer files.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'node20' };

// A removed entry point must never survive in a later installer as a stale bundle.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/renderer', { recursive: true });

await Promise.all([
  // Electron main process + worker threads + CLI + tests: Node, CommonJS.
  build({
    ...common,
    platform: 'node',
    format: 'cjs',
    entryPoints: {
      'main/main': 'src/main/main.ts',
      'main/worker': 'src/main/worker.ts',
      'main/neural-runner': 'src/main/neuralRunner.ts',
      'cli/cli': 'src/cli/cli.ts',
      'test/run': 'src/test/run.ts',
      'test/diag': 'src/test/diag.ts',
      'test/regression': 'src/test/regression.ts',
      'test/unit': 'src/test/unit.ts',
      'test/evaluate': 'src/test/evaluate-cli.ts',
      'test/export-electro-cue-features': 'src/test/export-electro-cue-features.ts',
      'test/fingerprint-diag': 'src/test/fingerprint-diag.ts',
      'test/offset-test': 'src/test/offset-test.ts',
      'test/beat-diag': 'src/test/beat-diag.ts',
    },
    outdir: 'dist',
    external: ['electron', 'ffmpeg-static', 'essentia.js', '@tensorflow/tfjs', '@tensorflow/tfjs-backend-wasm', 'onnxruntime-node'],
  }),
  // Preload script (sandboxed renderer bridge).
  build({
    ...common,
    platform: 'node',
    format: 'cjs',
    entryPoints: { 'main/preload': 'src/main/preload.ts' },
    outdir: 'dist',
    external: ['electron'],
  }),
  // Renderer (browser context).
  build({
    ...common,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    entryPoints: { 'renderer/renderer': 'src/renderer/renderer.ts' },
    outdir: 'dist',
  }),
]);

cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
cpSync('assets/logo/png/cuekoda-icone-128.png', 'dist/renderer/cuekoda-icon.png');
console.log('build ok');
