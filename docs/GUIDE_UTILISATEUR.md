# CueKoda — guide rapide

**CueKoda prépare, le DJ décide.** Tout est local ; vos fichiers audio ne sont jamais modifiés, déplacés
ni envoyés en ligne.

## 1. Importer
Glissez des fichiers ou un dossier dans la fenêtre (ou « + Fichiers » / « + Dossier »). Formats : mp3, wav,
flac, aiff, m4a, aac, ogg, opus, wma. Choisissez d'abord le **profil** (EDM, House, Tech House, Techno,
Trance, Hip-Hop, Open Format) : il règle la plage BPM, les types de cues prioritaires, les couleurs et les
boucles.

## 2. Analyser
L'analyse démarre seule, en parallèle. En-tête : progression globale, **Pause / Reprendre**, **Annuler**,
**Relancer les échecs**. Un fichier défectueux n'arrête jamais la file. Un fichier déjà analysé et inchangé
est repris du cache instantanément. La bibliothèque est conservée entre les sessions.

Pendant l'analyse, chaque ligne affiche une barre de progression et l'étape en cours (décodage, tempo, grille,
structure, voix, tonalité). L'en-tête nomme le morceau en cours. Un morceau en attente indique sa place dans
la file. Si vous sélectionnez un morceau en cours d'analyse, un bandeau le signale ; lors d'une ré-analyse,
l'analyse précédente reste affichée.

## 3. Vérifier et corriger
La colonne **Fiabilité** signale ce qu'il faut vérifier (forte / moyenne / faible). Cliquez un morceau :

- **Waveform** : sections (bandeau coloré), courbe d'énergie (orange), lignes de phrase (traits pleins),
  grille, boucles (bandes vertes), hot cues (drapeaux A–H). Molette = zoom, Maj+molette = défiler.
  **Glissez un drapeau** pour déplacer un cue (aimanté sur le temps ; Alt = libre).
- **BPM / Grille / Clé** (en haut à droite) : saisir un BPM, ÷2 / ×2, « Temps 1 ici », ±10 ms, +1 temps,
  choisir la tonalité (les alternatives plausibles sont indiquées). La correction relance l'analyse en
  conservant vos cues.
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
  section correspondante. **Voix** : corrigez les passages vocaux (ajouter à la lecture, début / fin à la
  mesure près, « Fin de voix ici », « Pause dans la voix ici », nette / faible, créer un cue Vocal). Vos
  passages remplacent la détection automatique lors des ré-analyses.
- **Mix & compatibles** : points Mix In / Mix Out justifiés (bouton « Créer un cue ») et morceaux
  compatibles (tonalité, BPM, énergie, fenêtres de transition).
- **Infos** : métadonnées du fichier, LUFS, true peak, détails de l'analyse.

Annuler / rétablir : ⌘Z / ⇧⌘Z. Toutes les modifications sont enregistrées automatiquement et **survivent à
une ré-analyse**.

## 4. Exporter
Dans « Exporter… », choisissez le logiciel et les options. L’aperçu récapitule les données transférées.
Enregistrez le fichier, puis suivez les étapes d’import affichées. L'option
« Énergie, clé et voix dans le commentaire » écrit par exemple « E8 · 8B · Vocal » dans le champ Commentaire,
pour trier par énergie dans votre logiciel DJ (si vous acceptez d'écraser les informations d'un morceau déjà
présent, son commentaire est remplacé). Voir
[MATRICE_EXPORT.md](MATRICE_EXPORT.md).

Dans Traktor, ouvre **Aperçu des boutons Traktor** dans l’export pour consulter les huit boutons et les
boucles mémorisées pour un titre.

## Contrôle express et comparaison
Dans le détail d’un morceau, **Contrôle express** lit quatre mesures au métronome au début, au premier
drop ou vers la fin. Raccourcis dans ce panneau **1 / 2 / 3** pour écouter, **T** pour placer le temps 1,
**[ / ]** pour décaler la grille de 10 ms et **V** pour valider et avancer.

Après une réanalyse, **Plus › Comparer la réanalyse…** liste les morceaux dont le BPM, la grille ou les
cues ont changé. Vous pouvez écouter les deux analyses et rétablir la précédente pour un morceau.

## Ordre de mix (suggestion)
« Ordre de mix… » (au-dessus de la liste) propose un ordre pour les morceaux affichés (filtrez d'abord si
besoin) selon un arc d'énergie (montée progressive, vagues ou libre) et la compatibilité tonalité / tempo.
Chaque enchaînement est noté et justifié ; les enchaînements difficiles sont signalés. Vous pouvez imposer
l'ouverture, monter / descendre des morceaux, écouter chaque transition (🎧) et copier la liste. Rien n'est
modifié ni exporté : c'est une piste de départ. « Exporter ce set… » ouvre l'export avec ces morceaux dans
cet ordre, en playlist nommée (le nom est modifiable).

## Mises à jour et langue
Réglages › Mises à jour : vérification au démarrage (désactivable), installation sur un clic. Réglages ›
Langue : français ou anglais.

## Autres outils
- **Doublons** : doublons exacts, même morceau dans un autre format, versions liées (remix / edit) —
  rien n'est supprimé.
- **Réglages** : profils personnalisés (dupliquer un profil intégré), nombre d'analyses en parallèle,
  dossiers surveillés (analyse automatique des nouveaux fichiers une fois copiés), apprentissage à partir
  de vos corrections (réinitialisable), thème.

## Raccourcis
Espace lecture · ←/→ une mesure (Maj : un temps) · ↑/↓ morceau · 1–8 aller au cue · Maj+1–8 poser le cue ·
Ctrl/⌘ + A sélectionner les morceaux affichés · Maj + ↑/↓ étendre la sélection · Suppr retirer les morceaux sélectionnés dans la bibliothèque ou supprimer le cue dans l’éditeur · , / . déplacer le cue d'un temps (Maj : une mesure) · C ajouter un cue ·
M ajouter une memory cue · L boucle de 16 temps ·
+ / − / 0 zoom · ⌘E exporter · ? aide.
