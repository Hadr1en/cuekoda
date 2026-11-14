import type { AnalysisResult } from '../types';
import { buildRekordboxXml, exportedLoops } from './rekordbox';
import { buildTraktorNml } from './traktor';

/**
 * Export engine: one adapter per DJ software, independent from the analysis engine.
 * Every capability states what is really written and whether it was validated by importing into
 * the target software. Nothing is written into proprietary databases or into audio files.
 */
export interface ExportOptions {
  /** Also write each hot cue as a memory cue (rekordbox) */
  memoryCues: boolean;
  /** Which loops to export */
  loops: 'accepted' | 'all' | 'none';
  /** macOS volume name of the music drive (Traktor paths) */
  macVolume?: string;
}

export type SupportLevel = 'yes' | 'partial' | 'no';

export interface Capability {
  field: string;
  support: SupportLevel;
  note: string;
}

export interface ExportAdapter {
  id: 'rekordbox' | 'traktor' | 'serato';
  name: string;
  /** available = file produced by CueKoda; unavailable = needs another tool or would alter audio files */
  status: 'available' | 'unavailable';
  /** true only once an import into the real software has been verified */
  validated: boolean;
  extension: string;
  formatName: string;
  capabilities: Capability[];
  howToImport: string[];
  build?: (tracks: AnalysisResult[], opts: ExportOptions) => string;
}

export const ADAPTERS: ExportAdapter[] = [
  {
    id: 'rekordbox',
    name: 'rekordbox',
    status: 'available',
    validated: false,
    extension: 'xml',
    formatName: 'rekordbox XML (collection)',
    capabilities: [
      { field: 'BPM', support: 'yes', note: 'AverageBpm + TEMPO' },
      { field: 'Beatgrid', support: 'yes', note: 'Marqueur de tempo unique, ou un marqueur par segment quand le tempo change' },
      { field: 'Tonalité', support: 'yes', note: 'Tonality (notation musicale)' },
      { field: 'Hot cues (8)', support: 'yes', note: 'POSITION_MARK Num 0–7' },
      { field: 'Noms des cues', support: 'yes', note: 'Attribut Name' },
      { field: 'Couleurs des cues', support: 'partial', note: 'Red/Green/Blue — rekordbox peut ramener à sa palette' },
      { field: 'Memory cues', support: 'yes', note: 'Num -1 (option)' },
      { field: 'Loops', support: 'yes', note: 'Memory loops Type 4 Start/End' },
      { field: 'Sections / énergie / phrases', support: 'no', note: 'Pas de champ d’import (analyse de phrases rekordbox propriétaire)' },
    ],
    howToImport: [
      'rekordbox › Préférences › Avancé › Base de données › rekordbox xml : sélectionner le fichier exporté.',
      'Afficher la vue « rekordbox xml » dans l’arborescence, puis glisser les morceaux dans la Collection.',
      'Si un morceau est déjà dans la Collection, rekordbox peut demander s’il faut écraser ses informations : vérifier avant de confirmer.',
    ],
    build: (tracks, opts) => buildRekordboxXml(tracks, opts),
  },
  {
    id: 'traktor',
    name: 'Traktor Pro',
    status: 'available',
    validated: false,
    extension: 'nml',
    formatName: 'Traktor NML (collection)',
    capabilities: [
      { field: 'BPM', support: 'yes', note: 'TEMPO BPM' },
      { field: 'Beatgrid', support: 'partial', note: 'Marqueur AutoGrid sur le premier temps (un seul tempo : les changements de tempo ne sont pas transférés)' },
      { field: 'Tonalité', support: 'yes', note: 'MUSICAL_KEY + INFO KEY (Open Key)' },
      { field: 'Hot cues (8)', support: 'yes', note: 'CUE_V2 HOTCUE 0–7' },
      { field: 'Noms des cues', support: 'yes', note: 'Attribut NAME' },
      { field: 'Couleurs des cues', support: 'no', note: 'Traktor colore les cues par type, pas par couleur libre' },
      { field: 'Memory cues', support: 'no', note: 'Les hot cues suffisent dans Traktor' },
      { field: 'Loops', support: 'yes', note: 'CUE_V2 TYPE 5 avec LEN (boucles mémorisées)' },
      { field: 'Sections / énergie / phrases', support: 'no', note: 'Pas de champ correspondant' },
    ],
    howToImport: [
      'Sauvegarder d’abord collection.nml (Traktor le fait aussi dans le dossier Backup).',
      'Traktor › Browser › clic droit sur Track Collection › Import Another Collection : choisir le fichier exporté.',
      'Les hot cues existants des morceaux déjà présents peuvent être remplacés : vérifier sur un morceau test.',
    ],
    build: (tracks, opts) => buildTraktorNml(tracks, opts, opts.macVolume),
  },
  {
    id: 'serato',
    name: 'Serato DJ Pro',
    status: 'unavailable',
    validated: false,
    extension: '',
    formatName: 'Tags Serato dans les fichiers audio (GEOB « Serato Markers2 »)',
    capabilities: [
      { field: 'Toutes données', support: 'no', note: 'Serato stocke cues, grille et BPM dans les tags des fichiers audio' },
    ],
    howToImport: [
      'Écrire ces tags modifierait vos fichiers audio sources : CueKoda ne le fait pas.',
      'Alternative : exporter vers rekordbox, puis convertir la bibliothèque avec un outil tiers (ex. Lexicon, Rekord Buddy) ou la fonction d’import de bibliothèques tierces de Serato si votre version la propose — non vérifié par CueKoda.',
    ],
  },
];

/** What will actually be transferred for these tracks (shown before exporting). */
export function exportSummary(adapter: ExportAdapter, tracks: AnalysisResult[], opts: ExportOptions): string[] {
  if (adapter.status !== 'available') return adapter.howToImport;
  const cues = tracks.reduce((s, t) => s + t.cues.filter((c) => c.slot >= 0 && c.slot <= 7).length, 0);
  const loops = tracks.reduce((s, t) => s + exportedLoops(t, opts.loops).length, 0);
  const keys = tracks.filter((t) => t.key.camelot).length;
  const out = [
    `${tracks.length} morceau(x) : BPM et grille (premier temps) pour chacun`,
    `${keys} tonalité(s)`,
    `${cues} hot cue(s)${adapter.id === 'rekordbox' ? ' avec noms et couleurs' : ' avec noms (couleurs non transférables)'}`,
  ];
  if (adapter.id === 'rekordbox' && opts.memoryCues) out.push(`${cues} memory cue(s)`);
  out.push(`${loops} boucle(s) (${opts.loops === 'accepted' ? 'validées uniquement' : opts.loops === 'all' ? 'toutes les suggestions' : 'aucune'})`);
  out.push('Non transférés : sections, énergie, phrases, suggestions Mix In/Out');
  return out;
}
