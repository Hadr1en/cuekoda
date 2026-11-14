# Matrice de compatibilité des exports

Légende : ✓ transféré · ≈ partiel · ✗ non transféré. **Aucun export n'a encore été validé par un import
dans le logiciel réel** : les fichiers sont conformes aux formats documentés et vérifiés comme XML valides
par les tests, mais un essai sur quelques morceaux est indispensable avant un usage en prestation.

| Donnée | rekordbox (XML) | Traktor Pro (NML) | Serato DJ Pro |
|---|---|---|---|
| Statut | Disponible, non validé | Disponible, non validé | **Non disponible** |
| BPM | ✓ | ✓ | ✗ |
| Beatgrid | ≈ un marqueur (grille fixe) | ≈ marqueur AutoGrid (grille fixe) | ✗ |
| Tonalité | ✓ (notation musicale) | ✓ (index Traktor + Open Key) | ✗ |
| Hot cues (8) | ✓ Num 0–7 | ✓ HOTCUE 0–7 | ✗ |
| Noms des cues | ✓ | ✓ | ✗ |
| Couleurs des cues | ≈ RGB (rekordbox peut les ramener à sa palette) | ✗ (couleur imposée par le type) | ✗ |
| Memory cues | ✓ (option) | ✗ (inutile) | ✗ |
| Boucles | ✓ memory loops (Type 4) | ✓ boucles mémorisées (TYPE 5) | ✗ |
| Sections / énergie / phrases / Mix In-Out | ✗ | ✗ | ✗ |

## Pourquoi pas Serato ?
Serato stocke cues, grille et BPM **dans les tags des fichiers audio** (objets GEOB « Serato Markers2 »).
Les écrire modifierait les fichiers sources, ce que CueKoda s'interdit. Pistes : exporter vers rekordbox puis
convertir avec un outil tiers (Lexicon, Rekord Buddy…) ou la fonction d'import de bibliothèques tierces de
Serato si votre version la propose — non vérifié par CueKoda.

## Sécurité
- CueKoda n'écrit **jamais** dans une base propriétaire (rekordbox `master.db`, `collection.nml` de Traktor)
  ni dans les fichiers audio : il produit un nouveau fichier de collection.
- Si le fichier de destination existe, il est d'abord copié en `…backup-AAAA-MM-JJTHH-MM-SS`.
- La fenêtre d'export indique, avant d'écrire, ce qui sera transféré et ce qui ne le sera pas.
- La fusion avec des hot cues existants est gérée par le logiciel DJ au moment de l'import : CueKoda ne peut
  pas la garantir (voir les étapes d'import affichées dans la fenêtre d'export).

## Procédure de validation à faire (manuelle)
1. Exporter 3 morceaux (dont un avec boucles validées).
2. rekordbox : importer via la vue « rekordbox xml », vérifier BPM, grille (temps 1), clé, 8 pads, noms,
   couleurs, memory cues et boucles.
3. Traktor : sauvegarder `collection.nml`, « Import Another Collection », vérifier les mêmes points.
4. Reporter le résultat ici et passer `validated: true` dans `src/core/export/index.ts`.
