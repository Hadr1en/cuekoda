// Renders the logo SVGs to PNG with Electron's Chromium (offscreen).
//   node_modules/.bin/electron scripts/render-logo.cjs
// Outputs assets/logo/png/* and build/icon.png (1024 px, used by electron-builder for .icns / .ico).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const logo = path.join(root, 'assets', 'logo');
const out = path.join(logo, 'png');

const jobs = [
  ['cuekoda-icone-macos.svg', 1024, 1024, path.join(root, 'build', 'icon.png')],
  ...[1024, 512, 256, 128, 64, 32, 16].map((s) => ['cuekoda-icone.svg', s, s, path.join(out, `cuekoda-icone-${s}.png`)]),
  ['cuekoda-symbole.svg', 512, 512, path.join(out, 'cuekoda-symbole-512.png')],
  ['cuekoda-logo-sombre.svg', 2400, 720, path.join(out, 'cuekoda-logo-sombre@2x.png')],
  ['cuekoda-logo-clair.svg', 2400, 720, path.join(out, 'cuekoda-logo-clair@2x.png')],
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  // One offscreen window reused for every render (re-creating windows breaks subsequent loads)
  const win = new BrowserWindow({ width: 2400, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const pages = [];
  try {
    for (const [i, [file, w, h, dest]] of jobs.entries()) {
      const page = path.join(logo, `.render-${process.pid}-${i}.html`);
      pages.push(page);
      fs.writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
        <img src="${file}" style="display:block;width:${w}px;height:${h}px"></body></html>`);
      win.setContentSize(w, h);
      await win.loadFile(page);
      await new Promise((r) => setTimeout(r, 300));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
      const sized = img.getSize().width === w ? img : img.resize({ width: w, height: h, quality: 'best' });
      fs.writeFileSync(dest, sized.toPNG());
      console.log(`${path.relative(root, dest)}  ${sized.getSize().width}×${sized.getSize().height}`);
    }
  } catch (e) {
    console.error('render failed:', e.message);
    process.exitCode = 1;
  } finally {
    for (const p of pages) fs.rmSync(p, { force: true });
    win.destroy();
    app.quit();
  }
});
