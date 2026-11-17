# Matrice de compatibilité des exports

Légende · ✓ transféré · ≈ partiel · ✗ non transféré.

Le dialogue « Exporter… » génère un fichier dans le format sélectionné et affiche les étapes d’import correspondantes.

| Donnée | rekordbox (XML) | Traktor Pro (NML) |
|---|---|---|---|
| BPM | ✓ | ✓ |
| Beatgrid | ✓ un marqueur, ou un par plage de tempo si le tempo change | ≈ marqueur AutoGrid (un seul tempo) |
| Tonalité | ✓ (notation musicale) | ✓ (index Traktor + Open Key) |
| Hot cues | ✓ pads A–H → `Num=0–7` | ≈ cues de pad regroupés sur les boutons 2–8. Bouton 1 réservé à AutoGrid |
| Noms des cues | ✓ | ✓ |
| Couleurs des cues | ≈ RGB (rekordbox peut les ramener à sa palette) | ✗ (couleur imposée par le type) |
| Memory cues | ✓ (option pour toutes les cues, et toujours pour les cues sans pad) | ✓ cues sans pad et cues au-delà du bouton 8 (`CUE_V2 HOTCUE="-1"`) |
| Boucles | ✓ memory loops (Type 4) | ✓ boucles mémorisées (TYPE 5, HOTCUE -1) |
| Commentaire « E8 · 8B · Vocal » (option) | ✓ attribut Comments | ✓ INFO COMMENT |
| Playlist (set dans l'ordre, nommée) | ✓ NODE Type 1 | ✓ NODE PLAYLIST |
| Sections / énergie / phrases / Mix In-Out | ✗ (énergie seulement via le commentaire) | ✗ (idem) |

Dans Traktor, un fichier sous `/Volumes/X/…` est exporté avec `VOLUME="X"` et un chemin relatif à ce volume.
Au premier temps, CueKoda exporte le repère AutoGrid seul et le signale dans l’aperçu.
Avec l’option par défaut « validées uniquement », seules les boucles validées dans CueKoda sont exportées.

## Importer une collection dans CueKoda

« Importer collection… » lit un XML rekordbox ou un NML Traktor. Les morceaux sont rapprochés par leur
chemin. L’import peut se limiter aux morceaux de la bibliothèque ou inclure les fichiers audio accessibles.
Les cues importés sont verrouillés, les boucles reprises sont validées et les suggestions occupent les pads libres.
L'option BPM et grille relance l'analyse avec le BPM importé et le premier repère de grille disponible.

Dans le sens Traktor → CueKoda, les boutons 2–8 correspondent aux pads A–G. Si le bouton 1 porte un cue
plutôt qu'AutoGrid, il est repris sur le pad H s'il est libre, ou comme cue mémorisé. AutoGrid sert de repère
de grille. La collection source est lue sans être modifiée.

## Engine DJ, VirtualDJ, djay Pro (via rekordbox XML)
| Logiciel | Ce que CueKoda écrit | Import (libellés variables selon la version) |
|---|---|---|
| Engine DJ (Denon DJ, Numark, Rane) | rekordbox XML | Préférences › Library : activer la bibliothèque rekordbox, indiquer le fichier ; glisser les morceaux dans la Collection. Engine DJ lit aussi une collection Traktor (NML). |
| VirtualDJ | rekordbox XML | Paramètres › Options : chemin du fichier rekordbox XML ; dossier « rekordbox » du navigateur. |
| djay Pro | rekordbox XML | Réglages › Bibliothèque : intégration rekordbox, choisir le fichier. |

Chacun de ces logiciels choisit les données qu’il lit dans le fichier rekordbox XML.

Engine DJ documente officiellement l’import de bibliothèques rekordbox et Traktor. CueKoda conserve donc
ce parcours pris en charge au lieu d’écrire dans la base Engine : [compatibilité rekordbox XML](https://support.enginedj.com/support/solutions/articles/69000793756).

## Serato et playlist M3U8

CueKoda produit un fichier M3U8 UTF-8 ordonné contenant durée, artiste, titre et chemin de chaque morceau.
Ce format ne transporte ni grille, ni tonalité, ni cues, ni boucles. Serato documente l’ajout des morceaux
depuis son panneau **Files** et la création d’une crate par glisser-déposer : [importer de la musique dans Serato](https://support.serato.com/hc/en-us/articles/360000067236-Importing-Music).

Le M3U8 sert donc de liste portable et de référence d’ordre ; CueKoda n’écrit pas de fichier de crate et ne
touche pas au dossier `_Serato_`.

## Sécurité
- CueKoda n'écrit **jamais** dans une base propriétaire (rekordbox `master.db`, `collection.nml` de Traktor)
  ni dans les fichiers audio : il produit un nouveau fichier de collection.
- Si le fichier de destination existe, il est d'abord copié en `…backup-AAAA-MM-JJTHH-MM-SS`.
- La fenêtre d'export indique, avant d'écrire, ce qui sera transféré et ce qui ne le sera pas.
- La fusion avec des hot cues existants est gérée par le logiciel DJ au moment de l'import : CueKoda ne peut
  pas la garantir (voir les étapes d'import affichées dans la fenêtre d'export).

## Procédure de validation manuelle
1. Exporter 3 morceaux (dont un avec boucles validées).
2. rekordbox : importer via la vue « rekordbox xml », vérifier BPM, grille (temps 1), clé, 8 pads, noms,
   couleurs, memory cues et boucles.
3. Traktor : sauvegarder `collection.nml`, puis « Import Another Collection ». Vérifier AutoGrid sur le
   bouton 1, A–G sur les boutons 2–8, H dans les cues mémorisés, et tester un fichier sur un volume externe.
4. Lancer `npm run offset-test` et importer le XML et le NML générés. Mesurer le décalage entre les clics
   et les repères sur WAV, MP3 avec et sans en-tête gapless, et AAC dans les deux logiciels.
5. Faire un retour XML/NML vers CueKoda et vérifier les pads verrouillés, les boucles et l'option BPM/grille.
