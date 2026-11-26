import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [binaryArgument, ...files] = process.argv.slice(2);
assert(binaryArgument && files.length, 'Usage: node scripts/test-experiment-music.mjs CORE FIXTURE ...');
const binary = resolve(binaryArgument);
const worker = resolve('dist/cli/experiment-worker.js');
const env = { ...process.env, CUEKODA_EXPERIMENT_WORKER: worker };

function call(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function request(input, extraEnv = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'cuekoda-music-test-'));
  try {
    writeFileSync(join(folder, 'request.json'), JSON.stringify(input));
    call(process.execPath, [worker, folder], { env: { ...env, ...extraEnv } });
    const response = JSON.parse(readFileSync(join(folder, 'response.json'), 'utf8'));
    assert.equal(response.schemaVersion, 1);
    assert.equal(response.error, undefined);
    return response.result;
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
}

const canonicalExport = (text) => text.replace(/UUID="cuekoda-\d+"/g, 'UUID="cuekoda-test"');
const canonical = (track) => JSON.parse(JSON.stringify(track, (key, value) =>
  key === 'id' || key === 'analysisMs' ? undefined : value));
for (const input of files) {
  const source = resolve(input);
  const legacy = request({ operation: 'analyze', source }, { CUEKODA_EXPERIMENT_PCM: '' });
  const rust = JSON.parse(call(binary, ['music', source], {
    env: { ...env, CUEKODA_EXPERIMENT_PCM: binary, CUEKODA_EXPERIMENT_NODE: process.execPath },
  }));
  assert.deepEqual(canonical(rust), canonical(legacy));
  const timeSec = [0.37, 0.71, 1.19, 2.38].find((time) =>
    rust.cues.every((cue) => Math.abs(cue.timeSec - time) > 0.03));
  assert(timeSec !== undefined);
  const edited = request({ operation: 'cue', track: rust, slot: 7, timeSec });
  const retained = request({ operation: 'analyze', source, previous: edited }, { CUEKODA_EXPERIMENT_PCM: binary });
  assert(retained.cues.some((cue) => cue.origin === 'user' && cue.timeSec === timeSec));
  for (const [format, marker] of [['xml', '<DJ_PLAYLISTS'], ['nml', '<NML'], ['m3u8', '#EXTM3U']]) {
    const collection = request({ operation: 'export', format, track: rust });
    assert(collection.includes(marker));
    assert.equal(canonicalExport(collection), canonicalExport(request({ operation: 'export', format, track: legacy })));
    if (format !== 'm3u8') {
      const editedCollection = request({ operation: 'export', format, track: edited });
      const imported = request({ operation: 'import', format, collection: editedCollection, track: rust });
      assert.equal(imported.path, legacy.path);
      assert.equal(imported.bpm, legacy.bpm);
      assert(imported.importedFrom);
      assert(imported.cues.some((cue) => cue.locked && Math.abs(cue.timeSec - timeSec) < 0.001));
    }
  }
  console.log('Exact musical fields and identical exports:', source.split(/[\\/]/).pop());
}
