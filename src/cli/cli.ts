/**
 * Command line front-end (same engine as the app):
 *   node dist/cli/cli.js <file|folder> [...] [--out DIR] [--min-bpm N] [--max-bpm N]
 * Writes rekordbox.xml + traktor.nml + analysis.json into --out (default ./cuekoda-out).
 *   --profile <id>   DJ profile (edm, house, techhouse, techno, trance, harddance,
 *                    drumandbass, bass, global, hiphop, openformat, edm-fixed)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { collectAudioFiles } from '../core/scan';
import { buildRekordboxXml } from '../core/export/rekordbox';
import { buildTraktorNml } from '../core/export/traktor';
import { AnalysisResult } from '../core/types';

async function main() {
  const args = process.argv.slice(2);
  const inputs: string[] = [];
  let out = 'cuekoda-out';
  const opts: { minBpm?: number; maxBpm?: number; profileId?: string } = {};
  let previewFile = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') out = args[++i];
    else if (a === '--min-bpm') opts.minBpm = Number(args[++i]);
    else if (a === '--max-bpm') opts.maxBpm = Number(args[++i]);
    else if (a === '--profile') opts.profileId = args[++i];
    else if (a === '--preview') previewFile = args[++i];
    else inputs.push(a);
  }
  if (inputs.length === 0) {
    console.error('usage: cli <file|folder> [...] [--out DIR] [--min-bpm N] [--max-bpm N]');
    process.exit(2);
  }
  const files = collectAudioFiles(inputs);
  console.log(`${files.length} fichier(s) audio`);
  const results: AnalysisResult[] = [];
  for (const f of files) {
    try {
      const r = await analyzeFile(f, opts);
      results.push(r);
      const cues = r.cues.map((c) => `${c.slot >= 0 ? 'ABCDEFGH'[c.slot] : 'mémo'}:${c.name}@${c.timeSec.toFixed(1)}s`).join(' ');
      console.log(
        `${r.fileName}  ${r.bpm.toFixed(2)} BPM  ${r.key.camelot || '?'} (${r.key.musical || '?'})  [${(r.analysisMs / 1000).toFixed(1)}s]\n   ${cues}` +
          (r.warnings.length ? `\n   ⚠ ${r.warnings.join(' | ')}` : ''),
      );
    } catch (e) {
      console.error(`${path.basename(f)}: ${(e as Error).message}`);
    }
  }
  if (results.length) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'rekordbox.xml'), buildRekordboxXml(results, { memoryCues: true, loops: 'accepted' }));
    fs.writeFileSync(path.join(out, 'traktor.nml'), buildTraktorNml(results, { memoryCues: false, loops: 'accepted' }));
    fs.writeFileSync(
      path.join(out, 'analysis.json'),
      JSON.stringify(results.map(({ wave, waveLow, ...r }) => r), null, 2),
    );
    if (previewFile) {
      // dev-only: real results for scripts/preview-mock.js
      const { BUILTIN_PROFILES } = await import('../core/profiles');
      const { ADAPTERS } = await import('../core/export/index');
      fs.writeFileSync(
        previewFile,
        `window.__RESULTS__ = ${JSON.stringify(results)};\nwindow.__PROFILES__ = ${JSON.stringify(BUILTIN_PROFILES)};\n` +
          `window.__ADAPTERS__ = ${JSON.stringify(ADAPTERS.map(({ build: _b, ...a }) => a))};`,
      );
    }
    console.log(`→ ${path.resolve(out)}`);
  } else {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
