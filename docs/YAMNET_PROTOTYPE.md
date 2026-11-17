# Prototype YAMNet pour la détection vocale

## Objectif

Construire un prototype local et réversible qui compare YAMNet au détecteur MusiCNN actuel de CueKoda.
Le prototype ne remplace pas le modèle par défaut et ne modifie pas les résultats de production tant que
les mesures sur des annotations vérifiées ne montrent pas un gain.

Sources officielles :

- modèle et poids : <https://github.com/tensorflow/models/tree/master/research/audioset/yamnet>
- licence Apache 2.0 de `/research` : <https://github.com/tensorflow/models/blob/master/LICENSE>
- classes AudioSet : <https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv>
- paramètres : <https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/params.py>

## Contraintes

1. Travailler dans une branche ou un worktree séparé à partir de CueKoda 0.6.0.
2. Conserver MusiCNN comme comportement par défaut pendant tout le prototype.
3. Ajouter une sélection explicite : `CUEKODA_VOCAL_MODEL=musicnn|yamnet|0`.
4. Exécuter YAMNet via `onnxruntime-node`, déjà embarqué. Ne pas ajouter un second runtime Python ou
   TensorFlow à l’application distribuée.
5. L’analyse reste entièrement locale et ne télécharge rien à l’exécution.
6. Ne pas modifier les fichiers audio.
7. Conserver la provenance, l’URL, la version, le SHA-256 et la licence des poids dans `models/neural/README.md`.

## Export du modèle

Ajouter `scripts/models/export-yamnet.py` qui :

1. télécharge ou reçoit le poids officiel `yamnet.h5` ;
2. construit l’architecture YAMNet officielle ;
3. exporte un modèle ONNX déterministe ;
4. vérifie sur plusieurs signaux que les sorties ONNX correspondent aux sorties Keras avec une tolérance
   numérique documentée ;
5. écrit `models/neural/yamnet.onnx` et sa somme SHA-256.

Préférer un modèle dont l’entrée est un lot de patches log-mel `[N, 96, 64]` et la sortie `[N, 521]`.
Cela permet de garder le prétraitement contrôlé et testé dans CueKoda.

## Prétraitement à reproduire

- audio mono à 16 kHz ;
- STFT : fenêtre de 25 ms, pas de 10 ms, fenêtre Hann périodique ;
- 64 bandes mel de 125 à 7 500 Hz ;
- `log(mel + 0.001)` ;
- patch de 0,96 s, pas de 0,48 s.

Ajouter un test de parité entre le prétraitement TypeScript et l’implémentation officielle, sur signaux
synthétiques et sur un petit extrait audio local non versionné.

## Sorties vocales

Ne jamais dépendre d’indices écrits en dur : résoudre les sorties par leur nom dans la class map officielle.
Conserver séparément au minimum :

- chant : Singing, Choir, Child singing, Synthetic singing, Yodeling, Chant, Mantra, Humming, Vocal music,
  A capella et Opera ;
- rap/parlé : Rapping et Speech ;
- public : Cheering, Crowd, Chatter et Applause, qui ne doivent pas devenir automatiquement une voix
  superposable dans une transition.

Produire les courbes brutes par classe pour l’évaluation. Pour l’intégration expérimentale, convertir les
classes vocales en un score par patch, puis réutiliser la projection par mesure et l’hystérésis de
`src/core/vocals.ts`. Ne pas calibrer les seuils uniquement sur quelques titres EDM.

## Évaluation A/B

Comparer `musicnn`, `yamnet` et l’heuristique seule sur au moins 40 morceaux annotés via le contrôle express :

- toutes les familles rythmiques disponibles ;
- chant principal, rap/parlé, vocal chops, chœurs et instrumentaux ;
- voix très présente et voix noyée dans le mix ;
- leads synthétiques, pads, saxophone et foule pour mesurer les faux positifs.

Mesurer :

- précision, rappel et F1 par mesure ;
- IoU des segments vocaux ;
- erreur de début et de fin des passages ;
- faux positifs sur les instrumentaux ;
- temps d’inférence, mémoire maximale et taille ajoutée à l’application ;
- résultats séparés par famille Beatport et par type vocal.

Écrire le comparatif dans `docs/YAMNET_EVALUATION.md`. Ne remplacer MusiCNN que si YAMNet améliore la
couverture sans dégrader nettement les instrumentaux, avec un coût CPU et une taille acceptables.

## Tests et livrables

- `scripts/models/export-yamnet.py` ;
- `models/neural/yamnet.onnx` ou, si le poids ne doit pas être versionné, une procédure reproductible de
  téléchargement et de vérification ;
- prétraitement YAMNet TypeScript testé ;
- inférence isolée dans le processus ONNX existant ;
- sélection `musicnn|yamnet|0` ;
- rapport A/B, licence et provenance ;
- aucun changement du modèle par défaut.

Validation minimale :

```bash
npm run typecheck
npm run test:unit
npm test
npm run smoke
```

