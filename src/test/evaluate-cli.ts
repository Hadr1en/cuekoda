/**
 * Engine evaluation against reference annotations (spec §21).
 *   npm run eval                                   → references saved by the app (user data folder)
 *   npm run eval -- --refs <file|dir> [--audio <dir>] → e.g. tests/ground-truth (files found by name in --audio)
 *   npm run eval -- --dataset giantsteps-tempo|giantsteps-key|harmonix --annotations <dir> --audio <dir>
 *   options: --limit <n>, --write docs/EVALUATION.md, --json <file>
 * Each file is re-analysed from scratch (no corrections, no cache) and compared. Cues count as found only
 * on the right beat (±40 ms) and with the same kind; ±1 beat is reported separately.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { evaluateTrack, summarize, type Reference, type TrackEvaluation } from '../core/evaluate';
import { ENGINE_VERSION } from '../core/types';
import { DATASETS, loadDataset, type DatasetId } from '../core/datasets';
import { collectAudioFiles } from '../core/scan';

function appReferencesPath(): string {
  const base =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
        : process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(base, 'CueKoda', 'references.json');
}

function loadReferences(src: string): Reference[] {
  const st = fs.statSync(src);
  const parse = (f: string): Reference[] => {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Array.isArray(j)) return j;
    if (j.refs) return Object.values(j.refs);
    return [j];
  };
  if (st.isDirectory()) return fs.readdirSync(src).filter((f) => f.endsWith('.json')).flatMap((f) => parse(path.join(src, f)));
  return parse(src);
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

const fmt = (v: number, d = 2) => v.toFixed(d);

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
  const write = opt('--write');
  const json = opt('--json');
  const limit = Number(opt('--limit')) || Infinity;
  const dataset = opt('--dataset') as DatasetId | '';
  let refs: Reference[];
  let label: string;
  if (dataset) {
    if (!DATASETS.includes(dataset)) { console.error(`--dataset : ${DATASETS.join(' | ')}`); process.exit(2); }
    const { refs: r, withoutAudio } = loadDataset(dataset, opt('--annotations'), opt('--audio'));
    refs = r;
    label = `jeu de données ${dataset}`;
    if (withoutAudio) console.log(`${withoutAudio} annotation(s) sans fichier audio correspondant (ignorées)`);
    if (!refs.length) {
      console.error(`Aucune paire audio/annotation exploitable pour ${dataset}.`);
      process.exit(2);
    }
  } else {
    const refsSrc = opt('--refs') || appReferencesPath();
    if (!fs.existsSync(refsSrc)) {
      console.error(`Aucune référence trouvée (${refsSrc}).\nDans l'app : onglet Infos › « Valider comme référence » sur des morceaux vérifiés à l'oreille.`);
      process.exit(2);
    }
    refs = loadReferences(refsSrc);
    label = 'références vérifiées par le DJ';
    // references whose path is empty or stale are looked up by file name in --audio
    const audioDir = opt('--audio');
    if (audioDir) {
      const byName = new Map(collectAudioFiles([audioDir]).map((f) => [path.basename(f).normalize('NFC'), f]));
      for (const r of refs) if (!r.path || !fs.existsSync(r.path)) r.path = byName.get(r.fileName.normalize('NFC')) ?? r.path;
    }
  }
  refs = refs.slice(0, limit);
  const evals: TrackEvaluation[] = [];
  const missing: string[] = [];
  let failed = 0;
  for (const ref of refs) {
    if (!ref.path || !fs.existsSync(ref.path)) {
      missing.push(ref.fileName);
      continue;
    }
    let det;
    try {
      det = await analyzeFile(ref.path, { profileId: ref.profileId ?? 'edm' }); // fresh: no overrides, no user edits, no cache
    } catch (e) {
      console.log(`${ref.fileName}: échec de l'analyse (${(e as Error).message})`);
      failed++;
      continue;
    }
    const e = evaluateTrack(det, ref);
    evals.push(e);
    const parts = [ref.fileName.slice(0, 44).padEnd(44)];
    if (e.bpm) parts.push(`BPM ${fmt(e.bpm.detected)}/${fmt(e.bpm.reference)}`);
    if (e.grid) parts.push(`phase ${e.grid.phaseErrorMs.toFixed(0)} ms${e.grid.downbeatOk ? '' : ' (temps 1 faux)'}`);
    if (e.beats) parts.push(`temps F ${fmt(e.beats.fMeasure)} · temps 1 F ${fmt(e.beats.downbeatF)}`);
    if (e.key) parts.push(`clé ${e.key.detected}/${e.key.reference} (${e.key.score})`);
    if (e.cues) parts.push(`cues au bon temps ${e.cues.exact}/${e.cues.reference} (±1 temps : ${e.cues.matched})`);
    if (e.sections) parts.push(`sections ${e.sections.matched}/${e.sections.reference}`);
    console.log(parts.join('  '));
    for (const m of e.cues?.misses ?? []) {
      const err = m.errorBeats === null ? 'aucun cue de ce type' : `${m.errorBeats > 0 ? '+' : ''}${fmt(m.errorBeats, 1)} temps`;
      console.log(`    ✗ ${m.name} à ${fmt(m.timeSec, 3)} s : ${err}`);
    }
  }
  if (dataset && !evals.length) {
    console.error(`Aucune analyse réussie pour ${dataset}.`);
    process.exit(2);
  }
  const s = summarize(evals);
  const c = s.counts;
  const rows: [string, number, string][] = [
    ['BPM à ±1 %', c.bpm, `${pct(s.bpmWithin1Pct)} (${s.bpmOctaveErrors} erreur(s) d'octave)`],
    ['Erreur de phase de grille (médiane)', c.grid, `${s.medianPhaseErrorMs.toFixed(1)} ms`],
    ['Premier temps correct', c.grid, pct(s.downbeatAccuracy)],
    ['Temps / premiers temps : F-mesure à ±70 ms', c.beats, `${fmt(s.beatF)} / ${fmt(s.downbeatF)}`],
    ['Tonalité (score MIREX / exacte)', c.key, `${fmt(s.keyMirexScore)} / ${pct(s.keyExact)}`],
    ['Cues au bon temps (±40 ms, même type) : rappel', c.cues, pct(s.cueExactRecall)],
    ['Cues au bon temps : F1', c.cues, fmt(s.cueExactF1)],
    ['Cues à ±1 temps : F1 (écart moyen)', c.cues, `${fmt(s.cueF1)} (${fmt(s.cueMeanOffsetBeats)} temps)`],
    ['Frontières de sections : F1 à ±1 mesure', c.sections, fmt(s.sectionF1)],
  ];
  const lines = [
    `# Évaluation du moteur CueKoda v${ENGINE_VERSION}`,
    '',
    `${s.tracks} morceau(x) — ${label}${missing.length ? ` (${missing.length} introuvable(s) : ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''})` : ''}.`,
    ...(dataset ? [`${refs.length} analyse(s) tentée(s), ${failed} échec(s) de l'analyse.`] : []),
    'Les références du DJ ne sont pas exhaustives : pour les cues, le rappel compte plus que la précision.',
    '',
    '| Mesure | Morceaux | Résultat |',
    '|---|---|---|',
    ...rows.filter(([, n]) => n > 0).map(([m, n, v]) => `| ${m} | ${n} | ${v} |`),
    ...(s.energySpearman !== null ? [`| Énergie : corrélation de Spearman avec le ressenti | — | ${fmt(s.energySpearman)} |`] : []),
    '',
  ];
  console.log('\n' + lines.join('\n'));
  if (write) {
    fs.writeFileSync(write, lines.join('\n'));
    console.log(`→ ${write}`);
  }
  if (json) fs.writeFileSync(json, JSON.stringify({ engine: ENGINE_VERSION, summary: s, tracks: evals }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
