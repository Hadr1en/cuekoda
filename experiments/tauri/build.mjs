import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist/tauri', { recursive: true });
await Promise.all([
  copyFile('experiments/tauri/index.html', 'dist/tauri/index.html'),
  copyFile('src/renderer/styles.css', 'dist/tauri/shared.css'),
  copyFile('experiments/tauri/style.css', 'dist/tauri/style.css'),
  build({ entryPoints: ['experiments/tauri/renderer.ts'], bundle: true, outfile: 'dist/tauri/renderer.js' }),
]);
