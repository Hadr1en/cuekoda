# Évaluation du moteur CueKoda v0.6.0

32 morceau(x) — jeu de données jamendo-vocal.
32 analyse(s) tentée(s), 0 échec(s) de l'analyse.
Les références du DJ ne sont pas exhaustives : pour les cues, le rappel compte plus que la précision.
Couverture du corpus : 32/180 titres cibles, 0/9 familles, 0/47 genres Beatport, 0/7 plages BPM.
Genres Beatport encore absents : 140 / Deep Dubstep / Grime, Afro House, Amapiano, Ambient / Experimental, Bass / Club, Bass House, Brazilian Funk, Breaks / Breakbeat / UK Bass, Dance / Pop, Deep House, DJ Edits, DJ Tools, Downtempo, Drum & Bass, Dubstep, Electro (Classic / Detroit / Modern), Electronica, Funky House, Hard Dance / Hardcore / Neo Rave, Hard Techno, House, Indie Dance, Indie Tech, Jackin House, Latin Electronic, Mainstage, Melodic House & Techno, Minimal / Deep Tech, Nu Disco / Disco, Organic House, Progressive House, Psy-Trance, Tech House, Techno (Peak Time / Driving), Techno (Raw / Deep / Hypnotic), Trance (Main Floor), Trance (Raw / Deep / Hypnotic), Trap / Future Bass, UK Garage / Bassline, Hip-Hop, Pop, R&B, Latin, African, Caribbean, Rock, Country.

| Mesure | Morceaux | Résultat |
|---|---|---|
| Voix : précision / rappel / F1 (durée) | 32 | 0.71 / 0.93 / 0.80 |
| Voix : IoU / calibration Brier | 32 | 0.67 / 0.203 |

## Coût mesuré

CPU moyen : 8190 ms · temps mur moyen : 12661 ms · variation RSS moyenne : 6.6 Mio · taille audio moyenne : 3.5 Mio.

## Résultats par famille

| Famille | Titres | BPM ±1 % | Beat F | Sections F1 | Voix P / R / F1 |
|---|---:|---:|---:|---:|---:|
| non renseigné | 32 | 0 % | 0.00 | 1.00 | 0.71 / 0.93 / 0.80 |

## Résultats par type vocal

| Type | Titres | Précision | Rappel | F1 | IoU | Brier |
|---|---:|---:|---:|---:|---:|---:|
| unknown | 32 | 0.71 | 0.93 | 0.80 | 0.67 | 0.203 |

## Calibration MusiCNN

Seuil du score fusionné choisi uniquement sur le lot validation : **0.1**. F1 sur validation : 0.79; F1 obtenu une seule fois sur le lot test : 0.81.
Ce candidat a été retenu après comparaison A/B ; la décision et le coût en faux positifs sont détaillés dans `ENGINE_VALIDATION_0.6.0.md`.
