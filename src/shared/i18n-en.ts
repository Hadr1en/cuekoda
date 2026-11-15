/**
 * English dictionary for the CueKoda UI (French → English).
 * EN_EXACT: whole strings exactly as they appear in the French UI.
 * EN_PATTERNS: generated sentences, anchored regexes (^…$, no global flag), tried in order.
 * Dependency-free: the few patterns that embed another translatable text use the local `tl` helper.
 */
type Rep = string | ((...m: string[]) => string);

// ------------------------------------------------------------------ local helpers
/** English plural for a counted word: "1 bar", "16 bars". */
const pl = (n: string, one: string, many = `${one}s`) => `${n} ${Number(n.replace(',', '.')) === 1 ? one : many}`;
/** 1st, 2nd, 3rd, 4th… */
const ordinal = (n: string) => {
  const v = Number(n);
  const s = v % 100 >= 11 && v % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[v % 10] ?? 'th';
  return `${n}${s}`;
};
/** Translates an embedded text: exact entry, then patterns, then its " · " / " ; " / ", " parts. */
function tl(s: string | undefined): string {
  if (!s) return s ?? '';
  const e = EN_EXACT[s];
  if (e !== undefined) return e;
  for (const [re, rep] of EN_PATTERNS) if (re.test(s)) return s.replace(re, rep as never);
  for (const sep of [' · ', ' ; ', ', ', ' — ']) {
    if (s.includes(sep)) {
      const parts = s.split(sep);
      const out = parts.map(tl);
      if (out.some((p, i) => p !== parts[i])) return out.join(sep === ' ; ' ? '; ' : sep);
    }
  }
  return s;
}

/** Analysis stages reported by the engine (src/core/analyzer.ts) */
const STAGE: Record<string, string> = {
  démarrage: 'starting',
  décodage: 'decoding',
  tempo: 'tempo',
  grille: 'beatgrid',
  structure: 'structure',
  voix: 'vocals',
  tonalité: 'key',
  terminé: 'done',
};

/** Why a transition starts / enters there (src/core/transition.ts) */
const why = (w: string) => (w.startsWith('cue ') ? w : tl(w));

/** Suffix appended to Mix In / Mix Out reasons by withVocals (src/core/mix.ts) */
const MIX_VOCALS: Record<string, string> = {
  ', aucune voix détectée': ', no vocals detected',
  ', voix possible (indice faible)': ', possible vocals (weak evidence)',
  ', voix nette — éviter de superposer avec un passage chanté': ', clear vocals — avoid layering with a sung passage',
};

export const EN_EXACT: Record<string, string> = {
  // ================================================================ header, library (index.html)
  'Actions principales': 'Main actions',
  Fichiers: 'Files',
  '+ Fichiers': '+ Files',
  '+ Dossier': '+ Folder',
  'Profil DJ : règles de cues, couleurs, boucles et plage BPM': 'DJ profile: cue rules, colors, loops and BPM range',
  Profil: 'Profile',
  profil: 'profile',
  Annuler: 'Cancel',
  '↻ Relancer les erreurs': '↻ Retry errors',
  'Doublons et versions liées': 'Duplicates and related versions',
  Doublons: 'Duplicates',
  'Réglages (profils, performances, dossiers surveillés)': 'Settings (profiles, performance, watched folders)',
  Réglages: 'Settings',
  Exporter: 'Export',
  'Exporter…': 'Export…',
  Bibliothèque: 'Library',
  'Filtrer (titre, artiste, clé, BPM)…': 'Filter (title, artist, key, BPM)…',
  'Aucun morceau ne correspond': 'No matching tracks',
  'Effacer les filtres': 'Clear filters',
  Transport: 'Playback controls',
  Métronome: 'Metronome',
  'Écouter la grille avec un clic accentué au premier temps': 'Hear the beatgrid with an accented downbeat',
  'Métronome indisponible': 'Metronome unavailable',
  'Morceau précédent': 'Previous track',
  'Morceau suivant': 'Next track',
  'Filtrer la bibliothèque': 'Filter the library',
  'Suggestion d’ordre de mix pour les morceaux affichés (à toi de décider)': 'Suggested mix order for the tracks shown (your call)',
  'Ordre de mix…': 'Mix order…',
  'Ré-analyser les morceaux affichés (vos corrections sont conservées)': 'Re-analyze the tracks shown (your corrections are kept)',
  '↻ Ré-analyser': '↻ Re-analyze',
  'Retirer de la bibliothèque (les fichiers ne sont pas touchés)': 'Remove from the library (files are not touched)',
  Retirer: 'Remove',
  'Glisse des fichiers ou un dossier ici': 'Drop files or a folder here',
  'Import → Analyse → Revue → Export. Les fichiers audio ne sont jamais modifiés ni envoyés en ligne.':
    'Import → Analyze → Review → Export. Audio files are never modified or uploaded.',
  'Morceaux de la bibliothèque': 'Library tracks',
  État: 'Status',
  Titre: 'Title',
  'Titre (tag)': 'Title (tag)',
  Artiste: 'Artist',
  Clé: 'Key',
  Énergie: 'Energy',
  énergie: 'energy',
  Fiabilité: 'Reliability',
  Durée: 'Duration',
  'Analyse du morceau': 'Track analysis',
  'Diviser par 2': 'Halve',
  'Multiplier par 2': 'Double',
  Grille: 'Grid',
  'Le temps 1 d’une mesure est à la position de lecture': 'Beat 1 of a bar is at the playhead',
  'Temps 1 ici': 'Downbeat here',
  'Décaler la grille de −10 ms': 'Shift the grid by −10 ms',
  'Décaler la grille de +10 ms': 'Shift the grid by +10 ms',
  'Le temps 1 était un autre temps : décaler d’un temps': 'Beat 1 was another beat: shift by one beat',
  '+1 temps': '+1 beat',
  Tonalité: 'Key',
  '▶︎ Lecture': '▶︎ Play',
  'Lecture / pause': 'Play / pause',
  Dézoomer: 'Zoom out',
  Zoomer: 'Zoom in',
  Tout: 'Fit',
  'Molette : zoom · Maj+molette : défiler · glisser un cue (Alt = sans aimantation) · ? : raccourcis':
    'Wheel: zoom · Shift+wheel: scroll · drag a cue (Alt = no snapping) · ?: shortcuts',
  'Annuler (⌘Z)': 'Undo (⌘Z)',
  '↶ Annuler': '↶ Undo',
  'Rétablir (⇧⌘Z)': 'Redo (⇧⌘Z)',
  '↷ Rétablir': '↷ Redo',
  'Waveform — flèches : une mesure, Maj+flèches : un temps': 'Waveform — arrows: one bar, Shift+arrows: one beat',
  Préparation: 'Preparation',
  Boucles: 'Loops',
  'Boucles : ': 'Loops: ',
  'Mix & compatibles': 'Mix & matches',
  Infos: 'Info',
  'Dépose pour analyser': 'Drop to analyze',
  'Fermer la notification': 'Close notification',

  // ================================================================ library rows, queue, progress
  'En attente': 'Queued',
  Annulé: 'Cancelled',
  'Analysé (cache)': 'Analyzed (cached)',
  Analysé: 'Analyzed',
  ambiguë: 'ambiguous',
  Reprendre: 'Resume',
  ...Object.fromEntries(Object.entries(STAGE).filter(([k]) => k !== 'tempo' && k !== 'structure')),
  ' · l’analyse précédente reste affichée, tes corrections seront conservées': ' · the previous analysis stays on screen, your corrections will be kept',
  'Tempo, grille, structure, voix puis tonalité : les cues apparaîtront à la fin de l’analyse.':
    'Tempo, grid, structure, vocals, then key: the cues will appear when the analysis is done.',

  // ================================================================ corrections (detail header)
  manuel: 'manual',
  'tempo variable': 'variable tempo',
  '↺ Revenir à la détection automatique': '↺ Back to automatic detection',
  'Plusieurs tonalités plausibles': 'Several plausible keys',
  'Temps 1 placé à la lecture': 'Downbeat set at the playhead',
  'Grille −10 ms': 'Grid −10 ms',
  'Grille +10 ms': 'Grid +10 ms',
  'Temps 1 décalé d’un temps': 'Downbeat shifted by one beat',
  'Clé automatique': 'Automatic key',
  'ré-analyse en cours (vos cues sont conservés)': 're-analyzing (your cues are kept)',

  // ================================================================ tab: hot cues
  'Placé manuellement': 'Placed manually',
  'memory cue (les 8 pads sont occupés)': 'memory cue (all 8 pads are taken)',
  'Ce cue est verrouillé': 'This cue is locked',
  libre: 'free',
  '+ ici': '+ here',
  'Modifié par vous : conservé lors des ré-analyses': 'Edited by you: kept when re-analyzing',
  'Modifié par vous': 'Edited by you',
  perso: 'edited',
  doublon: 'duplicate',
  'Même position qu’un autre cue : ce pad est en double': 'Same position as another cue: this pad is a duplicate',
  'Aller au cue': 'Go to cue',
  '1 mesure plus tôt': '1 bar earlier',
  '1 temps plus tôt': '1 beat earlier',
  '1 temps plus tard': '1 beat later',
  '1 mesure plus tard': '1 bar later',
  '−mes': '−bar',
  '+mes': '+bar',
  Déverrouiller: 'Unlock',
  'Verrouiller (protégé des ré-analyses et modifications)': 'Lock (protected from re-analysis and edits)',
  'Supprimer le cue': 'Delete cue',
  'Type du nouveau cue': 'New cue type',
  '+ Cue ici': '+ Cue here',
  '+ Memory cue ici': '+ Memory cue here',
  'Posé sur le temps le plus proche de la lecture. Pads pleins : le cue devient une memory cue (exportée sans pad).':
    'Snapped to the beat nearest the playhead. Pads full: the cue becomes a memory cue (exported without a pad).',
  Nom: 'Name',
  'Nom de la memory cue': 'Memory cue name',
  'Type de la memory cue': 'Memory cue type',
  'Aller à la memory cue': 'Go to memory cue',
  'Supprimer la memory cue': 'Delete memory cue',

  // ================================================================ tab: loops
  'Longueur de la nouvelle boucle': 'New loop length',
  '+ Boucle à la position de lecture': '+ Loop at the playhead',
  'Seules les boucles validées sont exportées par défaut.': 'Only approved loops are exported by default.',
  Boucle: 'Loop',
  Début: 'Start',
  Longueur: 'Length',
  Confiance: 'Confidence',
  Pourquoi: 'Why',
  Validée: 'Approved',
  'Nom de la boucle': 'Loop name',
  'Valider la boucle': 'Approve loop',
  '■ Stop boucle': '■ Stop loop',
  '▶ Écouter': '▶ Listen',
  'Supprimer la boucle': 'Delete loop',
  'Aucune suggestion de boucle pour ce morceau avec le profil actuel.': 'No loop suggestions for this track with the current profile.',
  'Ajoutée manuellement': 'Added manually',

  // ================================================================ tab: structure, vocal parts
  'Longueur du nouveau passage vocal': 'New vocal part length',
  Voix: 'Vocals',
  'voix ?': 'vocals?',
  'Passages vocaux corrigés par vous : conservés lors des ré-analyses.': 'Vocal parts corrected by you: kept when re-analyzing.',
  'Détection automatique non validée : corrige les passages (début / fin à la mesure près), ils seront conservés.':
    'Unvalidated automatic detection: correct the parts (start / end to the bar), your edits will be kept.',
  '+ Passage vocal à la lecture': '+ Vocal part at the playhead',
  'Le passage vocal en cours s’arrête à la mesure de lecture': 'The current vocal part ends at the playhead bar',
  'Aucun passage vocal avant la position de lecture': 'No vocal part before the playhead',
  'Fin de voix ici': 'Vocals end here',
  'Coupe le passage vocal à la mesure de lecture (pause dans le chant)': 'Splits the vocal part at the playhead bar (gap in the singing)',
  'Place la lecture à l’intérieur d’un passage vocal': 'Put the playhead inside a vocal part',
  'Pause dans la voix ici': 'Vocal gap here',
  Fin: 'End',
  'Début une mesure plus tôt': 'Start one bar earlier',
  'Début une mesure plus tard': 'Start one bar later',
  'Fin une mesure plus tôt': 'End one bar earlier',
  'Fin une mesure plus tard': 'End one bar later',
  'Présence de la voix': 'Vocal presence',
  nette: 'clear',
  'faible / chœurs': 'faint / backing vocals',
  'Écouter le passage': 'Listen to the part',
  'Créer un cue Vocal au début du passage': 'Create a Vocal cue at the start of the part',
  'Supprimer le passage vocal': 'Delete vocal part',
  'Aucun passage vocal.': 'No vocal parts.',
  'Pas de phrasé régulier détecté : aucune limite de phrase n’est affichée (pas d’hypothèse forcée).':
    'No regular phrasing detected: no phrase boundaries are shown (no forced guess).',
  ' Couplet / refrain ne sont pas proposés automatiquement. Les passages vocaux se corrigent plus bas.':
    ' Verse / chorus are not suggested automatically. Vocal parts can be corrected below.',
  'Placez la lecture à l’intérieur d’une section': 'Put the playhead inside a section',
  'Scinder à la position de lecture': 'Split at the playhead',
  'Type de section': 'Section type',
  'Nom de la section': 'Section name',
  Écouter: 'Listen',
  'Supprimer (fusionner avec la section précédente)': 'Delete (merge with the previous section)',

  // ================================================================ playback, transition preview
  'Lecture impossible pour le moment': 'Playback not possible right now',
  'Lecture impossible pour le moment — réessayez dans un instant': 'Playback not possible right now — try again in a moment',
  'lecture interrompue': 'playback interrupted',
  'fichier inaccessible (dossier protégé par macOS ou fichier déplacé ?)': 'file not accessible (folder protected by macOS, or file moved?)',
  'décodage impossible': 'cannot decode',
  'format non pris en charge par le lecteur': 'format not supported by the player',
  'erreur inconnue': 'unknown error',
  'Espace : arrêter': 'Space: stop',
  'suggestion Mix Out': 'Mix Out suggestion',
  'suggestion Mix In': 'Mix In suggestion',
  '32 mesures avant la fin': '32 bars before the end',
  'premier temps 1': 'first downbeat',

  // ================================================================ tab: mix & compatibles
  'Créer un cue': 'Create a cue',
  'Aucune suggestion.': 'No suggestions.',
  'Suggestions à valider : elles s’appuient sur la structure, les phrases, l’énergie, la percussion et la détection vocale (expérimentale).':
    'Suggestions to review: they rely on structure, phrases, energy, percussion and vocal detection (experimental).',
  'Morceaux compatibles': 'Compatible tracks',
  'Écouter la transition : fin de ce morceau → début de l’autre, tempo calé, temps alignés, fondu de 16 mesures':
    'Listen to the transition: end of this track → start of the other, tempo matched, beats aligned, 16-bar crossfade',
  '■ Arrêter': '■ Stop',
  'Pas encore de morceau compatible dans la bibliothèque.': 'No compatible track in the library yet.',

  // ================================================================ tab: info
  'Métadonnées du fichier': 'File metadata',
  Fichier: 'File',
  'Sans perte': 'Lossless',
  oui: 'yes',
  non: 'no',
  Échantillonnage: 'Sample rate',
  Débit: 'Bitrate',
  Canaux: 'Channels',
  Taille: 'Size',
  Année: 'Year',
  'BPM déjà tagué': 'BPM already tagged',
  'Clé déjà taguée': 'Key already tagged',
  'Résultats d’analyse (estimations)': 'Analysis results (estimates)',
  Stabilité: 'Stability',
  'Alternatives tempo': 'Tempo alternatives',
  'Repère électro proposé après comparaison des changements sur plusieurs mesures':
    'Electronic music cue suggested from changes across several bars',
  'Impossible d’enregistrer la notation de tonalité.': 'Could not save the key notation.',
  'Notation de tonalité': 'Key notation',
  'Choisir la notation de tonalité': 'Choose the key notation',
  'Ajustement de la grille': 'Grid fit',
  'Premier temps': 'First downbeat',
  'Alternatives tonalité': 'Key alternatives',
  'Loudness intégrée': 'Integrated loudness',
  'Plage de loudness': 'Loudness range',
  'RMS / crête': 'RMS / peak',
  'Énergie estimée': 'Estimated energy',
  'Voix (expérimental)': 'Vocals (experimental)',
  Moteur: 'Engine',
  'depuis le cache': 'from cache',
  'Afficher le fichier': 'Show file',
  'Ré-analyser sans cache (corrections conservées)': 'Re-analyze without cache (corrections kept)',
  'Votre ressenti d’énergie (optionnel)': 'Your energy rating (optional)',
  'Énergie ressentie : —': 'Perceived energy: —',
  'Référence de qualité': 'Quality reference',
  'Quand ce morceau est vérifié à l’oreille et corrigé (BPM, temps 1, clé, cues, sections), enregistrez-le comme référence. ':
    'Once this track has been checked by ear and corrected (BPM, downbeat, key, cues, sections), save it as a reference. ',
  '« npm run eval » ré-analyse ensuite les références sans vos corrections et mesure la justesse du moteur.':
    '“npm run eval” then re-analyzes the references without your corrections and measures the engine’s accuracy.',
  'Référence enregistrée : elle servira à évaluer le moteur': 'Reference saved: it will be used to evaluate the engine',
  'Mettre à jour la référence': 'Update reference',
  '✓ Valider comme référence': '✓ Save as reference',

  // ================================================================ toasts, confirmations
  'Modification annulée': 'Edit undone',
  'Modification rétablie': 'Edit redone',
  'Il faut au moins 2 morceaux analysés affichés': 'At least 2 analyzed tracks must be shown',
  'Sélectionnez un morceau': 'Select a track',
  'Retirer ce morceau de la bibliothèque CueKoda ? Le fichier audio n’est pas supprimé.':
    'Remove this track from the CueKoda library? The audio file is not deleted.',
  'Aucun nouveau fichier audio (déjà dans la bibliothèque ?)': 'No new audio files (already in the library?)',
  'Profil appliqué aux prochaines analyses — « Ré-analyser » pour l’appliquer aux morceaux existants':
    'Profile applied to the next analyses — “Re-analyze” to apply it to existing tracks',

  // ================================================================ export dialog
  Fermer: 'Close',
  'Exporter vers…': 'Export to…',
  'Choisis ton logiciel DJ : CueKoda écrit le fichier qu’il sait lire, puis te guide pour l’import.':
    'Choose your DJ software: CueKoda writes the file it can read, then guides you through the import.',
  'Logiciel DJ': 'DJ software',
  'import vérifié': 'import verified',
  'non vérifié': 'not verified',
  indisponible: 'unavailable',
  'Format documenté et XML valide, mais l’import n’a pas encore été vérifié dans le logiciel lui-même. Testez d’abord sur quelques morceaux.':
    'Documented format and valid XML, but the import has not been verified in the software itself yet. Try a few tracks first.',
  Donnée: 'Data',
  Transfert: 'Transfer',
  Détail: 'Details',
  ' Morceau affiché seulement': ' Shown track only',
  ' Ajouter des memory cues aux mêmes positions': ' Add memory cues at the same positions',
  'validées uniquement': 'approved only',
  'toutes les suggestions': 'all suggestions',
  aucune: 'none',
  'Ce qui sera transféré': 'What will be transferred',
  'Pourquoi ce n’est pas disponible': 'Why it is not available',
  'Import dans le logiciel': 'Importing into the software',
  'Sécurité : CueKoda écrit un nouveau fichier de collection ; un fichier existant est d’abord sauvegardé à côté (.backup-…). Vos fichiers audio et votre bibliothèque DJ ne sont jamais modifiés directement.':
    'Safety: CueKoda writes a new collection file; an existing file is first backed up next to it (.backup-…). Your audio files and your DJ library are never modified directly.',
  'Aucun morceau analysé à exporter': 'No analyzed track to export',
  'Aucun morceau analysé et accessible à exporter': 'No analyzed and accessible tracks to export',
  'Les fichiers disponibles ont changé. Rouvrez l’aperçu d’export.': 'Available files have changed. Reopen the export preview.',
  // adapters (src/core/export/index.ts): formats, capabilities, import steps, summary
  'Tags Serato dans les fichiers audio (GEOB « Serato Markers2 »)': 'Serato tags in the audio files (GEOB “Serato Markers2”)',
  'BPM, grille, tonalité': 'BPM, grid, key',
  'Hot cues, noms': 'Hot cues, names',
  'Couleurs, memory cues, boucles': 'Colors, memory cues, loops',
  'Sections / énergie / phrases': 'Sections / energy / phrases',
  'Pas de champ d’import': 'No import field',
  'Marqueur de tempo unique, ou un marqueur par segment quand le tempo change': 'Single tempo marker, or one marker per segment when the tempo changes',
  'Tonality (notation musicale)': 'Tonality (musical notation)',
  'Noms des cues': 'Cue names',
  'Attribut Name': 'Name attribute',
  'Couleurs des cues': 'Cue colors',
  'Red/Green/Blue — rekordbox peut ramener à sa palette': 'Red/Green/Blue — rekordbox may snap them to its palette',
  'Num -1 (option)': 'Num -1 (optional)',
  'Pas de champ d’import (analyse de phrases rekordbox propriétaire)': 'No import field (rekordbox phrase analysis is proprietary)',
  'Marqueur AutoGrid sur le premier temps (un seul tempo : les changements de tempo ne sont pas transférés)':
    'AutoGrid marker on the first downbeat (single tempo: tempo changes are not transferred)',
  'Attribut NAME': 'NAME attribute',
  'Importer collection…': 'Import collection…',
  'Lire une collection rekordbox (XML) ou Traktor (NML) : vos cues deviennent des cues verrouillés, CueKoda ne remplit que les pads libres':
    'Read a rekordbox (XML) or Traktor (NML) collection: your cues become locked cues, CueKoda only fills the free pads',
  Tous: 'All',
  'À vérifier': 'To review',
  'Fichiers introuvables': 'Missing files',
  'Morceaux affichés': 'Tracks shown',
  '✓ Vérifié': '✓ Checked',
  'Valider et passer au suivant': 'Mark checked and go to next track',
  'Le morceau a changé pendant la correction. Réessayez.': 'The track changed while you were editing. Try again.',
  'Marquer vérifié': 'Mark as checked',
  'Marquer ce morceau comme vérifié à l’oreille (il sort de la liste « À vérifier »)': 'Mark this track as checked by ear (it leaves the “To review” list)',
  'Fichier introuvable à cet emplacement': 'File not found at this location',
  'Fichier introuvable à cet emplacement (déplacé, renommé ou disque débranché)': 'File not found at this location (moved, renamed or drive disconnected)',
  'Vérifié par vous': 'Checked by you',
  'analyse en échec': 'analysis failed',
  'tempo incertain': 'uncertain tempo',
  'premier temps incertain': 'uncertain downbeat',
  'changement de tonalité': 'key change',
  'pads en double': 'duplicate pads',
  'fichier à vérifier': 'file to check',
  'Importer une collection rekordbox ou Traktor': 'Import a rekordbox or Traktor collection',
  'Fichier non reconnu : ni collection rekordbox XML, ni collection Traktor NML': 'Unrecognized file: neither a rekordbox XML nor a Traktor NML collection',
  'Importer les cues de la collection': 'Import the collection’s cues',
  'Importer et ajouter les morceaux manquants': 'Import and add the missing tracks',
  'Seulement les morceaux déjà dans CueKoda': 'Only tracks already in CueKoda',
  'Reprendre aussi le BPM et la grille du logiciel (ré-analyse avec cette grille)': 'Also take the software’s BPM and grid (re-analysis with that grid)',
  'pads fixes (A Intro, B Build 1, C Drop 1, D Break, E Build 2, F Drop 2, G Outro, H Mix Out)': 'fixed pads (A Intro, B Build 1, C Drop 1, D Break, E Build 2, F Drop 2, G Outro, H Mix Out)',
  'EDM — pads fixes': 'EDM — fixed pads',
  'Changement de tonalité': 'Key change',
  'Pads A–G → hotcues 2–8 (le 1 reste à la grille Traktor) ; pad H en cue mémorisé':
    'Pads A–G → hotcues 2–8 (hotcue 1 stays the Traktor grid marker); pad H as a stored cue',
  'Traktor colore les cues par type, pas par couleur libre': 'Traktor colors cues by type, not freely',
  'Cues sans pad uniquement : CUE_V2 HOTCUE -1 (cue mémorisé)': 'Cues without a pad only: CUE_V2 HOTCUE -1 (stored cue)',
  'CUE_V2 TYPE 5 avec LEN (boucles mémorisées)': 'CUE_V2 TYPE 5 with LEN (stored loops)',
  'Pas de champ correspondant': 'No matching field',
  'Toutes données': 'All data',
  'Serato stocke cues, grille et BPM dans les tags des fichiers audio': 'Serato stores cues, grid and BPM in the audio files’ tags',
  'rekordbox › Préférences › Avancé › Base de données › rekordbox xml : sélectionner le fichier exporté.':
    'rekordbox › Preferences › Advanced › Database › rekordbox xml: select the exported file.',
  'Afficher la vue « rekordbox xml » dans l’arborescence, puis glisser les morceaux dans la Collection.':
    'Show the “rekordbox xml” view in the tree, then drag the tracks into the Collection.',
  'Si un morceau est déjà dans la Collection, rekordbox peut demander s’il faut écraser ses informations : vérifier avant de confirmer.':
    'If a track is already in the Collection, rekordbox may ask whether to overwrite its information: check before confirming.',
  'Sauvegarder d’abord collection.nml (Traktor le fait aussi dans le dossier Backup).':
    'Back up collection.nml first (Traktor also does it in its Backup folder).',
  'Traktor › Browser › clic droit sur Track Collection › Import Another Collection : choisir le fichier exporté.':
    'Traktor › Browser › right-click Track Collection › Import Another Collection: choose the exported file.',
  'Les hot cues existants des morceaux déjà présents peuvent être remplacés : vérifier sur un morceau test.':
    'Existing hot cues of tracks already in the collection may be replaced: check on a test track.',
  'Engine DJ Desktop › Préférences › Library : activer la bibliothèque rekordbox et indiquer le fichier XML exporté par CueKoda.':
    'Engine DJ Desktop › Preferences › Library: enable the rekordbox library and point it to the XML file exported by CueKoda.',
  'Les morceaux apparaissent sous « rekordbox » dans la colonne de gauche : les importer (glisser) dans la Collection Engine DJ.':
    'The tracks appear under “rekordbox” in the left column: import them (drag) into the Engine DJ Collection.',
  'Engine DJ peut aussi lire une collection Traktor : si vous préférez, exportez pour Traktor et indiquez ce fichier NML.':
    'Engine DJ can also read a Traktor collection: if you prefer, export for Traktor and point it to that NML file.',
  'Le libellé exact des menus peut varier selon la version d’Engine DJ.': 'The exact menu labels may vary with the Engine DJ version.',
  'VirtualDJ › Paramètres › Options : renseigner le chemin du fichier rekordbox XML (option « rekordboxXml » / bibliothèques tierces).':
    'VirtualDJ › Settings › Options: enter the path of the rekordbox XML file (“rekordboxXml” option / third-party libraries).',
  'Le dossier « rekordbox » du navigateur VirtualDJ affiche alors les morceaux exportés avec leurs cues.':
    'The “rekordbox” folder of the VirtualDJ browser then shows the exported tracks with their cues.',
  'Les options et libellés diffèrent selon la version de VirtualDJ : testez sur quelques morceaux.':
    'Options and labels differ between VirtualDJ versions: try a few tracks first.',
  'djay Pro › Réglages › Bibliothèque : activer l’intégration rekordbox et choisir le fichier XML exporté par CueKoda.':
    'djay Pro › Settings › Library: enable the rekordbox integration and choose the XML file exported by CueKoda.',
  'Les morceaux apparaissent sous « rekordbox » dans la bibliothèque de djay, avec leurs cues.':
    'The tracks appear under “rekordbox” in the djay library, with their cues.',
  'Selon la version, djay peut ne reprendre qu’une partie des cues ou des couleurs : vérifiez sur un morceau test.':
    'Depending on the version, djay may import only some of the cues or colors: check on a test track.',
  'Écrire ces tags modifierait vos fichiers audio sources : CueKoda ne le fait pas.':
    'Writing these tags would modify your source audio files: CueKoda does not do that.',
  'Alternative : exporter vers rekordbox, puis convertir la bibliothèque avec un outil tiers (ex. Lexicon, Rekord Buddy) ou la fonction d’import de bibliothèques tierces de Serato si votre version la propose — non vérifié par CueKoda.':
    'Alternative: export to rekordbox, then convert the library with a third-party tool (e.g. Lexicon, Rekord Buddy) or Serato’s third-party library import if your version has it — not verified by CueKoda.',
  'Non transférés : sections, énergie, phrases, suggestions Mix In/Out': 'Not transferred: sections, energy, phrases, Mix In/Out suggestions',

  // ================================================================ duplicates dialog
  'Doublon exact': 'Exact duplicate',
  'Même enregistrement, autre encodage': 'Same recording, different encoding',
  'Versions liées': 'Related versions',
  'Aucun fichier n’est supprimé ni déplacé par CueKoda : comparez, puis décidez vous-même.':
    'CueKoda never deletes or moves any file: compare, then decide for yourself.',
  Afficher: 'Show',
  'Aucun doublon trouvé parmi les morceaux analysés.': 'No duplicates found among the analyzed tracks.',
  'Contenu identique (même empreinte SHA-256)': 'Identical content (same SHA-256 hash)',
  'Empreinte acoustique identique (≥ 90 % des mesures concordent) : le même enregistrement dans un autre fichier ou encodage':
    'Identical acoustic fingerprint (≥ 90 % of bars match): the same recording in another file or encoding',
  'Même durée, tempo, tonalité et courbe d’énergie : probablement le même enregistrement dans un autre encodage':
    'Same duration, tempo, key and energy curve: probably the same recording in another encoding',

  // ================================================================ keyboard shortcuts
  Espace: 'Space',
  'Reculer / avancer d’une mesure (Maj : un temps)': 'Back / forward one bar (Shift: one beat)',
  'Morceau précédent / suivant': 'Previous / next track',
  'Aller au hot cue A … H': 'Go to hot cue A … H',
  'Maj + 1 … 8': 'Shift + 1 … 8',
  'Poser le hot cue A … H à la position de lecture (calé sur le temps)': 'Set hot cue A … H at the playhead (snapped to the beat)',
  Suppr: 'Delete',
  'Supprimer le cue sélectionné': 'Delete the selected cue',
  'Déplacer le cue sélectionné d’un temps (Maj : une mesure)': 'Move the selected cue by one beat (Shift: one bar)',
  'Ajouter un cue à la position de lecture (premier pad libre, sinon memory cue)': 'Add a cue at the playhead (first free pad, otherwise a memory cue)',
  'Ajouter une memory cue à la position de lecture': 'Add a memory cue at the playhead',
  'Créer une boucle de 16 temps à la position de lecture': 'Create a 16-beat loop at the playhead',
  'Zoom avant / arrière / tout le morceau': 'Zoom in / out / whole track',
  'Annuler / rétablir': 'Undo / redo',
  'Raccourcis clavier': 'Keyboard shortcuts',

  // ================================================================ settings dialog
  'Avant le drop': 'Pre-drop',
  'Début de breakdown': 'Breakdown start',
  'Profil DJ': 'DJ profile',
  'Dupliquer pour personnaliser': 'Duplicate to customize',
  'Supprimer ce profil': 'Delete this profile',
  'Profil intégré (lecture seule) — dupliquez-le pour le modifier.': 'Built-in profile (read-only) — duplicate it to edit it.',
  'Nombre de hot cues': 'Number of hot cues',
  'Écart minimal (mesures)': 'Minimum spacing (bars)',
  'Durée de transition (mesures)': 'Transition length (bars)',
  'Ordre des pads': 'Pad order',
  'chronologique (A = plus tôt)': 'chronological (A = earliest)',
  'par priorité (A = plus important)': 'by priority (A = most important)',
  'Vocabulaire de structure': 'Structure vocabulary',
  'générique (sans forcer de drop)': 'generic (no forced drop)',
  'Memory cues à l’export': 'Memory cues on export',
  'Types de cues : priorité, exclusion et couleur': 'Cue types: priority, exclusion and color',
  exclure: 'exclude',
  Monter: 'Move up',
  Descendre: 'Move down',
  'Le profil s’applique aux prochaines analyses. Utilisez « Ré-analyser » pour l’appliquer aux morceaux existants (vos corrections sont conservées).':
    'The profile applies to the next analyses. Use “Re-analyze” to apply it to existing tracks (your corrections are kept).',
  Performances: 'Performance',
  'Analyse locale uniquement (CPU) : aucun fichier n’est envoyé en ligne. Les résultats sont mis en cache : un fichier inchangé n’est pas ré-analysé.':
    'Local analysis only (CPU): no file is uploaded. Results are cached: an unchanged file is not re-analyzed.',
  'Dossiers surveillés': 'Watched folders',
  '+ Ajouter un dossier': '+ Add a folder',
  'Suspendre la surveillance': 'Pause watching',
  'Analyser automatiquement les nouveaux fichiers': 'Automatically analyze new files',
  'Un fichier est pris en compte une fois sa copie terminée. Les fichiers sources ne sont jamais déplacés ni modifiés.':
    'A file is picked up once it has finished copying. Source files are never moved or modified.',
  'Apprentissage à partir de vos corrections': 'Learning from your corrections',
  'Activer (statistiques locales)': 'Enable (local statistics)',
  'Un type de cue que vous supprimez dans au moins 80 % des cas (sur 5 propositions ou plus) n’est plus proposé.':
    'A cue type you delete in at least 80 % of cases (out of 5 or more suggestions) is no longer suggested.',
  'Aucune correction enregistrée pour l’instant.': 'No corrections recorded yet.',
  'Apprentissage réinitialisé': 'Learning reset',
  'Réinitialiser l’apprentissage': 'Reset learning',
  'Mises à jour': 'Updates',
  'Vérifier au démarrage s’il existe une nouvelle version': 'Check for a new version at startup',
  'Seul GitHub est contacté (aucune donnée de votre bibliothèque n’est envoyée). Rien n’est installé sans votre clic ; le fichier téléchargé est vérifié (taille et empreinte SHA-256). macOS : l’ancienne version part à la Corbeille.':
    'Only GitHub is contacted (no data from your library is sent). Nothing is installed without your click; the downloaded file is verified (size and SHA-256 hash). macOS: the old version goes to the Trash.',
  'Vérifier maintenant': 'Check now',
  'Installer et redémarrer': 'Install and restart',
  'Langue / Language': 'Language',
  'Langue de l’interface': 'Interface language',
  Système: 'System',
  'Les noms des cues exportés vers vos logiciels DJ ne sont pas traduits : ce sont vos données.':
    'Cue names exported to your DJ software are not translated: they are your data.',
  Apparence: 'Appearance',
  Thème: 'Theme',
  Sombre: 'Dark',
  Clair: 'Light',

  // ================================================================ updates (dialogs.ts updateText, main/updater.ts)
  'Vérification…': 'Checking…',
  'CueKoda est à jour.': 'CueKoda is up to date.',
  'Build de développement : pas de comparaison possible.': 'Development build: no version comparison possible.',
  'Installation : CueKoda va redémarrer…': 'Installing: CueKoda will restart…',
  Installer: 'Install',
  'Voir ce qui change sur GitHub': 'See what’s new on GitHub',
  'Plus tard': 'Later',
  'Installez le fichier téléchargé manuellement.': 'Install the downloaded file manually.',
  'Glissez CueKoda dans Applications pour remplacer l’ancienne version.': 'Drag CueKoda into Applications to replace the old version.',
  'aucune release publique trouvée (le dépôt est-il public ?)': 'no public release found (is the repository public?)',
  'empreinte SHA-256 différente de celle publiée : fichier rejeté': 'SHA-256 hash differs from the published one: file rejected',
  'empreinte SHA-256 absente ou invalide : mise à jour rejetée': 'SHA-256 hash missing or invalid: update rejected',

  // ================================================================ mix order dialog (setorder.ts ARC_LABEL)
  'aucun point commun': 'nothing in common',
  difficile: 'tricky',
  ouverture: 'opener',
  'Ouvrir le morceau': 'Open track',
  'Suggestion d’ordre de mix': 'Suggested mix order',
  'rien n’est modifié ni exporté. Écoute les transitions, réordonne, décide.':
    'nothing is modified or exported. Listen to the transitions, reorder, decide.',
  'Arc d’énergie': 'Energy arc',
  Ouverture: 'Opener',
  'au choix de CueKoda': 'CueKoda’s choice',
  'Liste copiée': 'List copied',
  'Copier la liste': 'Copy list',
  Morceau: 'Track',
  'Transition depuis le précédent': 'Transition from the previous track',
  'Montée progressive (pic aux trois quarts, légère redescente)': 'Gradual rise (peak at three quarters, slight cool-down)',
  'Vagues (montées et respirations)': 'Waves (rises and breathers)',
  'Libre (seulement tonalité et tempo)': 'Free (key and tempo only)',

  // ================================================================ confidence (util.ts)
  'Confiance forte': 'High confidence',
  'Confiance moyenne — vérification conseillée': 'Medium confidence — checking advised',
  'Confiance faible — vérification nécessaire': 'Low confidence — needs checking',
  forte: 'high',
  moyenne: 'medium',
  faible: 'low',

  // ================================================================ sections (structure.ts SECTION_LABEL and generated labels)
  Couplet: 'Verse',
  Refrain: 'Chorus',
  'Section principale': 'Main section',
  'Section (énergie haute)': 'Section (high energy)',
  'Section calme': 'Quiet section',
  'Fin (sans kick)': 'End (no kick)',

  // ================================================================ engine reasons (structure, mix, loops)
  'Première mesure audible, calée sur le temps 1': 'First audible bar, aligned on beat 1',
  'Entrée progressive du kick après une intro sans percussion': 'Kick comes in gradually after an intro without percussion',
  'Fin de la dernière section à pleine énergie': 'End of the last full-energy section',
  'Pas de baisse d’énergie en fin de morceau : 16 dernières mesures': 'No energy drop at the end of the track: last 16 bars',
  'Le groove s’arrête définitivement': 'The groove stops for good',
  'Entrée du kick : point d’entrée pour un mix rythmique': 'Kick entry: entry point for a rhythmic mix',
  'Tenir la tension juste avant le drop': 'Hold the tension just before the drop',
  'Boucler le début du breakdown': 'Loop the start of the breakdown',

  // ================================================================ matching (KEY_TEXT, reasons, cautions)
  'même tonalité': 'same key',
  'tonalité voisine (±1 Camelot)': 'adjacent key (±1 Camelot)',
  'relative majeure / mineure': 'relative major / minor',
  'montée harmonique (+2, energy boost)': 'harmonic lift (+2, energy boost)',
  'relation diagonale (changement d’ambiance)': 'diagonal move (change of mood)',
  'tonalité incertaine': 'uncertain key',
  'énergie similaire': 'similar energy',
  'montée d’énergie': 'energy rise',
  'redescente d’énergie': 'energy step-down',
  'voix détectée dans la sortie et dans l’entrée : éviter de superposer les deux passages chantés':
    'vocals detected in both the outgoing and incoming parts: avoid layering the two sung passages',

  // ================================================================ analyzer warnings, vocal notes, errors
  'L’écoute permet de choisir entre les deux pulsations': 'Listen to choose between the two pulses',
  'Recalculer le BPM et le premier temps sans les corrections de grille': 'Recalculate BPM and the first downbeat automatically',
  'BPM et grille automatiques': 'Automatic BPM and beatgrid',
  'Grille rythmique peu fiable — à vérifier': 'Unreliable beatgrid — please check',
  'Premier temps (downbeat) incertain — vérifie la grille': 'Uncertain first downbeat — check the grid',
  'Structure peu marquée — peu de hot cues proposés': 'Weak structure — few hot cues suggested',
  'Peu de contenu tonal mesurable : détection vocale peu informative': 'Little measurable tonal content: vocal detection is not very informative',
  'Aucune voix détectée (une voix très traitée ou masquée peut échapper à la détection)':
    'No vocals detected (heavily processed or buried vocals can escape detection)',
  'Heuristique seule': 'Heuristic only',
  'modèle vocal absent': 'vocal model missing',
  'Les canaux s’annulent en mono : analyse sur le canal gauche.': 'The channels cancel in mono. Analysis uses the left channel.',
  'Aucun signal audio exploitable après conversion mono.': 'No usable audio signal after conversion to mono.',
  'audio trop court ou illisible (< 5 s)': 'audio too short or unreadable (< 5 s)',

  // ================================================================ main process (export, watch folders)
  'Dossier introuvable': 'Folder not found',
  'Exporter les références': 'Export references',
  'Choisir des fichiers audio': 'Choose audio files',
  'Choisir un dossier de musique': 'Choose a music folder',
  'Dossier à surveiller': 'Folder to watch',

  // ================================================================ comment tags, set export
  'Exporter le set vers…': 'Export the set to…',
  'Nom de la playlist': 'Playlist name',
  'Pour trier et filtrer par énergie dans ton logiciel DJ. Remplace le commentaire du morceau si tu acceptes d’écraser ses informations à l’import.':
    'To sort and filter by energy in your DJ software. Replaces the track’s comment if you accept to overwrite its information on import.',
  'Énergie, clé et voix dans le commentaire': 'Energy, key and vocals in the comment',
  'Exporter ces morceaux, dans cet ordre, comme une playlist pour ton logiciel DJ': 'Export these tracks, in this order, as a playlist for your DJ software',
  'Exporter ce set…': 'Export this set…',
  'Commentaire « E8 · 1d · Vocal »': 'Comment “E8 · 1d · Vocal”',
  'Commentaire « E8 · 8B · Vocal »': 'Comment “E8 · 8B · Vocal”',
  'Attribut Comments (option)': 'Comments attribute (option)',
  'NODE Type 1, morceaux dans l’ordre': 'NODE Type 1, tracks in order',
  'NODE PLAYLIST, morceaux dans l’ordre': 'NODE PLAYLIST, tracks in order',
};

export const EN_PATTERNS: [RegExp, Rep][] = [
  [/^Utiliser ([\d.,]+) BPM$/, (_, bpm) => `Use ${bpm} BPM`],
  [/^Tempo ([\d.]+) remplacé par ([\d.]+) \(pulsation plus rapide mieux alignée\)$/, (_, a, b) => `Tempo ${a} replaced by ${b} (faster pulse better aligned)`],
  [/^Tempo ([\d.]+) remplacé par ([\d.]+) \(motif rythmique récurrent\)$/, (_, a, b) => `Tempo ${a} replaced by ${b} (recurring rhythmic pattern)`],
  [/^⚠ Fichiers introuvables écartés \((\d+)\) : (.+)$/, (_, n, tracks) => `⚠ Missing files excluded (${n}): ${tracks}`],
  [/^⚠ Morceaux sans analyse écartés : (\d+)$/, (_, n) => `⚠ Unanalyzed tracks excluded: ${n}`],
  [/^⚠ Tempo variable : Traktor ne reçoit qu’un tempo pour (\d+) morceau\(x\)$/, (_, n) => `⚠ Variable tempo: Traktor receives a single tempo for ${n} track(s)`],
  // set export and comment tags (export dialog, src/core/export/index.ts)
  [/^\s*Le set \((\d+) morceaux, dans l’ordre\) en playlist\s*:\s*$/, (_, n) => ` The set (${pl(n, 'track')}, in order) as playlist: `],
  [/^Commentaire de chaque morceau : énergie, clé et voix \(ex\. « (.*) »\)$/, (_, ex) => `Comment of each track: energy, key and vocals (e.g. “${ex}”)`],
  [/^Playlist « (.*) » : (\d+) morceau\(x\) dans l’ordre du set$/, (_, name, n) => `Playlist “${name}”: ${pl(n, 'track')} in set order`],
  // ---------------------------------------------------------------- compound texts that need care first
  // Mix In / Mix Out reasons + vocal suffix (mix.ts withVocals)
  [/^(.+?)(, aucune voix détectée|, voix possible \(indice faible\)|, voix nette — éviter de superposer avec un passage chanté)$/,
    (_, head, suffix) => tl(head) + MIX_VOCALS[suffix]],
  // watch-folder toast: "⚠ message (folder)" (renderer.ts onWatch)
  [/^(⚠ )?(Nouveau fichier : .+?|Dossier introuvable|Surveillance interrompue : .+?|Impossible de surveiller ce dossier : .+?) \((.+)\)$/s,
    (_, warn, msg, folder) => `${warn ?? ''}${tl(msg)} (${folder})`],
  // correction toast: "<label> — ré-analyse en cours …"
  [/^(.+) — ré-analyse en cours \(vos cues sont conservés\)$/, (_, l) => `${tl(l)} — re-analyzing (your cues are kept)`],
  // compatible tracks: "reasons · … (⚠ cautions)"
  [/^(.*) \(⚠ (.+)\)$/s, (_, head, c) => `${tl(head)} (⚠ ${c.split(', ').map(tl).join(', ')})`],
  [/^(\s*)⚠ (.+)$/s, (_, sp, c) => `${sp}⚠ ${c.split(', ').map(tl).join(', ')}`],

  // ---------------------------------------------------------------- library, queue, progress (renderer.ts)
  [/^(\d+) \/ (\d+) morceaux?$/, (_, a, b) => `${a} / ${pl(b, 'track')}`],
  [/^En attente · (\d+)ᵉ dans la file$/, (_, n) => `Queued · ${ordinal(n)} in line`],
  [/^(Ré-analyse|Analyse) (\d+) % — (.+?)(?: · étape (\d+)\/(\d+))?$/,
    (_, kind, p, stage, i, n) => `${kind === 'Analyse' ? 'Analyzing' : 'Re-analyzing'} ${p}% — ${STAGE[stage] ?? tl(stage)}${i ? ` · step ${i}/${n}` : ''}`],
  [/^Analyse (\d+) % \((.*)\)$/, (_, p, stage) => `Analyzing ${p}% (${STAGE[stage] ?? stage})`],
  [/^étape (\d+)\/(\d+)$/, 'step $1/$2'],
  [/^Analyse (\d+)\/(\d+)$/, 'Analyzing $1/$2'],
  [/^(\d+) en cours$/, '$1 running'],
  [/^En pause · (\d+) en attente$/, 'Paused · $1 queued'],
  [/^Erreur : ([\s\S]*)$/, (_, e) => `Error: ${tl(e)}`],
  [/^À vérifier : (.+) — marquer vérifié$/, (_, r) => `To review: ${r.split(', ').map(tl).join(', ')} — mark as checked`],
  [/^À vérifier : ([\s\S]*)$/, (_, w) => `To check: ${w.split(' ; ').map(tl).join('; ')}`],
  [/^Énergie estimée (.+)\/10$/, 'Estimated energy $1/10'],
  [/^↻ Relancer (\d+) échecs?$/, '↻ Retry $1 failed'],
  [/^Analyse terminée : (.+) en (\d+) s$/, (_, parts, s) => `Analysis done: ${parts.split(', ').map(tl).join(', ')} in ${s} s`],
  [/^(\d+) analysé\(s\)$/, '$1 analyzed'],
  [/^(\d+) depuis le cache$/, '$1 from cache'],
  [/^(\d+) erreur\(s\)$/, (_, n) => pl(n, 'error')],
  [/^(\d+) annulé\(s\)$/, '$1 cancelled'],
  [/^(\d+) fichier\(s\) ajouté\(s\) à la file d’analyse$/, (_, n) => `${pl(n, 'file')} added to the analysis queue`],
  [/^Ré-analyser (\d+) morceaux avec le profil actuel \? Vos cues modifiés ou verrouillés sont conservés\.$/,
    'Re-analyze $1 tracks with the current profile? Your edited or locked cues are kept.'],

  // ---------------------------------------------------------------- detail header, corrections
  [/^(.+) \(alternative plausible\)$/, '$1 (plausible alternative)'],
  [/^(.+) \(ambiguë\)$/, '$1 (ambiguous)'],
  [/^BPM fixé à (\S+)$/, 'BPM set to $1'],
  [/^Clé fixée à (\S+)$/, 'Key set to $1'],

  // ---------------------------------------------------------------- hot cues, memory cues, loops
  [/^(.+) ajouté à (\S+) — (.+)$/, (_, k, t, where) => `${tl(k)} added at ${t} — ${tl(where)}`],
  [/^Déjà un cue à (\S+) : (.+) \((pad [A-H]|memory cue)\)$/, 'There is already a cue at $1: $2 ($3)'],
  [/^(.+) est maintenant au même endroit que (.+) : un des deux pads est inutile$/, '$1 is now at the same position as $2: one of the two pads is redundant'],
  [/^⚠ (\d+) cue\(s\) au même endroit qu’un autre \((.+)\) : un pad gaspillé chacun$/, (_, n, w) => `⚠ ${pl(n, 'cue')} at the same position as another (${w}): one wasted pad each`],
  [/^Type du cue ([A-H])$/, 'Pad $1 cue type'],
  [/^Poser le pad ([A-H]) à la position de lecture$/, 'Set pad $1 at the playhead'],
  [/^Couleur du pad ([A-H])$/, 'Pad $1 color'],
  [/^Nom du pad ([A-H])$/, 'Pad $1 name'],
  [/^Raccourci : (.+)$/, 'Shortcut: $1'],
  [/^mes\. (\d+)(\s*)$/, 'bar $1$2'],
  [/^Placer « (.+) » sur un pad$/, 'Put “$1” on a pad'],
  [/^([A-H]) \(remplace (.+)\)$/, '$1 (replaces $2)'],
  [/^([A-H]) \(libre\)$/, '$1 (free)'],
  [/^(\s*)(\d+) temps \((\d+(?:[.,]\d+)?) mes\.\)$/, (_, sp, b, m) => `${sp}${pl(b, 'beat')} (${pl(m, 'bar')})`],
  [/^(\s*)(\d+) temps$/, (_, sp, b) => sp + pl(b, 'beat')],
  [/^(\s*)(\d+) mes\.$/, (_, sp, b) => sp + pl(b, 'bar')],

  // ---------------------------------------------------------------- structure tab, section labels
  [/^Phrases de (\d+) mesures \(régularité (\d+) %\) — affichées en traits pleins sur la waveform\.$/,
    '$1-bar phrases ($2% regular) — shown as solid lines on the waveform.'],
  [/^(Couplet|Refrain) (\d+)$/, (_, l, n) => `${l === 'Couplet' ? 'Verse' : 'Chorus'} ${n}`],

  // ---------------------------------------------------------------- playback, transition preview (renderer.ts, transition.ts)
  [/^Lecture impossible : (.+?)\.( Vérifiez Réglages Système › Confidentialité et sécurité › Fichiers et dossiers › CueKoda, puis relancez l’app\.)? L’analyse et l’export restent valides\.$/s,
    (_, err, mac) => `Playback failed: ${tl(err)}.${mac ? ' Check System Settings › Privacy & Security › Files and Folders › CueKoda, then restart the app.' : ''} The analysis and the export remain valid.`],
  [/^Lecture de « (.+) » impossible : ([\s\S]+)$/, (_, title, help) => `Cannot play “${title}”: ${tl(help)}`],
  [/^Écart de tempo trop grand \((.+) → (.+) BPM\) : il faudrait (.+) %$/, 'Tempo gap too large ($1 → $2 BPM): it would take $3%'],
  [/^B est noté en (demi|double)-tempo \((.+) BPM\)$/, (_, k, b) => `B is notated in ${k === 'demi' ? 'half' : 'double'} time (${b} BPM)`],
  [/^B joué à (.+) % \((.+) → (.+) BPM\), tonalité conservée$/, 'B played at $1% ($2 → $3 BPM), key preserved'],
  [/^A sort à (\S+) \((.+)\), B entre à (\S+) \((.+)\)$/, (_, a, wa, b, wb) => `A leaves at ${a} (${why(wa)}), B enters at ${b} (${why(wb)})`],
  [/^fondu raccourci à (\d+) mesures \(fin de A\)$/, (_, n) => `crossfade shortened to ${pl(n, 'bar')} (end of A)`],
  [/^fondu (\d+) mesures$/, (_, n) => `${n}-bar crossfade`],

  // ---------------------------------------------------------------- info tab
  [/^aucune voix détectée(?: — ([\s\S]+))? \(heuristique non validée : des voix peuvent être manquées\)$/,
    (_, note) => `no vocals detected${note ? ` — ${tl(note)}` : ''} (unvalidated heuristic: vocals may be missed)`],
  [/^(\d+) passage\(s\), (\d+) % du morceau, (\d+) net\(s\) : ([\s\S]*) \(heuristique non validée\)$/,
    (_, n, p, k, parts) => `${pl(n, 'part')}, ${p}% of the track, ${k} clear: ${parts.replace(/ \(faible\)/g, ' (faint)')} (unvalidated heuristic)`],
  [/^(.+) Mo$/, '$1 MB'],
  [/^(.+) BPM \(Essentia brut (.+)\)$/, '$1 BPM (Essentia raw $2)'],
  [/^(\d+) % des attaques retenues alignées à ±12 ms$/, '$1% of selected attacks aligned within ±12 ms'],
  [/^facteur de crête (.+) dB$/, 'crest factor $1 dB'],
  [/^(.+)\/10 \(algorithmique, comparable dans cette bibliothèque\)$/, '$1/10 (algorithmic, comparable within this library)'],
  [/^Énergie ressentie : (\d+)\/10$/, 'Perceived energy: $1/10'],
  [/^✓ Référence enregistrée le (.+)$/, '✓ Reference saved on $1'],
  [/^(\d+) références? au total$/, (_, n) => `${pl(n, 'reference')} in total`],
  [/^Références exportées : (.+)$/s, 'References exported: $1'],

  // ---------------------------------------------------------------- export dialog, adapters, summary
  [/^via (.+) XML · non vérifié$/, 'via $1 XML · not verified'],
  [/^Format : (.+)$/, (_, f) => `Format: ${tl(f)}`],
  [/^rekordbox XML \(lu par (.+)\)$/, 'rekordbox XML (read by $1)'],
  [/^(.+) sait lire une collection rekordbox XML, mais cet import n’a pas encore été vérifié avec CueKoda\. Testez d’abord sur quelques morceaux\.$/,
    '$1 can read a rekordbox XML collection, but this import has not been verified with CueKoda yet. Try a few tracks first.'],
  [/^Écrits comme pour rekordbox ; repris selon ce que (.+) lit de ce fichier$/, 'Written as for rekordbox; imported depending on what $1 reads from this file'],
  [/^POSITION_MARK 0–7 ; reprise à vérifier dans (.+)$/, 'POSITION_MARK 0–7; check the import in $1'],
  [/^Selon la version de (.+)$/, 'Depends on the $1 version'],
  [/^(\s*)Tous les morceaux analysés \((\d+)\)$/, '$1All analyzed tracks ($2)'],
  [/^Exporté : (.+?)(?: \(ancien fichier sauvegardé : (.+)\))?$/s, (_, f, b) => `Exported: ${f}${b ? ` (previous file backed up: ${b})` : ''}`],
  [/^Erreur d’export : ([\s\S]*)$/, (_, e) => `Export error: ${tl(e)}`],
  [/^Exporter (\d+) morceau\(x\)…$/, (_, n) => `Export ${pl(n, 'track')}…`],
  [/^Exporter pour (.+)$/, 'Export for $1'],
  [/^(.+) : export non disponible$/, '$1: export not available'],
  [/^(\d+) morceau\(x\) : BPM et grille \(premier temps\) pour chacun$/, (_, n) => `${pl(n, 'track')}: BPM and grid (first downbeat) for each`],
  [/^(\d+) tonalité\(s\)$/, (_, n) => pl(n, 'key')],
  [/^(\d+) hot cue\(s\) avec noms et couleurs$/, (_, n) => `${pl(n, 'hot cue')} with names and colors`],
  [/^(\d+) hot cue\(s\) avec noms \(couleurs non transférables\)$/, (_, n) => `${pl(n, 'hot cue')} with names (colors cannot be transferred)`],
  [/^(\d+) memory cue\(s\) aux positions des hot cues$/, (_, n) => `${pl(n, 'memory cue')} at the hot cue positions`],
  [/^(\d+) memory cue\(s\) sans pad( \(cues mémorisés Traktor\))?$/, (_, n, t) => `${pl(n, 'memory cue')} without a pad${t ? ' (Traktor stored cues)' : ''}`],
  [/^(\d+) cue\(s\) au premier temps déjà couvert\(s\) par AutoGrid$/, (_, n) => `${pl(n, 'cue')} at the first downbeat already covered by AutoGrid`],
  [/^Fichier au format rekordbox XML, à indiquer dans (.+)$/, 'File in rekordbox XML format, to select in $1'],
  [/^(\d+) boucle\(s\) \((.+)\)$/, (_, n, m) => `${pl(n, 'loop')} (${tl(m)})`],

  // ---------------------------------------------------------------- duplicates
  [/^(\d+) mesures musicalement identiques \(décalage de (\d+) mesures\) : versions liées probables \(edit, extended, remix proche\) — pas des doublons à supprimer$/,
    (_, n, o) => `${pl(n, 'musically identical bar')} (offset of ${pl(o, 'bar')}): probably related versions (edit, extended, close remix) — not duplicates to delete`],
  [/^Même titre de base « (.+) » : versions liées \(remix, edit, extended…\) — pas des doublons à supprimer$/,
    'Same base title “$1”: related versions (remix, edit, extended…) — not duplicates to delete'],

  // ---------------------------------------------------------------- settings, learning, updates
  [/^(.+) \(perso\)$/, (_, n) => `${tl(n)} (custom)`],
  [/^Couleur (.+)$/, '$1 color'],
  [/^Monter (.+)$/, 'Move $1 up'],
  [/^Descendre (.+)$/, 'Move $1 down'],
  [/^Analyses en parallèle : (\d+) \/ (\d+) cœurs$/, 'Parallel analyses: $1 / $2 cores'],
  [/^(\S+) : proposé (\d+)×, supprimé (\d+) %(?: · déplacé (\d+)× \(moy\. (.+) temps\))?$/,
    (_, k, n, d, m, avg) => `${k}: suggested ${n}×, deleted ${d}%${m ? ` · moved ${m}× (avg. ${avg} beats)` : ''}`],
  [/^Version (\S+) \(build de développement : pas de mise à jour automatique\)$/, 'Version $1 (development build: no automatic updates)'],
  [/^Nouvelle version disponible : (.+) \(build (.+)\)\.$/, 'New version available: $1 (build $2).'],
  [/^Téléchargement (\d+) %…$/, 'Downloading $1%…'],
  [/^Mise à jour (\S+) \(build (.+)\)$/, 'Update $1 (build $2)'],
  [/^Vérification des mises à jour impossible : ([\s\S]*)$/, (_, e) => `Could not check for updates: ${tl(e)}`],
  [/^Mise à jour impossible : ([\s\S]*)$/, (_, e) => `Update failed: ${tl(e)}`],
  [/^GitHub a répondu (\d+)$/, 'GitHub responded $1'],
  [/^téléchargement refusé \((.+)\)$/, 'download refused ($1)'],
  [/^fichier incomplet \((\d+) \/ (\d+) octets\)$/, 'incomplete file ($1 / $2 bytes)'],

  // ---------------------------------------------------------------- mix order dialog
  [/^Écouter la transition (.+) → (.+)$/, 'Listen to the transition $1 → $2'],
  [/^Une piste de départ pour (\d+) morceaux? \(ceux affichés dans la bibliothèque\), pas une playlist imposée : $/,
    (_, n) => `A starting point for ${pl(n, 'track')} (those shown in the library), not a fixed playlist: `],
  [/^Note moyenne des transitions : (\d+)\/100$/, 'Average transition score: $1/100'],

  // ---------------------------------------------------------------- engine reasons (structure.ts)
  [/^Le groove revient après (\d+) mesures plus calmes \((.+) dB\)$/, (_, n, db) => `The groove comes back after ${n} quieter ${Number(n) === 1 ? 'bar' : 'bars'} (${db} dB)`],
  [/^Entrée de la basse \/ du kick \((.+) dB dans les graves\)$/, 'Bass / kick comes in ($1 dB in the lows)'],
  [/^Énergie au niveau maximal du morceau pendant (\d+) mesures \((.+) pts d’énergie\)$/,
    (_, n, p) => `Energy at the track’s peak level for ${pl(n, 'bar')} (${p} energy pts)`],
  [/^Plus forte hausse de volume du morceau \((.+) dB\)$/, 'Biggest volume jump in the track ($1 dB)'],
  [/^Montée continue de la brillance sur (\d+) mesures avant le drop$/, (_, n) => `Brightness builds steadily over ${pl(n, 'bar')} before the drop`],
  [/^Énergie sous le niveau des drops pendant (\d+) mesures$/, (_, n) => `Energy below drop level for ${pl(n, 'bar')}`],
  [/^Le groove s’interrompt pendant (\d+) mesures$/, (_, n) => `The groove stops for ${pl(n, 'bar')}`],
  [/^Pas de baisse d’énergie en fin de morceau : changement de section (\d+) mesures après le dernier drop$/,
    (_, n) => `No energy drop at the end of the track: section change ${pl(n, 'bar')} after the last drop`],

  // ---------------------------------------------------------------- cue / mix / loop reasons (cues.ts, mix.ts, loops.ts)
  [/^Entrée de voix détectée \((\d+) mesures(, indice faible)?\) — détection heuristique non validée$/,
    (_, n, weak) => `Vocal entry detected (${pl(n, 'bar')}${weak ? ', weak evidence' : ''}) — unvalidated heuristic detection`],
  [/^Début de l’intro — (\d+) mesures (rythmiques|sans kick régulier) avant le premier changement$/,
    (_, n, k) => `Start of the intro — ${pl(n, k === 'rythmiques' ? 'rhythmic bar' : 'bar')}${k === 'rythmiques' ? '' : ' without a steady kick'} before the first change`],
  [/^Entrée plus tardive : (\d+) mesures avant le premier changement, début de phrase$/,
    (_, n) => `Later entry: ${pl(n, 'bar')} before the first change, start of a phrase`],
  [/^Début de l’outro — (\d+) mesures, (kick présent|peu de kick), (énergie décroissante|énergie maintenue)$/,
    (_, n, k, e) => `Start of the outro — ${pl(n, 'bar')}, ${tl(k)}, ${tl(e)}`],
  [/^(\d+) mesures avant la fin(, début de phrase)?, (kick présent|peu de kick), (énergie décroissante|énergie maintenue)$/,
    (_, n, ph, k, e) => `${pl(n, 'bar')} before the end${ph ? ', start of a phrase' : ''}, ${tl(k)}, ${tl(e)}`],
  [/^Fin instrumentale : (\d+) mesures sans voix détectée après le dernier passage chanté$/,
    (_, n) => `Instrumental ending: ${pl(n, 'bar')} without detected vocals after the last sung passage`],
  [/^kick présent$/, 'kick present'],
  [/^peu de kick$/, 'little kick'],
  [/^énergie décroissante$/, 'energy decreasing'],
  [/^énergie maintenue$/, 'energy sustained'],
  [/^Prolonger l’intro rythmique \((\d+) temps, kick sur (\d+) % des mesures\)$/,
    (_, b, p) => `Extend the rhythmic intro (${pl(b, 'beat')}, kick on ${p}% of bars)`],
  [/^Prolonger l’outro rythmique \((\d+) temps\)$/, (_, b) => `Extend the rhythmic outro (${pl(b, 'beat')})`],

  // ---------------------------------------------------------------- matching reasons and cautions
  [/^([^·]+) \((\d{1,2}[AB]) → (\d{1,2}[AB])\)$/, (_, k, a, b) => `${tl(k)} (${a} → ${b})`],
  [/^BPM proche(?: en (double|demi)-tempo)? \((.+), (.+) %\)$/,
    (_, h, bpm, p) => `close BPM${h ? (h === 'demi' ? ' at half tempo' : ' at double tempo') : ''} (${bpm}, ${p}%)`],
  [/^BPM ajustable(?: en (double|demi)-tempo)? \((.+) % de pitch\)$/,
    (_, h, p) => `adjustable BPM${h ? (h === 'demi' ? ' at half tempo' : ' at double tempo') : ''} (${p}% pitch)`],
  [/^écart de tempo (.+) %$/, 'tempo gap $1%'],
  [/^fenêtres de transition longues \(outro (\d+) \/ intro (\d+) mesures\)$/, 'long transition windows (outro $1 / intro $2 bars)'],
  [/^fenêtre de transition de (\d+) mesures$/, (_, n) => `${n}-bar transition window`],

  // ---------------------------------------------------------------- analyzer warnings, notes, errors
  [/^Tempo Essentia (.+) remplacé par (.+) \(meilleur alignement de grille\)$/, 'Essentia tempo $1 replaced by $2 (better grid alignment)'],
  [/^(\d+) morceau\(x\) trouvé\(s\) sur cet ordinateur, dont (\d+) pas encore dans CueKoda \((\d+) introuvable\(s\)\)\.\n([\s\S]*)$/,
    (_, n, o, m) => `${pl(n, 'track')} found on this computer, ${o} not in CueKoda yet (${m} not found).\nTheir cues become locked cues on their pads; CueKoda only fills the free pads. The collection file is not modified.`],
  [/^Importé de (rekordbox|Traktor) \(cue du DJ, verrouillé\)$/, 'Imported from $1 (DJ’s cue, locked)'],
  [/^Importée de (rekordbox|Traktor)$/, 'Imported from $1'],
  [/^Fichier retrouvé : (.+) — vos corrections le suivent$/, 'File found again: $1 — your corrections follow it'],
  [/^Import impossible : (.*)$/s, (_, e) => `Import failed: ${tl(e)}`],
  [/^Collection (rekordbox|traktor) : (\d+) morceau\(x\), (\d+) cue\(s\) importé\(s\) et verrouillé\(s\)(?:, (\d+) ajouté\(s\) à l’analyse)?(?: · (\d+) introuvable\(s\) sur cet ordinateur)?$/,
    (_, src, n, c, a, m) => `${src} collection: ${pl(n, 'track')}, ${pl(c, 'cue')} imported and locked${a ? `, ${a} added to the analysis` : ''}${m ? ` · ${m} not found on this computer` : ''}`],
  [/^Tempo variable \((.+) BPM\) : grille fixe approximative$/, 'Variable tempo ($1 BPM): fixed grid is approximate'],
  [/^Fichier endommagé : décodage interrompu \((.+)\) — analyse partielle$/s, 'Damaged file: decoding stopped ($1) — partial analysis'],
  [/^MP3 sans en-tête LAME : délai d’encodage inconnu, cues possiblement décalés d’environ 25 ms selon le logiciel DJ$/,
    'MP3 without a LAME header: unknown encoder delay, cues may be ~25 ms off depending on the DJ software'],
  [/^Fichier probablement tronqué : (\d+) s décodées sur (\d+) s annoncées — analyse partielle$/, 'File probably truncated: $1 s decoded out of $2 s announced — partial analysis'],
  [/^BPM corrigé de (.+) à (.+)$/, 'BPM corrected from $1 to $2'],
  [/^Changements de tempo : (.+) \(marqueurs exportés vers rekordbox\)$/,
    (_, list) => `Tempo changes: ${list.replace(/ BPM à /g, ' BPM at ')} (markers exported to rekordbox)`],
  [/^Changement de tonalité probable : (.+) \(tonalité principale (\w+)\)$/, (_, list, k) => `Probable key change: ${list.replace(/ de /g, ' from ').replace(/ à /g, ' to ')} (main key ${k})`],
  [/^Tonalité ambiguë(?: \(aussi plausible : (.+)\))?$/, (_, alts) => `Ambiguous key${alts ? ` (also plausible: ${alts})` : ''}`],
  [/^Heuristique seule \(([\s\S]+)\)$/, (_, e) => `Heuristic only (${tl(e)})`],
  [/^modèle vocal indisponible : ([\s\S]*)$/, 'vocal model unavailable: $1'],
  [/^inférence vocale échouée : ([\s\S]*)$/, 'vocal inference failed: $1'],
  [/^fichier de plus de (.+) min \(mix DJ \?\) — ignoré$/, 'file longer than $1 min (DJ mix?) — skipped'],
  [/^fichier illisible ou corrompu \(ffmpeg (.*?)\) : ([\s\S]*)$/, 'unreadable or corrupt file (ffmpeg $1): $2'],
  [/^analyse interrompue : ([\s\S]*)$/, 'analysis interrupted: $1'],
  [/^le processus d’analyse s’est arrêté \(code (.*)\)$/, 'the analysis process stopped (code $1)'],

  // ---------------------------------------------------------------- watch folders (main.ts, watch.ts) — toast "⚠ message (folder)"
  [/^Nouveau fichier : (.+)$/, 'New file: $1'],
  [/^Surveillance interrompue : ([\s\S]*)$/, 'Watching stopped: $1'],
  [/^Impossible de surveiller ce dossier : ([\s\S]*)$/, 'Cannot watch this folder: $1'],
];
