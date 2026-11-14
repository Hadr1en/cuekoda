# CueKoda — audit du dépôt et plan de développement

*Audit réalisé le 2026-11-14 sur la version 0.1 (≈3 100 lignes TypeScript). Pas de dépôt git : un instantané
des sources v0.1 a été archivé avant les modifications.*

## 1. Stack existante (conservée)

| Couche | Choix | Verdict |
|---|---|---|
| App | Electron 33 (Chromium 130) + TypeScript, bundlé par esbuild | conservé (passé à Electron 45 le 2026-11-14, `npm audit`) |
| Décodage | ffmpeg-static (tous formats DJ courants) | conservé, réutilisé aussi pour LUFS / true peak (filtre `ebur128`) |
| Analyse | Essentia.js (tempo grossier, tonalité) + DSP maison (FFT, bandes, grille, structure) | conservé |
| Tags | music-metadata | conservé (format, canaux, codec en plus) |
| Parallélisme | pool de `worker_threads` dans le main | conservé, enrichi (pause, annulation, progression) |
| UI | HTML/CSS/TS sans framework, guidé par modern-web-guidance | conservé, étendu |
| Tests | test synthétique de bout en bout (`src/test/run.ts`) | conservé + tests unitaires `node:test` |

Aucune nouvelle dépendance n'est nécessaire pour les phases 1 et 2.

## 2. Inventaire v0.1 (avant ce chantier)

| Fonctionnalité | État v0.1 |
|---|---|
| Import fichiers / dossiers, glisser-déposer | Opérationnel |
| BPM (Essentia + validation par grille, repli ×2/÷2 dans une plage) | Opérationnel, testé synthétique + 9 vrais morceaux |
| Beatgrid (phase à ~2 ms, downbeat par vote, repli si incertain) | Opérationnel ; pas de correction manuelle, pas d'analyse de stabilité |
| Tonalité + Camelot + Open Key | Opérationnel ; confiance brute, pas d'alternatives, pas de correction |
| Métadonnées | Partiel : tags, durée, débit ; pas de LUFS / true peak / canaux |
| Structure | Partiel : repères EDM (intro, build, drop, breakdown, outro) ; pas de timeline de sections |
| Phrases | Partiel : phase de phrase 8 mesures interne, non exposée |
| Énergie | Absent |
| Hot cues | Partiel : 8 pads à rôle fixe, couleurs fixes, sans confiance |
| Édition manuelle | Partiel : ±temps/mesure, suppression, ajout ; pas de renommage, couleur, verrou, annulation |
| Boucles | Absent |
| Analyse par lots | Partiel : pool parallèle + barre globale ; pas de pause, annulation, relance, cache, persistance |
| Export rekordbox XML / Traktor NML | Implémenté, XML valide, **non validé dans les logiciels** ; pas de boucles |
| Serato | Absent |
| Voix, Mix In/Out, profils, dossiers surveillés, matching, doublons, stems, apprentissage | Absent |

## 3. Architecture cible

```
src/core/            moteur pur (Node, testable sans Electron)
  decode.ts          ffmpeg → PCM + loudness EBU R128 (même passe)
  dsp.ts rhythm.ts   bandes, grille, tempo, stabilité
  key.ts             tonalité, alternatives, ambiguïté
  energy.ts          courbe d'énergie, score 1-10, événements
  structure.ts       repères, phrases, timeline de sections
  cues.ts            Smart Cue Engine (candidats → sélection par profil → pads)
  loops.ts           Smart Loops
  mix.ts             suggestions Mix In / Mix Out justifiées
  profiles.ts        profils DJ extensibles (données, pas de code par genre)
  merge.ts           fusion ré-analyse ↔ corrections utilisateur (verrous)
  matching.ts        compatibilité entre morceaux
  duplicates.ts      doublons exacts / encodages / versions liées
  learning.ts        statistiques de corrections → ajustement des suggestions
  export/            adaptateurs : rekordbox, traktor, serato (statut documenté)
src/main/            Electron : store (bibliothèque persistante), cache, file d'analyse, watch folders
src/renderer/        UI : bibliothèque, vue d'analyse, éditeur, dialogues
src/test/            synthétique e2e + unitaires + régression sur échantillons
```

Principes : l'analyse produit des **suggestions** (`origin: 'auto'`) ; toute action de l'utilisateur crée une
donnée `origin: 'user'` ou verrouillée, jamais écrasée par une ré-analyse. Les métadonnées (tags, format, LUFS)
sont stockées séparément des résultats algorithmiques. Les fichiers audio ne sont jamais modifiés.

## 4. Plan priorisé

**Phase 1 — Core** : métadonnées + LUFS ; confiance / stabilité tempo ; alternatives de tonalité ; énergie ;
timeline de sections + phrases ; Smart Cue Engine (confiance, couleurs configurables, noms) ; Smart Loops ;
édition complète (renommer, couleur, verrou, glisser sur la waveform, annuler/rétablir, correction BPM / grille /
tonalité, ré-analyse qui préserve les corrections) ; file d'analyse (pause, reprise, annulation, relance, limite
CPU, cache, persistance, résumé) ; vue d'analyse (waveform zoomable, grille, sections, énergie, boucles) ;
export rekordbox avec boucles et aperçu de ce qui est transféré.

**Phase 2 — Advanced** : Mix In / Mix Out ; profils DJ ; dossiers surveillés ; track matching ; doublons ;
adaptateurs Traktor (boucles) et Serato (statut documenté).

**Phase 3 — Personnalisation** : apprentissage simple à partir des corrections ; détection vocale
(v0.3.1 : modèle local Essentia MusiCNN + heuristique spectrale, expérimentale — voir ALGORITHMES.md) ;
stems (non disponibles).

Validation à chaque étape : `npm run typecheck`, `npm test` (synthétique, tolérance zéro mesure),
`npm run test:unit`, ré-analyse des échantillons réels et comparaison à la référence de non-régression.

## 5. État après les chantiers v0.2, v0.3.x (détection vocale) et v0.3.2 (2026-11-14)

Légende — **T** : implémentée et testée automatiquement · **V** : implémentée, nécessite une validation
(manuelle ou sur données annotées) · **P** : partiellement disponible · **N** : non disponible.

| § | Fonctionnalité | État | Preuve / remarque |
|---|---|---|---|
| 3.1 | BPM, demi/double tempo, confiance, alternatives, correction | **T** | e2e synthétique (128, 174 BPM), overrides testés |
| 3.1 | Tempo variable | **T** / **V** | détecté sur enchaînement synthétique 124 → 128 BPM ; 0 faux positif sur 13 morceaux réels ; aucun morceau réel à tempo variable testé |
| 3.2 | Beatgrid, downbeat, correction (temps 1, ±10 ms, ±1 temps) | **T** / **V** | phase 2 ms ; overrides testés ; v0.3.3 : vote des entrées kick / basse, temps 1 conforme aux corrections du DJ sur 3 morceaux réels (Garrix, Alesso, Ingrosso) |
| 3.2 | Changements de tempo (multi-marqueurs) | **T** / **P** | marqueurs exacts sur synthétique (bascule à 4 ms, temps 1), exportés vers rekordbox ; Traktor : un seul tempo ; cues calculés sur la grille moyenne |
| 3.3 | Tonalité, Camelot, Open Key, confiance, correction | **T** | e2e + unitaires |
| 3.3 | Ambiguïté + analyse complémentaire | **V** | logique présente, pas de morceau ambigu de référence |
| 3.4 | Métadonnées, LUFS, LRA, true peak, RMS, crête | **T** | valeurs ffmpeg `ebur128`, séparées des tags |
| 4 | Timeline de sections éditable, confiance par section | **T** / **V** | exacte sur synthétique ; édition testée dans l'UI simulée ; la section suit le cue Intro / Build / Drop / Break / Outro déplacé |
| 4 | Drops par palier d'énergie | **V** | v0.3.3 : Drop 1 / Drop 2 / Outro à ≤ 0,5 s des corrections du DJ sur 3 morceaux réels ; sur les 10 autres, plausibles mais non vérifiés |
| 4 | Couplet / refrain | **V** | règle sur preuve vocale forte (unitaire) ; jamais déclenchée sur les 13 échantillons réels ; « instrumental » non proposé |
| 5 | Phrases 8/16/32 sans hypothèse forcée | **T** | unitaires + e2e |
| 6 | Énergie (courbe, score 1–10, événements, comparaison) | **V** | relations vérifiées ; échelle non calibrée |
| 7 | Smart Cue Engine, couleurs configurables, confiance, raisons | **T** | e2e + unitaires |
| 7.5 | Ajout, déplacement (waveform), suppression, renommage, couleur, verrou, annulation | **T** | piloté dans le vrai Electron (`npm run smoke`) : déplacement, annulation, renommage, suppression, persistance, conservation après ré-analyse forcée |
| 7.5 | Ré-analyse sans perte des ajustements | **T** | unitaire `merge` |
| 7.5 | « + Cue ici » toujours disponible, memory cues (sans pad) exportées | **T** / **V** | unitaire (fusion + export rekordbox `Num=-1` / Traktor `HOTCUE=-1`) + fumée Electron ; import réel non vérifié |
| 8 | Smart Loops (suggestion, validation, export) | **T** | e2e + export unitaire |
| 9 | Détection vocale (passages par mesure, confiance qualitative, affichage waveform) | **V** | v0.3.1 : modèle local Essentia MusiCNN (CC BY-NC-SA, logiciel gratuit non commercial) + heuristique ; exacte sur voix synthétique, 0 faux passage sur synthétiques sans voix ; sur 4 morceaux chantés réels 25–62 % de mesures détectées, 0–10 % (faibles) sur 6 présumés instrumentaux ; aucune annotation horodatée → précision/rappel non mesurés ; +5–10 s d'analyse par morceau |
| 9 | Repli heuristique seule (modèle absent) | **T** | e2e (`CUEKODA_VOCAL_MODEL=0`) |
| 9 | Passages vocaux corrigeables (ajout, début / fin, pause, nette / faible), conservés à la ré-analyse | **T** | unitaire `merge` + fumée Electron |
| 9 | Cues « Vocal » | **T** / **V** | mécanique testée (unitaire + e2e) ; pertinence dépend du détecteur |
| 10 | Mix In / Mix Out justifiés, avec présence vocale | **T** / **V** | logique testée (unitaire + e2e) ; « aucune voix détectée » n'est pas une garantie (détecteur non validé) |
| 14 | Avertissement « deux passages chantés superposés » | **T** / **V** | unitaire ; dépend du détecteur |
| 11 | Profils DJ extensibles et personnalisables | **T** / **V** | logique testée ; écran de réglages testé en simulation |
| 12 | Analyse par lots : parallèle, limite CPU, pause, reprise, annulation, échecs isolés, relance, cache, persistance, résumé | **T** | unitaires (faux workers) + workers réels + test de fumée Electron |
| 12 | Progression visible (ligne, panneau, en-tête, place dans la file) | **T** | fumée Electron (capture pendant l'analyse) ; corrige l'état « en attente » affiché pendant toute l'analyse |
| 13 | Dossiers surveillés (copie terminée, doublons, erreurs, pause) | **T** | e2e hors sandbox |
| 14 | Track matching justifié | **T** | unitaires |
| 14+ | Aperçu de transition A → B (tempo calé sans changer la tonalité, temps alignés, fondu 16 mesures) | **T** / **V** | plan unitaire (calage, demi-tempo, refus > 8 %) + bouton piloté dans Electron ; rendu sonore à juger à l'oreille |
| 15 | Doublons exacts / encodages / versions liées, sans suppression | **T** | empreinte chromatique par mesure ; calibrée sur 13 morceaux + réencodage + version coupée (marge 2 vs 67 mesures) |
| 16 | Stems | **N** | non implémenté (coût, modèle local à choisir) |
| 17 | Apprentissage simple à partir des corrections, réinitialisable | **T** / **V** | suppression enregistrée de bout en bout dans Electron ; effet sur les suggestions à valider en usage |
| 18 | Export rekordbox XML (cues, couleurs, memory cues, boucles) | **V** | XML valide et testé ; import réel non vérifié |
| 18 | Export Traktor NML (cues, boucles, grille) | **V** | idem |
| 18 | Serato | **N** | exigerait d'écrire dans les fichiers audio |
| 18 | Sécurité export (sauvegarde, aperçu, pas d'écriture en base) | **T** / **V** | code + aperçu ; fusion gérée par le logiciel DJ |
| 19 | Interface sombre, bibliothèque triable/filtrable, vue d'analyse zoomable, raccourcis, lecture audio | **T** / **V** | pilotée dans Electron (onglets, export, zoom, lecture et saut dans le morceau) ; raccourcis clavier non automatisés |
| 20 | Local, hors ligne, fichiers corrompus, sans tags, cache, persistance | **T** | e2e + fumée Electron |
| 21 | Tests de non-régression, relance avec nouveau moteur | **T** | `npm run test:regression`, cache par version |
| 21 | Évaluation sur annotations de référence vérifiées | **T** / **V** | « Valider comme référence » + `npm run eval` (BPM, phase, temps 1, MIREX, F1 cues / sections, Spearman énergie) ; chaîne vérifiée sur vérité terrain synthétique ; aucune référence réelle encore |
| 20 | Installeurs macOS (arm64, x64) et Windows, reconstruits à chaque commit | **T** | GitHub Actions ; DMG téléchargé depuis la release vérifié (analyse + cache) ; non signés Apple / Microsoft |
