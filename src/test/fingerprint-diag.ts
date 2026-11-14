/**
 * Fingerprint calibration helper:  node dist/test/fingerprint-diag.js <file|folder> [...]
 * Prints, for every pair at the same tempo, the best alignment (longest run of matching bars, match ratio).
 */
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { compareFingerprints } from '../core/fingerprint';
import { collectAudioFiles } from '../core/scan';
import type { AnalysisResult } from '../core/types';

async function main() {
  const files = collectAudioFiles(process.argv.slice(2));
  const rs: AnalysisResult[] = [];
  for (const f of files) {
    rs.push(await analyzeFile(f, { profileId: 'edm' }));
    process.stdout.write('.');
  }
  console.log();
  const rows: string[] = [];
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const m = rs[i].fingerprint && rs[j].fingerprint ? compareFingerprints(rs[i].fingerprint!, rs[j].fingerprint!) : null;
      if (!m) continue;
      rows.push(
        `${String(m.longestRunBars).padStart(4)} run  ${(m.matchRatio * 100).toFixed(0).padStart(3)} %  ovl ${String(m.overlapBars).padStart(3)}  off ${String(m.offsetBars).padStart(4)}  ` +
          `${path.basename(rs[i].path).slice(0, 30)}  ↔  ${path.basename(rs[j].path).slice(0, 30)}`,
      );
    }
  }
  rows.sort((a, b) => parseInt(b) - parseInt(a));
  console.log(rows.join('\n'));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
