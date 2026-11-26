import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import electron from 'electron';

const require = createRequire(import.meta.url);
const directory = mkdtempSync(join(tmpdir(), 'cuekoda-library-smoke-'));
const count = Number(process.env.CUEKODA_SMOKE_LIBRARY_COUNT ?? 1200);
if (!Number.isInteger(count) || count < 1000 || count > 10000) throw new Error('Expected 1000–10000 fixture tracks');
try {
  const audio = join(directory, 'audio');
  mkdirSync(audio);
  const original = join(directory, 'reference.wav');
  execFileSync(require('ffmpeg-static'), [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=12', original,
  ]);
  const preview = join(directory, 'preview.js');
  execFileSync(process.execPath, ['dist/cli/cli.js', original, '--out', join(directory, 'analysis'), '--preview', preview], {
    stdio: 'inherit', timeout: 90000,
  });
  const window = {};
  runInNewContext(readFileSync(preview, 'utf8'), { window }, { timeout: 3000 });
  const [result] = window.__RESULTS__;
  const tracks = {};
  for (let index = 0; index < count; index++) {
    const name = `Library fixture ${String(index).padStart(4, '0')}`;
    const path = join(audio, `${name}.wav`);
    linkSync(original, path);
    tracks[path] = { path, fileName: basename(path), status: 'done', addedAt: index, result: { ...result, path, fileName: basename(path), title: name } };
  }
  writeFileSync(join(directory, 'library.json'), JSON.stringify({ version: 1, tracks }));
  const measure = process.argv.includes('--measure');
  const run = (virtualizeLibrary) => {
    writeFileSync(join(directory, 'settings.json'), JSON.stringify({ virtualizeLibrary, autoUpdateCheck: false }));
    const child = spawnSync(electron, ['.'], {
      env: { ...process.env, CUEKODA_SMOKE_LIBRARY_PROFILE: directory, CUEKODA_SMOKE_LIBRARY_MEASURE: measure ? '1' : '' },
      timeout: process.env.CUEKODA_SMOKE_LIBRARY_INSPECT === '1' ? undefined : 90000,
      stdio: 'inherit',
    });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(`Library smoke failed with status ${child.status}`);
  };
  if (measure) {
    for (let trial = 0; trial < 10; trial++) {
      for (const virtual of trial % 2 === 0 ? [false, true] : [true, false]) run(virtual);
    }
  } else {
    run(true);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
