# Matrice de compatibilité des exports

Légende : ✓ transféré · ≈ partiel · ✗ non transféré. **Imports rekordbox et Traktor vérifiés par un DJ
le 2026-11-14** (morceaux analysés et corrigés dans CueKoda, puis importés). Engine DJ, VirtualDJ et djay Pro
lisent le même fichier rekordbox XML : chemin plausible mais **pas encore vérifié** dans ces logiciels.
Un essai sur quelques morceaux reste conseillé avant une prestation.

L'export se fait depuis un seul bouton « Exporter… » : on choisit le logiciel, CueKoda écrit le fichier
qu'il sait lire et affiche les étapes d'import.

| Donnée | rekordbox (XML) | Traktor Pro (NML) | Serato DJ Pro |
|---|---|---|---|
| Statut | **Import vérifié** | **Import vérifié** | **Non disponible** |
| BPM | ✓ | ✓ | ✗ |
| Beatgrid | ✓ un marqueur, ou un par plage de tempo si le tempo change | ≈ marqueur AutoGrid (un seul tempo) | ✗ |
| Tonalité | ✓ (notation musicale) | ✓ (index Traktor + Open Key) | ✗ |
| Hot cues (8) | ✓ Num 0–7 | ✓ HOTCUE 0–7 | ✗ |
| Noms des cues | ✓ | ✓ | ✗ |
| Couleurs des cues | ≈ RGB (rekordbox peut les ramener à sa palette) | ✗ (couleur imposée par le type) | ✗ |
| Memory cues | ✓ (option pour toutes les cues ; toujours pour les cues sans pad) | ✓ cues sans pad : `CUE_V2 HOTCUE="-1"` | ✗ |
| Boucles | ✓ memory loops (Type 4) | ✓ boucles mémorisées (TYPE 5) | ✗ |
| Sections / énergie / phrases / Mix In-Out | ✗ | ✗ | ✗ |

## Engine DJ, VirtualDJ, djay Pro (via rekordbox XML, non vérifiés)
| Logiciel | Ce que CueKoda écrit | Import (libellés variables selon la version) |
|---|---|---|
| Engine DJ (Denon DJ, Numark, Rane) | rekordbox XML | Préférences › Library : activer la bibliothèque rekordbox, indiquer le fichier ; glisser les morceaux dans la Collection. Engine DJ lit aussi une collection Traktor (NML). |
| VirtualDJ | rekordbox XML | Paramètres › Options : chemin du fichier rekordbox XML ; dossier « rekordbox » du navigateur. |
| djay Pro | rekordbox XML | Réglages › Bibliothèque : intégration rekordbox, choisir le fichier. |

Ce qui est repris (cues, couleurs, memory cues, boucles, grille) dépend de ce que chaque logiciel lit dans ce
fichier : à vérifier sur un morceau test, puis à signaler pour passer la ligne en « vérifié ».

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
