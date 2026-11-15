import type { AnalysisResult } from '../types';
import { buildRekordboxXml, exportedLoops } from './rekordbox';
import { buildTraktorNml, traktorCues } from './traktor';
import { duplicateCueIds } from '../cues';
import { formatKey, type KeyNotation } from '../key';

/**
 * Export engine: one adapter per DJ software, independent from the analysis engine.
 * Capabilities describe the fields written into each collection format.
 */
export interface ExportOptions {
  /** Also write each hot cue as a memory cue (rekordbox) */
  memoryCues: boolean;
  /** Which loops to export */
  loops: 'accepted' | 'all' | 'none';
  /** macOS volume name of the music drive (Traktor paths) */
  macVolume?: string;
  /** Write "E8 · 8B · Vocal" in the Comments field (default on), to sort / filter in the DJ software */
  commentTags?: boolean;
  /** Name of the exported playlist (tracks in the given order) — a set from the mix-order window */
  playlistName?: string;
}

/**
 * Short tag for the DJ software's Comments field: energy, key and vocals, e.g. "E8 · 8B · Vocal".
 * Vocals are named only on clear evidence: "Vocal" with a clear sung passage, "Instru" when the detector
 * was informative and found nothing at all; otherwise nothing (the detector is not validated).
 */
export function commentTag(t: AnalysisResult, notation: KeyNotation = 'camelot'): string {
  const parts: string[] = [];
  if (t.energy) parts.push(`E${Math.round(t.energy.score)}`);
  const key = formatKey(t.key, notation);
  if (key) parts.push(key);
  const v = t.vocals;
  if (v && v.informative !== false) {
    if (v.segments.some((s) => s.strength === 'strong')) parts.push('Vocal');
    else if (!v.segments.length) parts.push('Instru');
  }
  return parts.join(' · ');
}

export type SupportLevel = 'yes' | 'partial' | 'no';

export interface Capability {
  field: string;
  support: SupportLevel;
  note: string;
}

export type ExportTargetId = 'rekordbox' | 'traktor' | 'engine' | 'virtualdj' | 'djay';

export interface ExportAdapter {
  id: ExportTargetId;
  name: string;
  /** Short line under the name (who makes it / which hardware) */
  tagline: string;
  /** The file format actually written, when it is another software's format */
  via?: 'rekordbox' | 'traktor';
  extension: string;
  formatName: string;
  capabilities: Capability[];
  howToImport: string[];
  build: (tracks: AnalysisResult[], opts: ExportOptions) => string;
}

/**
 * Software that reads a rekordbox XML collection with its own import workflow.
 */
function viaRekordbox(o: Pick<ExportAdapter, 'id' | 'name' | 'tagline' | 'howToImport'>): ExportAdapter[] {
  return [{
    ...o,
    via: 'rekordbox',
    extension: 'xml',
    formatName: 'rekordbox XML (lu par ' + o.name + ')',
    capabilities: [
      { field: 'BPM, grille, tonalité', support: 'partial', note: 'Inclus dans le fichier rekordbox XML' },
      { field: 'Hot cues, noms', support: 'partial', note: 'POSITION_MARK 0–7 dans le fichier XML' },
      { field: 'Couleurs, memory cues, boucles', support: 'partial', note: 'Selon la version de ' + o.name },
      { field: 'Sections / énergie / phrases', support: 'no', note: 'Pas de champ d’import' },
    ],
    build: (tracks, opts) => buildRekordboxXml(tracks, opts, opts.playlistName || 'CueKoda'),
  }];
}

export const ADAPTERS: ExportAdapter[] = [
  {
    id: 'rekordbox',
    name: 'rekordbox',
    tagline: 'AlphaTheta / Pioneer DJ',
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
      { field: 'Commentaire « E8 · 8B · Vocal »', support: 'yes', note: 'Attribut Comments (option)' },
      { field: 'Playlist (set)', support: 'yes', note: 'NODE Type 1, morceaux dans l’ordre' },
      { field: 'Sections / énergie / phrases', support: 'no', note: 'Pas de champ d’import (analyse de phrases rekordbox propriétaire)' },
    ],
    howToImport: [
      'rekordbox › Préférences › Avancé › Base de données › rekordbox xml : sélectionner le fichier exporté.',
      'Afficher la vue « rekordbox xml » dans l’arborescence, puis glisser les morceaux dans la Collection.',
      'Si un morceau est déjà dans la Collection, rekordbox peut demander s’il faut écraser ses informations : vérifier avant de confirmer.',
    ],
    build: (tracks, opts) => buildRekordboxXml(tracks, opts, opts.playlistName || 'CueKoda'),
  },
  {
    id: 'traktor',
    name: 'Traktor Pro',
    tagline: 'Native Instruments',
    extension: 'nml',
    formatName: 'Traktor NML (collection)',
    capabilities: [
      { field: 'BPM', support: 'yes', note: 'TEMPO BPM' },
      { field: 'Beatgrid', support: 'partial', note: 'Marqueur AutoGrid sur le premier temps (un seul tempo : les changements de tempo ne sont pas transférés)' },
      { field: 'Tonalité', support: 'yes', note: 'MUSICAL_KEY + INFO KEY (Open Key)' },
      { field: 'Hot cues (8)', support: 'partial', note: 'Pads exportés à la suite sur les boutons 2–8 ; bouton 1 réservé à AutoGrid' },
      { field: 'Noms des cues', support: 'yes', note: 'Attribut NAME' },
      { field: 'Couleurs des cues', support: 'no', note: 'Traktor colore les cues par type, pas par couleur libre' },
      { field: 'Memory cues', support: 'partial', note: 'Cues sans pad et cues au-delà du bouton 8' },
      { field: 'Loops', support: 'yes', note: 'CUE_V2 TYPE 5 avec LEN (boucles mémorisées)' },
      { field: 'Commentaire « E8 · 1d · Vocal »', support: 'yes', note: 'INFO COMMENT (option)' },
      { field: 'Playlist (set)', support: 'yes', note: 'NODE PLAYLIST, morceaux dans l’ordre' },
      { field: 'Sections / énergie / phrases', support: 'no', note: 'Pas de champ correspondant' },
    ],
    howToImport: [
      'Sauvegarder d’abord collection.nml (Traktor le fait aussi dans le dossier Backup).',
      'Traktor › Browser › clic droit sur Track Collection › Import Another Collection : choisir le fichier exporté.',
      'Traktor peut remplacer les hot cues des morceaux déjà présents dans sa collection.',
    ],
    build: (tracks, opts) => buildTraktorNml(tracks, opts, opts.macVolume),
  },
  ...viaRekordbox({
    id: 'engine',
    name: 'Engine DJ',
    tagline: 'Denon DJ / Numark / Rane (Prime, SC Live…)',
    howToImport: [
      'Engine DJ Desktop › Préférences › Library : activer la bibliothèque rekordbox et indiquer le fichier XML exporté par CueKoda.',
      'Les morceaux apparaissent sous « rekordbox » dans la colonne de gauche : les importer (glisser) dans la Collection Engine DJ.',
      'Engine DJ peut aussi lire une collection Traktor : si vous préférez, exportez pour Traktor et indiquez ce fichier NML.',
      'Le libellé exact des menus peut varier selon la version d’Engine DJ.',
    ],
  }),
  ...viaRekordbox({
    id: 'virtualdj',
    name: 'VirtualDJ',
    tagline: 'Atomix Productions',
    howToImport: [
      'VirtualDJ › Paramètres › Options : renseigner le chemin du fichier rekordbox XML (option « rekordboxXml » / bibliothèques tierces).',
      'Le dossier « rekordbox » du navigateur VirtualDJ affiche alors les morceaux exportés avec leurs cues.',
      'Les options et libellés varient selon la version de VirtualDJ.',
    ],
  }),
  ...viaRekordbox({
    id: 'djay',
    name: 'djay Pro',
    tagline: 'Algoriddim (macOS, Windows, iPad)',
    howToImport: [
      'djay Pro › Réglages › Bibliothèque : activer l’intégration rekordbox et choisir le fichier XML exporté par CueKoda.',
      'Les morceaux apparaissent sous « rekordbox » dans la bibliothèque de djay, avec leurs cues.',
      'La reprise des cues et de leurs couleurs dépend de la version de djay.',
    ],
  }),
];

/** What will actually be transferred for these tracks (shown before exporting). */
export function exportSummary(adapter: ExportAdapter, tracks: AnalysisResult[], opts: ExportOptions): string[] {
  const xml = adapter.id === 'rekordbox' || adapter.via === 'rekordbox';
  const cuesByTrack = tracks.map((t) => xml
    ? t.cues.filter((c) => c.slot <= 7).map((cue) => ({ cue, hotcue: cue.slot }))
    : traktorCues(t));
  const allCues = cuesByTrack.flat();
  const cues = allCues.filter(({ hotcue }) => hotcue >= 0).length;
  const memo = allCues.length - cues;
  const variable = tracks.filter((t) => (t.tempoMap?.length ?? 0) > 1).length;
  const loops = tracks.reduce((s, t) => s + exportedLoops(t, opts.loops).length, 0);
  const keys = tracks.filter((t) => t.key.camelot).length;
  const out = [
    `${tracks.length} morceau(x) : BPM et grille (premier temps) pour chacun`,
    `${keys} tonalité(s)`,
    `${cues} hot cue(s)${xml ? ' avec noms et couleurs' : ' avec noms (couleurs non transférables)'}`,
  ];
  if (xml && opts.memoryCues) out.push(`${cues} memory cue(s) aux positions des hot cues`);
  if (memo) out.push(`${memo} memory cue(s) sans pad${xml ? '' : ' (cues mémorisés Traktor)'}`);
  if (variable && !xml) out.push(`⚠ Tempo variable : Traktor ne reçoit qu’un tempo pour ${variable} morceau(x)`);
  if (adapter.via) out.push(`Fichier au format rekordbox XML, à indiquer dans ${adapter.name}`);
  if (opts.commentTags !== false && tracks.length) {
    const openKey = adapter.id === 'traktor';
    const example = commentTag(tracks[0], openKey ? 'openKey' : 'camelot') || (openKey ? 'E8 · 1d · Vocal' : 'E8 · 8B · Vocal');
    out.push(`Commentaire de chaque morceau : énergie, clé et voix (ex. « ${example} »)`);
  }
  if (opts.playlistName) out.push(`Playlist « ${opts.playlistName} » : ${tracks.length} morceau(x) dans l’ordre du set`);
  out.push(`${loops} boucle(s) (${opts.loops === 'accepted' ? 'validées uniquement' : opts.loops === 'all' ? 'toutes les suggestions' : 'aucune'})`);
  if (!xml) {
    const gridDuplicates = tracks.reduce((s, t) => s + t.cues.filter((c) => c.slot <= 7).length, 0) - allCues.length;
    if (gridDuplicates) out.push(`${gridDuplicates} cue(s) au premier temps déjà couvert(s) par AutoGrid`);
  }
  const dupTracks = tracks.map((t, i) => ({ t, n: duplicateCueIds(cuesByTrack[i].map(({ cue }) => cue)).size })).filter((x) => x.n > 0);
  if (dupTracks.length) {
    const n = dupTracks.reduce((s, x) => s + x.n, 0);
    out.push(`⚠ ${n} cue(s) au même endroit qu’un autre (${dupTracks.slice(0, 3).map((x) => x.t.title).join(', ')}${dupTracks.length > 3 ? '…' : ''}) : un pad gaspillé chacun`);
  }
  out.push('Non transférés : sections, énergie, phrases, suggestions Mix In/Out');
  return out;
}
