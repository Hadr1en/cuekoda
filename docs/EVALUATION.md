# Évaluation du moteur CueKoda v0.4.0

3 morceau(x) — références vérifiées par le DJ.
Les références du DJ ne sont pas exhaustives : pour les cues, le rappel compte plus que la précision.

| Mesure | Morceaux | Résultat |
|---|---|---|
| BPM à ±1 % | 3 | 100 % (0 erreur(s) d'octave) |
| Erreur de phase de grille (médiane) | 2 | 0.4 ms |
| Premier temps correct | 2 | 100 % |
| Cues au bon temps (±40 ms, même type) : rappel | 3 | 67 % |
| Cues au bon temps : F1 | 3 | 0.53 |
| Cues à ±1 temps : F1 (écart moyen) | 3 | 0.60 (0.11 temps) |

## Résultats par morceau

| Morceau | Cues à ±40 ms | Cues à ±1 temps |
|---|---:|---:|
| Martin Garrix — *This Dream of You* | 4/5 | 4/5 |
| Alesso — *Heroes (we could be)* | 2/4 | 3/4 |
| Sebastian Ingrosso & Alesso — *Calling (Lose My Mind)* | 2/3 | 2/3 |
| Total | 8/12 | 9/12 |

Le moteur 0.3.3 retrouvait aussi 8 cues sur 12 à ±40 ms sur ces références. Le corpus contient trois
morceaux et des annotations partielles. Deux d'entre eux ont une grille annotée.

| Cue hors tolérance à ±40 ms | Référence | Écart du cue proposé |
|---|---:|---|
| *This Dream of You* — Vocal | 16,612 s | Aucun cue de ce type |
| *Heroes* — Intro | 35,288 s | 71 temps en avance |
| *Heroes* — Drop 1 | 104,812 s | 1 temps en avance |
| *Calling* — Vocal | 74,837 s | Aucun cue de ce type |

Sur les 13 morceaux de non-régression, quatre cues Vocal disparaissent et le Break de *This Dream of You*
passe de 200,36 s à 140,36 s, avec la frontière de section déplacée de la mesure 106 à la mesure 74.
La moyenne des scores d'énergie passe de 8,0 à 7,9 et l'écart-type de 0,30 à 0,37.
