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
- profils rythmiques et benchmark de non-régression pour DnB, trap half-time, UK garage, Afro/Latin et hard techno ;
- reprises après un break soutenu conservées sur la frontière audio mesurée, sans décalage artificiel de phrase ;
- MusiCNN évalué sur les partitions officielles `valid`/`test` de Jamendo SVD ; le candidat à rappel élevé a été rejeté afin de préserver la précision et de limiter les fausses alertes ;
- chargeurs d’évaluation officiels ajoutés pour Jamendo, M-DJCUE, Groove et AudioSet, avec rapports par famille et type vocal ;
- moteur et caches d’analyse identifiés en version 0.6.0.

### Décision technique

- MusiCNN reste l’unique détecteur vocal distribué. Une évaluation publique de YAMNet et d’une combinaison des deux modèles n’a pas montré un gain suffisant face au coût en taille, CPU et maintenance. La synthèse est conservée dans `docs/YAMNET_EVALUATION.md`.
