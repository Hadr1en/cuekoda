# Validation moteur CueKoda 0.6.0

Date : 18 novembre 2026. Tous les calculs sont locaux. Aucun audio de corpus n’est versionné, téléchargé
par l’application ou modifié. Les sources, versions, licences et empreintes disponibles sont consignées dans
[`evaluation-corpora.json`](../scripts/evaluation-corpora.json).

## Décision

MusiCNN reste l’unique détecteur vocal distribué. Le réglage de production reste `on=0.35/off=0.25`.
Le candidat `on=0.10/off=0.07`, choisi sur les 16 titres du lot officiel Jamendo `valid`, a été évalué une
seule fois sur les 16 titres `test`, puis rejeté le 19 novembre 2026 : son gain de rappel ne compense pas la
chute de précision et le doublement des faux positifs. Le seuil `0.20` reste une piste expérimentale, pas un
réglage distribué, jusqu’à une validation temporelle sur un corpus plus large et représentatif des genres ciblés.

| Jamendo SVD | Précision | Rappel | F1 | IoU | Faux positifs |
|---|---:|---:|---:|---:|---:|
| Seuil 0.35/0.25 — validation | 0,78 | 0,66 | 0,72 | 0,56 | 351,0 s |
| Seuil 0.10/0.07 — validation | 0,71 | 0,93 | 0,80 | 0,67 | 699,5 s |
| Seuil 0.35/0.25 — test réservé | 0,81 | 0,73 | 0,77 | 0,63 | 326,6 s |
| Seuil 0.10/0.07 — test réservé (rejeté) | 0,71 | 0,93 | 0,80 | 0,67 | 759,8 s |

Sur l’ensemble validation+test, le candidat fait passer le F1 de 0,74 à 0,80 et le rappel de 0,70 à 0,93,
mais la précision passe de 0,80 à 0,71 et les faux positifs font plus que doubler. Il n’est donc pas retenu.
Le coût ne change pas matériellement : 8,19 s CPU, 12,66 s mur et 6,6 Mio de variation RSS
en moyenne par titre ; taille audio moyenne 3,5 Mio. Le modèle distribué ne change pas, donc la taille du paquet
reste identique.

Les résultats détaillés et reproductibles sont dans
[`MUSICNN_JAMENDO_RESULTS.json`](MUSICNN_JAMENDO_RESULTS.json) (référence) et
[`MUSICNN_JAMENDO_CANDIDATE_RESULTS.json`](MUSICNN_JAMENDO_CANDIDATE_RESULTS.json) (candidat rejeté).

## Familles rythmiques et structure

Le benchmark synthétique déterministe couvre les cas demandés. Il n’a produit aucune erreur ×2/÷2, aucun
faux drop sur les scénarios sans drop, et l’edit UK garage retrouve la reprise à 0,004 temps près. La reprise
après une coupure soutenue est maintenant conservée à sa position mesurée au lieu d’être déplacée vers une
phase de phrase incertaine.

| Cas | BPM | Phase | Temps 1 | Drop | CPU | RSS |
|---|---:|---:|---:|---:|---:|---:|
| Drum & Bass | 174/174 | 1,5 ms | correct | — | 890 ms | +26,6 Mio |
| Trap half-time | 140/140 | 3,4 ms | ambigu/faux | — | 656 ms | +4,4 Mio |
| UK garage, break + edit | 132/132 | 1,6 ms | correct | +0,004 temps | 1 625 ms | +29,5 Mio |
| Afro/Latin live sans drop | 120/120 | 3,4 ms | correct | 0 faux positif | 656 ms | −7,3 Mio |
| Hard techno | 200/200 | 3,4 ms | ambigu/faux | 0 faux positif | 1 500 ms | −7,3 Mio |

Les deux échecs de temps 1 sont conservés dans le rapport : une boucle parfaitement répétitive sans repère de
mesure rend les quatre phases musicalement équivalentes. Ils ne sont pas masqués comme des succès. Résultats
bruts : [`RHYTHM_BENCHMARK.json`](RHYTHM_BENCHMARK.json).

## Corpus et séparation des types vocaux

- [Jamendo Singing Voice](https://zenodo.org/records/2585988), version 1.0, 93 titres annotés par intervalles ;
  archive MD5 `4d6b907b224c6df3a5ed3ffc3e98b8b1`, vérifiée avant le test.
- [Google AudioSet](https://research.google.com/audioset/download.html), partition d’évaluation humaine :
  chant, rap/parole et foule sont chargés et rapportés séparément. Les labels de clip ne sont jamais présentés
  comme des frontières temporelles.
- [M-DJCUE](https://github.com/MZehren/M-DJCUE), commit figé : consensus d’au moins deux annotateurs distincts
  à ±0,5 s et conversion officielle des sources alternatives.
- [Raveform](https://raveform.netlify.app/), Harmonix, Groove, Ballroom, BRID et GiantSteps complètent la
  structure, le live, les rythmes syncopés, le beat/downbeat, le BPM et la tonalité.

AudioSet ne fournit pas les fichiers audio : son chargeur est prêt, mais aucun score chant/rap/foule n’est
inventé sans les segments légalement obtenus. Jamendo combine chant et parole dans une seule classe ; son
score est donc affiché comme type `unknown`, pas attribué artificiellement au chant ou au rap.

## Décalages d’export

| Encodage | Attaque vue par CueKoda | Décalage décodeur |
|---|---:|---:|
| WAV | 1,0000 s | 0,0 ms |
| MP3 avec en-tête LAME | 1,0000 s | 0,0 ms |
| MP3 sans en-tête Xing/LAME | 1,0250 s | +25,0 ms |
| AAC/M4A | 1,0000 s | 0,0 ms |

Les positions exportées rekordbox XML et Traktor NML sont relues automatiquement et restent exactement à
1,000 s et 9,000 s. Le 19 novembre 2026, le NML a aussi été importé dans Traktor Pro 3.5.1 : les quatre fichiers,
leurs BPM et leurs deux repères ont été acceptés. La référence WAV a été chargée dans le deck A ; les repères
1 et 2 sont visibles sur les transitoires attendus. Ce contrôle confirme l’interopérabilité réelle du NML, sans
prétendre à une mesure sous-pixel des autres décodeurs propriétaires. Rekordbox n’est pas installé. Le fichier
`cuekoda-offset-test/offset-results.json` conserve les mesures reproductibles du décodeur local et du round-trip
XML/NML ; les champs propriétaires non mesurés restent explicitement nuls.

## Garde-fous

- `npm run benchmark:rhythm` échoue sur une erreur BPM >2 %, une octave fausse, une phase >80 ms, un faux drop
  dans les scénarios sans drop ou un drop d’edit distant de plus de quatre temps.
- `npm run eval:compare` refuse une régression BPM globale ou par famille supérieure au seuil autorisé.
- `npm run corpora:verify` contrôle le commit Git ou la somme officielle avant une évaluation.
- Les métriques sont ventilées par famille Beatport, type vocal et scénario, avec précision, rappel, F1, faux
  positifs, CPU, mémoire et taille.

## Validation finale

| Commande | Résultat |
|---|---|
| `npm run typecheck` | succès |
| `npm run test:unit` | succès — 73/73 |
| `npm test` | succès — « TOUT PASSE » |
| `npm run smoke` | succès — 3/3 tours vidés |
| `npm run benchmark:rhythm` | succès — 5/5 cas, aucune erreur d’octave |
| `npm run offset-test` | succès — décodage et horodatages XML/NML |
