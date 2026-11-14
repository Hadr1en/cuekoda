/**
 * Non-regression on real tracks: re-analyses a folder and compares with a stored baseline.
 *   node dist/test/regression.js <folder> [--update]
 * The baseline is NOT ground truth (no verified annotations yet): it detects silent changes.
 * Differences are listed; exit code 1 when anything moved beyond tolerance.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { collectAudioFiles } from '../core/scan';

const BASELINE = path.resolve('tests/baselines/samples.json');

interface Entry {
  bpm: number;
  key: string;
  firstDownbeatSec: number;
  landmarks: Record<string, number>;
  sections: string[];
  energy: number;
}

async function main() {
  const dir = process.argv[2];
  const update = process.argv.includes('--update');
  if (!dir) {
    console.error('usage: regression <folder> [--update]');
    process.exit(2);
  }
  const files = collectAudioFiles([dir]);
  const now: Record<string, Entry> = {};
  for (const f of files) {
    const r = await analyzeFile(f, { profileId: 'edm' });
    const landmarks: Record<string, number> = {};
    for (const c of r.cues) landmarks[c.role] = Math.round(c.timeSec * 100) / 100;
    now[path.basename(f).normalize('NFC')] = {
      bpm: Math.round(r.bpm * 100) / 100,
      key: r.key.camelot,
      firstDownbeatSec: Math.round(r.grid.firstDownbeatSec * 1000) / 1000,
      landmarks,
      sections: (r.sections ?? []).map((s) => `${s.type}@${s.startBar}`),
      energy: r.energy?.score ?? 0,
    };
    process.stdout.write('.');
  }
  console.log();
  if (update || !fs.existsSync(BASELINE)) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2));
    console.log(`baseline écrite : ${BASELINE} (${Object.keys(now).length} morceaux)`);
    return;
  }
  const base: Record<string, Entry> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  let diffs = 0;
  const report = (name: string, msg: string) => {
    diffs++;
    console.log(`  ✗ ${name}: ${msg}`);
  };
  for (const [name, b] of Object.entries(base)) {
    const n = now[name];
    if (!n) { report(name, 'absent du dossier'); continue; }
    if (Math.abs(n.bpm - b.bpm) > 0.05) report(name, `BPM ${b.bpm} → ${n.bpm}`);
    if (n.key !== b.key) report(name, `clé ${b.key} → ${n.key}`);
    if (Math.abs(n.firstDownbeatSec - b.firstDownbeatSec) > 0.01) report(name, `downbeat ${b.firstDownbeatSec} → ${n.firstDownbeatSec}`);
    for (const [role, t] of Object.entries(b.landmarks)) {
      const t2 = n.landmarks[role];
      if (t2 === undefined) report(name, `cue ${role} disparu (était à ${t}s)`);
      else if (Math.abs(t2 - t) > 0.1) report(name, `cue ${role} ${t}s → ${t2}s`);
    }
    for (const role of Object.keys(n.landmarks)) if (!(role in b.landmarks)) report(name, `nouveau cue ${role} à ${n.landmarks[role]}s`);
    if (n.sections.join(' ') !== b.sections.join(' ')) report(name, `sections ${b.sections.join(' ')} → ${n.sections.join(' ')}`);
  }
  console.log(diffs ? `${diffs} différence(s) par rapport à la référence` : 'Aucune différence avec la référence');
  process.exit(diffs ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
