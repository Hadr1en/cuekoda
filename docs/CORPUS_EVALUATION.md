# Corpus d’évaluation réel

L’objectif est de mesurer CueKoda sur au moins **100 titres vérifiés à l’oreille**, sans ajouter de musique
protégée au dépôt. Seules les annotations JSON sont versionnées ; chaque contributeur conserve les fichiers
audio qu’il a légalement sur sa machine.

## Couverture minimale

- au moins 5 genres et 4 plages BPM parmi `<100`, `100–119`, `120–129`, `130–149`, `≥150` ;
- morceaux à tempo stable, tempo variable, interprétation live et edits ;
- voix et instrumentaux, intros propres et irrégulières, fichiers compressés et lossless ;
- annotations de grille, tonalité, cues, structure, voix et énergie réparties sur le corpus.

Les références acceptent les champs facultatifs `genre` et `scenario` (`steady`, `variable`, `live`, `edit`).
Le rapport `npm run eval` affiche désormais les angles morts du corpus et les écrit aussi dans la section
`coverage` du JSON produit par `--json`.

## Procédure

1. Corriger le morceau à l’oreille dans CueKoda puis le valider comme référence.
2. Exporter les références depuis l’application.
3. Retirer les chemins personnels et empreintes si le fichier JSON doit être partagé.
4. Ajouter `genre` et `scenario`, puis relire les annotations avec un second DJ lorsque c’est possible.
5. Lancer `npm run eval -- --refs <références> --audio <dossier audio> --json <rapport.json>`.

Le corpus de trois titres actuel reste un test de non-régression. Il n’est pas présenté comme une preuve de
précision générale tant que les objectifs de couverture ci-dessus ne sont pas atteints.
