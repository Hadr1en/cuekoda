# Décision historique — YAMNet

Date : 17 novembre 2026. Ce document conserve uniquement la conclusion de l’expérience ; YAMNet, ses poids et son code d’intégration ont été retirés de CueKoda.

## Protocole

- 183 titres issus des corpus officiels Electrobyte et Jamendo SVD ;
- calibration sur 121 titres `train` uniquement ;
- décision sur 62 titres `validation + test` jamais utilisés pour régler les seuils ;
- comparaison voix / non-voix sur des fenêtres fixes de 1 seconde.

## Résultats tenus à l’écart

| Détecteur | Précision | Rappel | F1 | Taux de faux positifs |
|---|---:|---:|---:|---:|
| MusiCNN actuel | 81,3 % | 65,3 % | 72,4 % | 14,2 % |
| YAMNet calibré | 76,2 % | 58,2 % | 66,0 % | 17,2 % |
| MusiCNN + YAMNet | 81,5 % | 67,3 % | 73,7 % | 14,5 % |

La combinaison gagnait seulement 1,3 point de F1. Elle ajoutait 14,27 Mio au paquet et, sur 180 secondes de signal, environ 40 % de temps mur, 21 % de CPU et 13 % de mémoire par rapport à MusiCNN seul.

## Décision

Le gain a été jugé trop faible face au coût, à la taille et à la complexité de maintenance. CueKoda conserve donc MusiCNN seul, avec ses seuils actuels. YAMNet n’est ni distribué, ni chargé, ni sélectionnable par variable d’environnement.

Les archives audio d’évaluation restent hors du dépôt et aucun fichier audio n’a été modifié.
