# Matrice de compatibilité des exports

Légende : ✓ transféré · ≈ partiel · ✗ non transféré. **Les exports rekordbox et Traktor ont été importés par
un DJ le 14 novembre 2026**. Le nouveau mapping Traktor reste à vérifier dans Traktor Pro. Engine DJ, VirtualDJ et djay Pro
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
| Hot cues | ✓ pads A–H → `Num=0–7` | ≈ pads A–G → boutons 2–8 (`HOTCUE=1–7`). Bouton 1 (`HOTCUE=0`) réservé à AutoGrid | ✗ |
| Noms des cues | ✓ | ✓ | ✗ |
| Couleurs des cues | ≈ RGB (rekordbox peut les ramener à sa palette) | ✗ (couleur imposée par le type) | ✗ |
| Memory cues | ✓ (option pour toutes les cues, et toujours pour les cues sans pad) | ✓ pad H et cues sans pad (`CUE_V2 HOTCUE="-1"`) | ✗ |
| Boucles | ✓ memory loops (Type 4) | ✓ boucles mémorisées (TYPE 5) | ✗ |
| Commentaire « E8 · 8B · Vocal » (option) | ✓ attribut Comments | ✓ INFO COMMENT | ✗ |
| Playlist (set dans l'ordre, nommée) | ✓ NODE Type 1 | ✓ NODE PLAYLIST | ✗ |
| Sections / énergie / phrases / Mix In-Out | ✗ (énergie seulement via le commentaire) | ✗ (idem) | ✗ |

Dans Traktor, un fichier sous `/Volumes/X/…` est exporté avec `VOLUME="X"` et un chemin relatif à ce volume.
L'aperçu d'export signale aussi les cues superposés.

## Importer une collection dans CueKoda

« Importer collection… » lit un XML rekordbox ou un NML Traktor. Les morceaux sont rapprochés par leur
chemin. Tu peux limiter l'import aux morceaux de ta bibliothèque ou ajouter les fichiers audio accessibles.
Les cues importés sont verrouillés, les boucles reprises sont validées et les suggestions occupent les pads libres.
L'option BPM et grille relance l'analyse avec le BPM importé et le premier repère de grille disponible.

Dans le sens Traktor → CueKoda, les boutons 2–8 correspondent aux pads A–G. Si le bouton 1 porte un cue
plutôt qu'AutoGrid, il est repris sur le pad H s'il est libre, ou comme cue mémorisé. AutoGrid sert de repère
de grille. La collection source est lue sans être modifiée.

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
3. Traktor : sauvegarder `collection.nml`, puis « Import Another Collection ». Vérifier AutoGrid sur le
   bouton 1, A–G sur les boutons 2–8, H dans les cues mémorisés, et tester un fichier sur un volume externe.
4. Lancer `npm run offset-test` et importer le XML et le NML générés. Mesurer le décalage entre les clics
   et les repères sur WAV, MP3 avec et sans en-tête gapless, et AAC dans les deux logiciels.
5. Faire un retour XML/NML vers CueKoda et vérifier les pads verrouillés, les boucles et l'option BPM/grille.
