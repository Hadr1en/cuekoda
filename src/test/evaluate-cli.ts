/**
 * Engine evaluation against the DJ's reference annotations (spec §21).
 *   npm run eval                     → references saved by the app (user data folder)
 *   npm run eval -- --refs <file|dir> [--write docs/EVALUATION.md]
 * Each referenced file is re-analysed from scratch (no corrections, no cache) and compared.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { evaluateTrack, summarize, type Reference, type TrackEvaluation } from '../core/evaluate';
import { ENGINE_VERSION } from '../core/types';

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

async function main() {
  const args = process.argv.slice(2);
  const refsSrc = args.includes('--refs') ? args[args.indexOf('--refs') + 1] : appReferencesPath();
  const write = args.includes('--write') ? args[args.indexOf('--write') + 1] : '';
  if (!fs.existsSync(refsSrc)) {
    console.error(`Aucune référence trouvée (${refsSrc}).\nDans l'app : onglet Infos › « Valider comme référence » sur des morceaux vérifiés à l'oreille.`);
    process.exit(2);
  }
  const refs = loadReferences(refsSrc);
  const evals: TrackEvaluation[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    if (!fs.existsSync(ref.path)) {
      missing.push(ref.fileName);
      continue;
    }
    const det = await analyzeFile(ref.path, { profileId: ref.profileId ?? 'edm' }); // fresh: no overrides, no user edits, no cache
    const e = evaluateTrack(det, ref);
    evals.push(e);
    console.log(
      `${ref.fileName.slice(0, 44).padEnd(44)} BPM ${e.bpm.detected.toFixed(2)}/${e.bpm.reference.toFixed(2)}` +
        `  phase ${e.grid.phaseErrorMs.toFixed(0)} ms${e.grid.downbeatOk ? '' : ' (temps 1 faux)'}` +
        `  clé ${e.key.detected}/${e.key.reference} (${e.key.score})` +
        `  cues ${e.cues.matched}/${e.cues.reference}  sections ${e.sections.matched}/${e.sections.reference}`,
    );
  }
  const s = summarize(evals);
  const lines = [
    `# Évaluation du moteur CueKoda v${ENGINE_VERSION}`,
    '',
    `${s.tracks} morceau(x) de référence vérifiés par le DJ${missing.length ? ` (${missing.length} introuvable(s) : ${missing.join(', ')})` : ''}.`,
    '',
    '| Mesure | Résultat |',
    '|---|---|',
    `| BPM à ±1 % | ${pct(s.bpmWithin1Pct)} (${s.bpmOctaveErrors} erreur(s) d'octave) |`,
    `| Erreur de phase de grille (médiane) | ${s.medianPhaseErrorMs.toFixed(1)} ms |`,
    `| Premier temps correct | ${pct(s.downbeatAccuracy)} |`,
    `| Tonalité (score MIREX / exacte) | ${s.keyMirexScore.toFixed(2)} / ${pct(s.keyExact)} |`,
    `| Hot cues : F1 à ±1 temps (écart moyen) | ${s.cueF1.toFixed(2)} (${s.cueMeanOffsetBeats.toFixed(2)} temps) |`,
    `| Frontières de sections : F1 à ±1 mesure | ${s.sectionF1.toFixed(2)} |`,
    `| Énergie : corrélation de Spearman avec le ressenti | ${s.energySpearman === null ? 'n/a (moins de 3 notes)' : s.energySpearman.toFixed(2)} |`,
    '',
  ];
  console.log('\n' + lines.join('\n'));
  if (write) {
    fs.writeFileSync(write, lines.join('\n'));
    console.log(`→ ${write}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
