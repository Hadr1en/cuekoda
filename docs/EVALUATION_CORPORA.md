# Corpus officiels d’évaluation

Ces données servent uniquement au développement. CueKoda ne télécharge rien pendant son utilisation,
n’embarque aucun corpus et ne modifie jamais les fichiers audio. Le registre vérifiable se trouve dans
`scripts/evaluation-corpora.json`; les dépôts Git y sont figés sur un commit et les archives officielles sur
leur somme publiée quand elle existe.

| Besoin | Corpus officiel | Ce qu’il valide |
|---|---|---|
| BPM électronique | [GiantSteps Tempo](https://github.com/GiantSteps/giantsteps-tempo-dataset) | tempo, erreurs ×2/÷2 |
| Tonalité électronique | [GiantSteps Key](https://github.com/GiantSteps/giantsteps-key-dataset) | tonalité MIREX |
| Temps et premier temps | [BallroomAnnotations](https://github.com/CPJKU/BallroomAnnotations) | beat/downbeat multi-styles |
| Structure généraliste | [Harmonix Set](https://github.com/urinieto/harmonixset) | beat, downbeat, frontières de sections |
| Structure EDM | [Raveform](https://raveform.netlify.app/) | 1 423 titres annotés par trois experts du domaine |
| Points de mix DJ | [M-DJCUE](https://github.com/MZehren/M-DJCUE) | 134 titres, trois annotations indépendantes par titre |
| Présence vocale | [Jamendo Singing Voice](https://zenodo.org/records/2585988) | chant ou parole / absence de voix, intervalles manuels |
| Types vocaux et foule | [Google AudioSet](https://research.google.com/audioset/download.html) | chant, rap/parole et foule restent trois groupes distincts |
| Rythmes live et syncopés | [Groove MIDI Dataset](https://magenta.withgoogle.com/datasets/groove) | 1 150 performances alignées à moins de 2 ms |
| Rythmes brésiliens | [BRID](https://zenodo.org/records/14051323) | tempo et temps sur instruments rythmiques réels |

## Commandes reproductibles

Chaque corpus est évalué depuis une copie locale obtenue auprès de sa source officielle :

```text
npm run eval -- --dataset <id> --annotations <dossier> --audio <dossier> --json resultat.json --write rapport.md
npm run corpora:verify -- <id> <archive-ou-depot>
npm run eval:compare -- avant.json apres.json
npm run benchmark:rhythm -- --json rythme.json
npm run offset-test -- cuekoda-offset-test
```

Pour AudioSet, `--annotations` pointe vers `eval_segments.csv` officiel et `--audio` vers des extraits
de 10 secondes déjà obtenus légalement, nommés avec leur identifiant YouTube. Les labels sont des présences
sur le clip entier : ils mesurent les confusions entre familles, pas la précision des frontières temporelles.

Une modification moteur n’est retenue que si le rapport avant/après ne régresse pas par famille. Le seuil
vocal ne doit être recalibré que sur un lot d’entraînement, puis validé sur un lot distinct. Les fichiers
Jamendo permettent ce découpage sans remplacer MusiCNN ni introduire un autre moteur dans l’application.

## Limites d’interprétation

- Les annotations seules ne donnent aucun score sans les fichiers audio correspondants.
- Les résultats synthétiques protègent les cas limites, mais ne remplacent jamais les corpus humains.
- L’offset rekordbox/Traktor dépend du décodeur propriétaire : CueKoda produit les fichiers de contrôle et
  vérifie son propre décodage/export, mais la mesure finale doit être relevée dans chaque logiciel.
