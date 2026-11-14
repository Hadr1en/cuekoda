// Dev-only: builds dist/renderer/preview.html from the real src/renderer/index.html, with the CSP
// removed and a mocked window.cuekoda, so the UI can be inspected in a regular browser.
//   CUEKODA_DUMP=dist/renderer/preview-data.js npm test   # produce real analysis data
//   node scripts/make-preview.mjs
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

let html = readFileSync('src/renderer/index.html', 'utf8');
html = html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '');
html = html.replace(
  '<script src="renderer.js"></script>',
  '<script src="preview-data.js"></script>\n    <script src="preview-mock.js"></script>\n    <script src="renderer.js"></script>',
);
writeFileSync('dist/renderer/preview.html', html);
copyFileSync('scripts/preview-mock.js', 'dist/renderer/preview-mock.js');
console.log('preview ready: dist/renderer/preview.html');
