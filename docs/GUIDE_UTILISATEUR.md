# CueKoda — guide rapide

L’analyse est effectuée localement. CueKoda conserve les fichiers audio à leur emplacement d’origine et enregistre les annotations séparément.

## 1. Importer
Déposer des fichiers ou un dossier dans la fenêtre (ou « + Fichiers » / « + Dossier »). Formats : mp3, wav,
flac, aiff, m4a, aac, ogg, opus, wma. Le BPM, la tonalité et la grille sont calculés automatiquement.
Le **profil de préparation** règle les suggestions de cues, de boucles et de transitions. Pour changer les
suggestions d’un morceau déjà analysé, utilisez **Appliquer le profil à la sélection** dans son menu contextuel.

## 2. Analyser
L'analyse démarre seule, en parallèle. En-tête : progression globale, **Pause / Reprendre**, **Annuler**,
**Relancer les échecs**. Un fichier défectueux n'arrête jamais la file. Un fichier déjà analysé et inchangé
est repris du cache instantanément. La bibliothèque est conservée entre les sessions.

Pendant l'analyse, chaque ligne affiche une barre de progression et l'étape en cours (décodage, tempo, grille,
structure, voix, tonalité). L'en-tête nomme le morceau en cours. Un morceau en attente indique sa place dans
la file. Un bandeau signale l’analyse de la piste sélectionnée. Lors d’une réanalyse, le résultat précédent reste affiché.

## 3. Vérifier et corriger
La colonne **Fiabilité** indique les pistes à examiner en priorité. La sélection d’un morceau ouvre son détail.

- **Waveform** : sections (bandeau coloré), courbe d'énergie (orange), lignes de phrase (traits pleins),
  grille, boucles (bandes vertes), hot cues (drapeaux A–H). Molette = zoom, Maj+molette = défiler.
  Le glissement d’un drapeau déplace le cue sur la grille. Maintenir Alt permet un déplacement libre.
- **BPM / Grille / Clé** (en haut à droite) : saisir un BPM, ÷2 / ×2, « Temps 1 ici », ±10 ms, +1 temps,
  choisir la tonalité (les alternatives plausibles sont indiquées). La correction relance l'analyse en
  conservant les cues modifiés ou verrouillés.
- **Hot cues** : renommer, changer la couleur, ±1 temps / ±1 mesure, 🔒 verrouiller, ✕ supprimer, poser
  un pad libre à la position de lecture. Chaque cue indique sa confiance et pourquoi il a été placé.
  **« + Cue ici »** ajoute un cue du type choisi (Vocal par défaut, par exemple quand la voix reprend) sur
  le premier pad libre. Quand les 8 pads sont pris, il devient une **memory cue** (cue sans pad, exportée
  dans rekordbox et Traktor). « + Memory cue ici » en crée une directement. La liste des memory cues permet
  de les renommer, déplacer, supprimer ou placer sur un pad.
- **Boucles** : écouter, changer la longueur, **valider** (seules les validées s'exportent par défaut),
  ajouter à la position de lecture.
- **Structure** : changer le type ou le nom d'une section, déplacer son début, la supprimer (fusion),
  scinder à la position de lecture. Déplacer un cue Intro / Build / Drop / Break / Outro déplace aussi la
  section correspondante. **Voix** : modifier les passages vocaux (ajouter à la lecture, début / fin à la
  mesure près, « Fin de voix ici », « Pause dans la voix ici », nette / faible, créer un cue Vocal). Les passages corrigés remplacent la détection automatique lors des réanalyses.
- **Mix & compatibles** : points Mix In / Mix Out justifiés (bouton « Créer un cue ») et morceaux
  compatibles (tonalité, BPM, énergie, fenêtres de transition).
- **Infos** : métadonnées du fichier, LUFS, true peak, détails de l'analyse.

Annuler / rétablir : ⌘Z / ⇧⌘Z. Toutes les modifications sont enregistrées automatiquement et **survivent à
une ré-analyse**.

## 4. Exporter
Dans « Exporter… », sélectionner le logiciel et les options. L’aperçu récapitule les données transférées.
Enregistrer le fichier, puis suivre les étapes d’import affichées. L'option
« Énergie, clé et voix dans le commentaire » écrit par exemple « E8 · 8B · Vocal » dans le champ Commentaire,
pour le tri par énergie dans le logiciel DJ. Le commentaire d’un morceau déjà présent est remplacé si l’écrasement est autorisé lors de l’import. Voir
[MATRICE_EXPORT.md](MATRICE_EXPORT.md).

Pour un export NML, **Aperçu des boutons Traktor** présente les huit boutons et les boucles mémorisées du morceau sélectionné.

## Contrôle express et comparaison
Dans le détail d’un morceau, **Contrôle express** lit quatre mesures au métronome au début, au premier
drop ou vers la fin. Raccourcis dans ce panneau **1 / 2 / 3** pour écouter, **T** pour placer le temps 1,
**[ / ]** pour décaler la grille de 10 ms et **V** pour valider et avancer.

Après une réanalyse, **Plus › Comparer la réanalyse…** liste les morceaux dont le BPM, la grille ou les
cues ont changé. La comparaison permet d’écouter les deux analyses et de rétablir la précédente pour chaque morceau.

## Bacs de préparation
Sélectionner les morceaux, puis utiliser le menu contextuel › **Ajouter à un bac…**. Le bouton **Bacs…** permet
ensuite de réordonner, filtrer et exporter chaque bac en playlist. Le bac conserve l’ordre choisi.
Dans la bibliothèque filtrée sur un bac, **Suppr** retire uniquement l’appartenance au bac.

## Ordre de mix (suggestion)
« Ordre de mix… » (au-dessus de la liste) propose un ordre pour les morceaux affichés (avec le filtre actif, le cas échéant) selon un arc d'énergie (montée progressive, vagues ou libre) et la compatibilité tonalité / tempo.
Chaque enchaînement reçoit un score et une justification. Les transitions difficiles sont signalées. La liste permet de choisir le morceau d’ouverture, de réordonner les pistes, d’écouter les transitions et de copier la sélection. « Exporter ce set… » ouvre l'export avec ces morceaux dans
cet ordre, en playlist nommée (le nom est modifiable).

## Mises à jour et langue
Réglages › Mises à jour : vérification au démarrage (désactivable), installation sur un clic. Réglages ›
Langue : français ou anglais.

## Autres outils
- **Doublons** : doublons exacts, même morceau dans un autre format, versions liées (remix / edit) —
  rien n'est supprimé.
- **Réglages** : profils personnalisés (dupliquer un profil intégré), nombre d'analyses en parallèle,
  dossiers surveillés (analyse automatique des nouveaux fichiers une fois copiés), apprentissage à partir
  des corrections manuelles (réinitialisable), thème.

## Raccourcis
Espace lecture · ←/→ une mesure (Maj : un temps) · ↑/↓ morceau · 1–8 aller au cue · Maj+1–8 poser le cue ·
Ctrl/⌘ + A sélectionner les morceaux affichés · Maj + ↑/↓ étendre la sélection · Suppr retirer les morceaux sélectionnés dans la bibliothèque ou supprimer le cue dans l’éditeur · , / . déplacer le cue d'un temps (Maj : une mesure) · C ajouter un cue ·
M ajouter une memory cue · L boucle de 16 temps ·
+ / − / 0 zoom · ⌘E exporter · ? aide.
