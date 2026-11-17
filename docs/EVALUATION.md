# Évaluation du moteur CueKoda v0.5.2

3 morceau(x) — références vérifiées par le DJ.
Les références du DJ ne sont pas exhaustives : pour les cues, le rappel compte plus que la précision.
Couverture du corpus : 3/100 titres cibles, 1/5 genres cibles, 1/4 plages BPM cibles.

| Mesure | Morceaux | Résultat |
|---|---|---|
| BPM à ±1 % | 3 | 100 % (0 erreur(s) d'octave) |
| Erreur de phase de grille (médiane) | 2 | 0.4 ms |
| Premier temps correct | 2 | 100 % |
| Cues au bon temps (±40 ms, même type) : rappel | 3 | 67 % |
| Cues au bon temps : F1 | 3 | 0.53 |
| Cues à ±1 temps : F1 (écart moyen) | 3 | 0.60 (0.11 temps) |

## Résultats par morceau

| Morceau | Cues à ±40 ms | Cues à ±1 temps |
|---|---:|---:|
| Martin Garrix — *This Dream of You* | 4/5 | 4/5 |
| Alesso — *Heroes (we could be)* | 2/4 | 3/4 |
| Sebastian Ingrosso & Alesso — *Calling (Lose My Mind)* | 2/3 | 2/3 |
| Total | 8/12 | 9/12 |

Le moteur 0.3.3 retrouvait aussi 8 cues sur 12 à ±40 ms sur ces références. Le corpus contient trois
morceaux et des annotations partielles. Deux d'entre eux ont une grille annotée.

| Cue hors tolérance à ±40 ms | Référence | Écart du cue proposé |
|---|---:|---|
| *This Dream of You* — Vocal | 16,612 s | Aucun cue de ce type |
| *Heroes* — Intro | 35,288 s | 71 temps en avance |
| *Heroes* — Drop 1 | 104,812 s | 1 temps en avance |
| *Calling* — Vocal | 74,837 s | Aucun cue de ce type |

Sur les 13 morceaux de non-régression, quatre cues Vocal disparaissent et le Break de *This Dream of You*
passe de 200,36 s à 140,36 s, avec la frontière de section déplacée de la mesure 106 à la mesure 74.
La moyenne des scores d'énergie passe de 8,0 à 7,9 et l'écart-type de 0,30 à 0,37.

## Corpus publics

Les fichiers audio restent hors du dépôt. Passer le dossier audio original et le dossier des
annotations à la commande suivante.

```bash
npm run eval -- --dataset ballroom --annotations /chemin/vers/BallroomAnnotations --audio /chemin/vers/BallroomData --json ballroom.json
npm run eval -- --dataset brid --annotations /chemin/vers/Annotations --audio /chemin/vers/Data --json brid.json
npm run eval -- --dataset raveform --annotations /chemin/vers/raveform --audio /chemin/vers/audio --json raveform.json
```

- [Ballroom](https://github.com/CPJKU/BallroomAnnotations) fournit les annotations de temps et de
  mesure et indique comment récupérer les extraits. Le BPM de référence est calculé à partir
  de l'intervalle médian entre temps annotés.
- [BRID](https://zenodo.org/records/14051323) fournit l'audio, les annotations de temps et les
  BPM de référence. Les enregistrements d'ensemble annotés sont le corpus évaluable.
- [Raveform](https://mir-aidj.github.io/raveform/) fournit des annotations de temps, de premiers
  temps et de sections sur des titres électro complets. Le dossier audio doit contenir les versions
  exactes et non découpées identifiées par le corpus. Nommer chaque fichier avec son identifiant
  vidéo YouTube en respectant la casse, par exemple 5WvMql1Ejzs.flac. Les sections sont évaluées
  comme frontières musicales à ±1 mesure.
- [GiantSteps Tempo](https://github.com/GiantSteps/giantsteps-tempo-dataset) utilise
  `--dataset giantsteps-tempo` et le dossier `annotations_v2/tempo`. [GiantSteps Key](https://github.com/GiantSteps/giantsteps-key-dataset)
  utilise `--dataset giantsteps-key` et le dossier `annotations/key`.

Le JSON donne la couverture et les échecs par fichier. Pour comparer la grille sur des titres
hors EDM, regrouper les résultats par `beats.referenceBeatsPerBar`. Le moteur de préparation
calcule ses mesures en 4/4.


### Contrôles de tempo indépendants

- [Freesound Loop Dataset](https://zenodo.org/records/3967852) fournit des boucles annotées par
  des experts. Pour tester le tempo de manière reproductible, conserver les annotations 4/4
  qui décrivent une boucle percussive bien découpée et écarter les conflits de BPM.
- [Groove MIDI Dataset](https://magenta.withgoogle.com/datasets/groove) fournit l'audio de
  performances jouées au métronome. Le sous-ensemble officiel de test permet de vérifier des
  rythmes joués avec de petites variations autour du BPM indiqué dans `info.csv`.

Le CLI accepte une liste JSON de références avec un chemin audio par entrée via `--refs`.
Les mesures de tempo sur des boucles ou sur de la batterie seule n’évaluent pas le placement
de cues sur des morceaux complets.

### Modèles de cues électro

CueKoda 0.5.2 utilise deux petits modèles d’arbres pour comparer les emplacements de drops et
de breaks sur une grille EDM déjà établie. Les modèles suivent l’énergie, le bas du spectre,
la brillance et les attaques de grosse caisse sur plusieurs mesures. Les seuils de sélection
et le résultat passent ensuite par le profil habituel de hot cues.

Le [manifeste d’entraînement](../scripts/electro-cue-training-ids.json) contient 45 titres
des plis 2 à 5 de [Raveform](https://mir-aidj.github.io/raveform/). Le pli 6 a servi au réglage
et un nouveau lot du pli 7 à la validation finale. Pour régénérer les coefficients à partir
des versions audio originales, utiliser scikit-learn 1.9.1 et NumPy 2.5.4.

```bash
npm run build
CUEKODA_VOCAL_MODEL=0 node dist/test/export-electro-cue-features.js \
  /chemin/vers/raveform/structures /chemin/vers/audio \
  scripts/electro-cue-training-ids.json > electro-cue-features.jsonl
python3 scripts/train-electro-cues.py electro-cue-features.jsonl src/core/electroCueModel.json
```

### Autres corpus électro

[Socially Significant Music Events](https://osf.io/eydxk/), de TU Delft, fournit 402 MP3
et leurs annotations MATLAB. Télécharger et vérifier les parties d’archive depuis OSF, puis
extraire le ZIP multipart. Le script ci-dessous prépare les paires audio/annotations.
Les colonnes de commentaires SoundCloud et les sentinelles zéro sont exclues.
Les annotations expertes de SSMe sont arrondies à la seconde.

```bash
python3 scripts/import-ssme.py /chemin/vers/mp3s_soundcloud_cc_event_detection ssme.json
```

L’importateur utilise NumPy, SciPy et Mutagen. Le manifeste conserve les sommes SHA-256,
les repères experts et une partition déterministe par identifiant SSMe. Le corpus ne
fournit pas de tags d’artiste dans ses MP3. Le partage par identifiant protège la séparation
des fichiers identiques après dédoublonnage SHA-256.

[EDM-98](https://github.com/25ohms/EDM-98) fournit les sections et les partitions officielles,
avec des identifiants Deezer. Il faut retrouver l’enregistrement complet correspondant avant
l’extraction de caractéristiques. [M-DJCUE](https://github.com/MZehren/M-DJCUE) fournit des
repères de mix annotés et indique des versions audio de substitution pour une partie des titres.
[EDM-CUE](https://huggingface.co/datasets/disco-eth/edm-cue) fournit des cues génériques et une
grille par titre. Les fichiers `valid` et `test` téléchargés pour ce benchmark sont identiques.

Les manifestes de repères chronométrés peuvent alimenter le même entraînement.
L’export utilise exclusivement la partition `train`. Recalage et tolérance d’association
tiennent compte de la précision temporelle propre à chaque corpus.

```bash
CUEKODA_VOCAL_MODEL=0 node dist/test/export-electro-cue-features.js --timed-marks ssme.json \
  /chemin/vers/mp3s_soundcloud_cc_event_detection > ssme-features.jsonl
cat electro-cue-features.jsonl ssme-features.jsonl > features-mixtes.jsonl
python3 scripts/train-electro-cues.py features-mixtes.jsonl electro-cue-candidat.json --ssme-weight 0.25
```

Pour ajouter EDM-98, utiliser un manifeste avec `source: "EDM-98"` et les mêmes champs de
piste, puis inclure son export dans le fichier mixte et régler `--edm98-weight`. La pondération
par défaut des deux corpus supplémentaires est nulle. Évaluer les paramètres candidats
sur les partitions réservées avant de remplacer les paramètres du moteur.

Pour tester un seul type de repère et reprendre les paramètres actuels de l’autre,
ajouter `--head breakdown --base-model src/core/electroCueModel.json` à la commande
d’entraînement. Le type `drop` est également accepté.
