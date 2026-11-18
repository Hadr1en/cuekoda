# Corpus d’évaluation réel

L’objectif est de mesurer CueKoda sur au moins **180 titres vérifiés à l’oreille**, sans ajouter de musique
protégée au dépôt. Seules les annotations JSON sont versionnées ; chaque contributeur conserve les fichiers
audio qu’il a légalement sur sa machine.

## Couverture minimale

- les 9 familles de préparation et, progressivement, tous les genres parents Beatport connus de CueKoda ;
- au moins 6 plages BPM parmi `<80`, `80–99`, `100–119`, `120–129`, `130–149`, `150–179`, `≥180` ;
- rythmes quatre-temps, cassés, half-time et libres/hybrides ;
- morceaux à tempo stable, tempo variable, interprétation live et edits ;
- voix et instrumentaux, intros propres et irrégulières, fichiers compressés et lossless ;
- annotations de grille, tonalité, cues, structure, voix et énergie réparties sur le corpus.

Le contrôle express enregistre le genre Beatport, sa famille, le comportement rythmique, le scénario
(`steady`, `variable`, `live`, `edit`), le type vocal et, facultativement, l’énergie ressentie.
Le rapport `npm run eval` affiche désormais les angles morts du corpus et les écrit aussi dans la section
`coverage` du JSON produit par `--json`.

## Procédure

1. Corriger le morceau à l’oreille dans CueKoda, ouvrir **Contrôle express**, renseigner le genre puis
   sélectionner **Valider et enregistrer**.
2. Exporter les références depuis l’application.
3. Retirer les chemins personnels et empreintes si le fichier JSON doit être partagé.
4. Relire les annotations avec un second DJ lorsque c’est possible.
5. Lancer `npm run eval -- --refs <références> --audio <dossier audio> --json <rapport.json>`.

Le corpus de trois titres actuel reste un test de non-régression. Il n’est pas présenté comme une preuve de
précision générale tant que les objectifs de couverture ci-dessus ne sont pas atteints.
