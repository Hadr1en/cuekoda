<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/png/cuekoda-logo-sombre@2x.png">
    <img src="assets/logo/png/cuekoda-logo-clair@2x.png" alt="CueKoda — Analyze. Cue. Mix." width="560">
  </picture>
</p>

# CueKoda — *Analyze. Cue. Mix.*

Application de **préparation musicale pour DJ** (Windows / macOS, Electron). CueKoda n'est pas un logiciel
de mix : il transforme des fichiers audio bruts en morceaux analysés, structurés et annotés, prêts pour
rekordbox ou Traktor. **CueKoda prépare, le DJ décide** : chaque suggestion est justifiée, notée en confiance,
modifiable, et vos corrections survivent aux ré-analyses.

Tout est local : aucun fichier audio n'est envoyé en ligne, modifié ou déplacé.

## Ce que fait CueKoda (v0.2)

- **Analyse** : BPM (demi/double tempo, stabilité, confiance), grille et premier temps, tonalité
  (Camelot / Open Key, ambiguïté signalée), LUFS / true peak, énergie 1–10 et courbe, phrases 8/16/32,
  timeline de sections (intro, build, drop, breakdown, outro… sans forcer l'EDM).
- **Préparation** : hot cues placés d'après la musique (nom, couleur par fonction, confiance, raison),
  boucles suggérées, points Mix In / Mix Out justifiés, morceaux compatibles, doublons.
- **Édition** : waveform zoomable, cues à glisser (aimantés), renommer, colorer, verrouiller, annuler /
  rétablir, correction BPM / grille / clé, édition des sections et des boucles.
- **Bibliothèque** : file d'analyse parallèle (pause, annulation, relance, limite CPU), cache par
  contenu, persistance, dossiers surveillés, profils DJ personnalisables, apprentissage simple.
- **Export** : rekordbox XML et Traktor NML, avec aperçu de ce qui est transféré et sauvegarde du fichier
  existant. Serato : non disponible (voir la matrice).

État détaillé de chaque fonctionnalité (testée / à valider / partielle / absente) :
[docs/AUDIT_ET_PLAN.md](docs/AUDIT_ET_PLAN.md#5-état-après-les-chantiers-v02-et-v03x-détection-vocale-2026-11-14).

## Télécharger

Les installeurs sont reconstruits automatiquement à chaque commit sur `main` (GitHub Actions) et publiés
dans les [Releases](https://github.com/Hadr1en/cuekoda/releases/latest) :

| Système | Fichier |
|---|---|
| macOS 13+ Apple Silicon (M1–M4) | `CueKoda-<version>-mac-arm64.dmg` |
| macOS 13+ Intel | `CueKoda-<version>-mac-x64.dmg` |
| Windows 10/11 64 bits | `CueKoda-<version>-windows-setup.exe` |

L'application n'est pas encore signée par un certificat Apple / Microsoft :
- **macOS** : glisser CueKoda dans Applications, l'ouvrir une fois, puis Réglages Système ›
  Confidentialité et sécurité › **Ouvrir quand même**.
- **Windows** : à l'avertissement SmartScreen, **Informations complémentaires** › **Exécuter quand même**.

Le dépôt étant privé, seuls les comptes GitHub ayant accès au dépôt peuvent télécharger les installeurs.

Construire localement : `npm run dist:mac` (DMG arm64 + x64) ou `npm run dist:win` (sur Windows).

## Démarrer

```bash
npm install
```

```bash
npm start
```

## Tests

```bash
npm run test:all
```

```bash
npm run test:regression
```

```bash
npm run smoke
```

- `test:all` : typecheck, tests unitaires (matching, doublons et empreinte, profils, fusion, exports, file
  d'analyse, évaluation…) et le test de bout en bout sur morceaux synthétiques (BPM, grille, clé, sections,
  cues, boucles, corrections manuelles, changement de tempo, évaluation, cache, fichier corrompu, dossier
  surveillé).
- `test:regression` : ré-analyse `samples/` et compare à `tests/baselines/samples.json`.
- `smoke` : lance la vraie app Electron sans fenêtre visible sur `samples/`, pilote l'interface (édition de
  cues, annulation, export, lecture audio) et écrit `smoke-report.json`.
- `eval` : mesure la justesse du moteur sur les morceaux validés comme référence dans l'app
  (voir [ALGORITHMES.md](docs/ALGORITHMES.md#évaluation-sur-références-vérifiées-evaluatets-npm-run-eval)).

Ligne de commande (même moteur) :

```bash
npm run build && node dist/cli/cli.js ~/Music/MonDossier --profile house --out sortie
```

## Logo

Symbole : l'anneau de la *coda* (« Koda ») contenant une waveform dont la barre centrale blanche marque le
point de cue. Sources SVG et PNG dans [assets/logo](assets/logo) ; icône d'application `build/icon.png`
(electron-builder en tire les `.icns` / `.ico`) ; régénérer les PNG avec `scripts/render-logo.cjs`.

## Documentation

- [Guide utilisateur](docs/GUIDE_UTILISATEUR.md)
- [Algorithmes et limites](docs/ALGORITHMES.md)
- [Matrice de compatibilité des exports](docs/MATRICE_EXPORT.md)
- [Audit, architecture, plan et état des fonctionnalités](docs/AUDIT_ET_PLAN.md)

## Architecture

```
src/core/       moteur pur (décodage, tempo, grille, tonalité, énergie, structure, cues, boucles,
                mix, profils, fusion, matching, doublons, apprentissage, export/ adaptateurs)
src/main/       Electron : bibliothèque persistante, cache, file d'analyse (workers), dossiers surveillés
src/renderer/   interface (bibliothèque, vue d'analyse, dialogues) — HTML/CSS/TS sans framework
src/test/       unitaires, bout en bout, non-régression, diagnostic tempo
```

Stack : Electron 45 (macOS 13+ requis, Windows 64 bits uniquement), TypeScript, esbuild 0.28,
electron-builder 26, Essentia.js (AGPL-3.0 — à prendre en compte avant toute distribution),
ffmpeg-static (binaire GPL), music-metadata 12 (ESM, intégré au bundle par esbuild). Node.js ≥ 22.12
pour les outils de développement.
Détection vocale : TensorFlow.js (Apache-2.0) et le modèle `voice_instrumental-musicnn-msd-2` du Music
Technology Group (UPF), sous licence CC BY-NC-SA 4.0 — CueKoda est gratuit et non commercial ; le modèle
est stocké dans `models/` avec sa licence (voir [ALGORITHMES.md](docs/ALGORITHMES.md#crédits)).

## Limites connues
- Imports rekordbox / Traktor **non encore validés** dans les logiciels réels.
- Détection vocale expérimentale, non validée sur annotations ; pas de séparation de stems.
- Tempo changeant : marqueurs de tempo exportés vers rekordbox, mais cues et sections calculés sur la grille moyenne.
- Énergie et confiances non calibrées sur un corpus annoté.
