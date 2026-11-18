import * as fs from 'node:fs';

interface Report {
  engine: string;
  summary: Summary;
  breakdown?: { genreFamily?: { name: string; summary: Summary }[] };
}

interface Summary {
  counts?: Record<string, number>;
  [key: string]: number | Record<string, number> | undefined;
}

const [beforeFile, afterFile] = process.argv.slice(2).filter((value) => !value.startsWith('--'));
if (!beforeFile || !afterFile) {
  console.error('Usage : npm run eval:compare -- avant.json apres.json [--max-bpm-regression 0.02]');
  process.exit(2);
}
const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8')) as Report;
const after = JSON.parse(fs.readFileSync(afterFile, 'utf8')) as Report;
const value = (summary: Summary, metric: string) => typeof summary[metric] === 'number' ? summary[metric] as number : 0;
const metrics = ['bpmWithin1Pct', 'downbeatAccuracy', 'beatF', 'downbeatF', 'cueExactF1', 'sectionF1', 'vocalF1'] as const;
const countKey: Partial<Record<typeof metrics[number], string>> = {
  bpmWithin1Pct: 'bpm', downbeatAccuracy: 'grid', beatF: 'beats', downbeatF: 'beats',
  cueExactF1: 'cues', sectionF1: 'sections', vocalF1: 'vocals',
};
const rows = metrics.filter((metric) => {
  const key = countKey[metric];
  return !key || (before.summary.counts?.[key] ?? 0) > 0 || (after.summary.counts?.[key] ?? 0) > 0;
}).map((metric) => ({
  mesure: metric,
  avant: value(before.summary, metric),
  apres: value(after.summary, metric),
  delta: value(after.summary, metric) - value(before.summary, metric),
}));
console.table(rows.map((row) => ({ ...row, avant: row.avant.toFixed(3), apres: row.apres.toFixed(3), delta: `${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(3)}` })));
const family = new Map((before.breakdown?.genreFamily ?? []).map((group) => [group.name, group.summary]));
const familyRows = (after.breakdown?.genreFamily ?? []).flatMap((group) => {
  const base = family.get(group.name);
  return base ? [{
    famille: group.name,
    bpm: value(group.summary, 'bpmWithin1Pct') - value(base, 'bpmWithin1Pct'),
    beatF: value(group.summary, 'beatF') - value(base, 'beatF'),
    sections: value(group.summary, 'sectionF1') - value(base, 'sectionF1'),
  }] : [];
});
if (familyRows.length) console.table(familyRows);
const arg = process.argv.indexOf('--max-bpm-regression');
const allowed = arg >= 0 ? Number(process.argv[arg + 1]) : 0.02;
const bpmDelta = rows.find((row) => row.mesure === 'bpmWithin1Pct')?.delta;
if ((bpmDelta !== undefined && bpmDelta < -allowed) || familyRows.some((row) => row.bpm < -allowed)) {
  console.error(`Régression BPM supérieure à ${(allowed * 100).toFixed(1)} point(s), comparaison refusée.`);
  process.exitCode = 1;
}
