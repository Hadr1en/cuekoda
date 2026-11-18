# Historique des versions

## 0.6.0 — 18 novembre 2026

### Nouveautés

- export de playlists ordonnées au format M3U8 pour Serato et les lecteurs compatibles ;
- préparation DJ plus fiable : cues, boucles, transitions, voix et corrections manuelles préservées ;
- smoke test autonome sur deux pistes synthétiques temporaires, sans corpus audio local requis.

### Améliorations

- parallélisme d’analyse adapté automatiquement au processeur et au budget mémoire ;
- file d’analyse, cache, dossiers surveillés, réglages et exports rendus plus robustes ;
- validation continue renforcée sous Windows et Linux ;
- moteur et caches d’analyse identifiés en version 0.6.0.

### Décision technique

- MusiCNN reste l’unique détecteur vocal distribué. Une évaluation publique de YAMNet et d’une combinaison des deux modèles n’a pas montré un gain suffisant face au coût en taille, CPU et maintenance. La synthèse est conservée dans `docs/YAMNET_EVALUATION.md`.
