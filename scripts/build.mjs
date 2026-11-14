// Bundles every entry point with esbuild and copies the static renderer files.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'node20' };

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
      'cli/cli': 'src/cli/cli.ts',
      'test/run': 'src/test/run.ts',
      'test/diag': 'src/test/diag.ts',
      'test/regression': 'src/test/regression.ts',
      'test/unit': 'src/test/unit.ts',
    },
    outdir: 'dist',
    external: ['electron', 'ffmpeg-static', 'essentia.js', '@tensorflow/tfjs', '@tensorflow/tfjs-backend-wasm'],
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
console.log('build ok');
