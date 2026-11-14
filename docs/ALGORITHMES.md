# Algorithmes de CueKoda et leurs limites

Moteur v0.3.1 (`ENGINE_VERSION`). Tout s'exécute localement (CPU). Les niveaux de confiance sont
**qualitatifs** (forte / moyenne / faible) : ils ne sont pas encore calibrés sur un corpus annoté et ne
doivent pas être lus comme des probabilités.

## Décodage et métadonnées — `decode.ts`, `analyzer.ts`
- ffmpeg décode tout format courant en mono 44,1 kHz ; **dans la même passe**, le filtre `ebur128` mesure
  la loudness intégrée (LUFS), la plage de loudness (LRA) et le true peak sur les canaux d'origine.
- RMS et facteur de crête sont calculés sur le mixage mono.
- Les tags (titre, artiste, BPM/clé déjà tagués, format, codec, canaux, débit) viennent de
  music-metadata et sont affichés **séparément** des résultats d'analyse.
- Fichier illisible ou < 5 s → erreur explicite ; fichier > 20 min (mix) → ignoré.

## Tempo — `rhythm.ts`
1. Estimation grossière par Essentia `RhythmExtractor2013` sur 2 min centrales (Essentia exige 44,1 kHz).
2. Repli dans la plage BPM du profil (×2 / ÷2).
3. **Validation** : score d'alignement de grille sur l'enveloppe d'attaques pour les ratios ×1, ×3/2, ×2/3,
   ×4/3, ×3/4. Essentia n'est remplacé que si un autre candidat s'aligne ≥ 15 % mieux, jamais arbitrairement.
4. Affinage au centième par régression robuste (Theil-Sen) des attaques mesurées dans le domaine temporel,
   puis arrondi à un tempo entier / demi-entier seulement si l'ajustement est aussi bon.
5. **Stabilité** : tempo de chaque segment de 64 temps estimé **indépendamment** (alignement de grille à ±8 %
   du tempo global ; segments sans pulsation nette ignorés) ; écart > 1 % → « tempo variable ». Sur les 13
   morceaux réels, l'écart local maximal est de 0,43 BPM : aucun faux « variable ».
6. **Marqueurs de tempo** (`tempomap.ts`, seulement si « variable ») : segments regroupés en plages de tempo
   constant (±0,4 %), grille précise par plage (phase cherchée au pas de 4 ms sur l'enveloppe d'attaques), puis
   point de bascule cherché temps par temps (16 temps de chaque grille, fenêtre ±10 ms). Mesuré sur un
   enchaînement synthétique 124 → 128 BPM : bascule à 4 ms près, temps 1 correct.
- Confiance : forte si grille ≥ 70 % alignée, tempo stable et accord avec Essentia ; faible si tempo variable
  ou grille < 40 % ; moyenne sinon. Alternatives ÷2, ×2 et l'estimation brute proposées en un clic.
- **Limites** : la structure, les cues et les boucles restent calculés sur la grille moyenne (un morceau à tempo
  variable peut avoir des cues décalés, à vérifier) ; tempo en dérive continue (live) → nombreux petits
  segments non garantis ; l'ambiguïté ×2 dépend de la plage du profil.

## Grille et premier temps
- Phase par alignement sur l'enveloppe d'attaques, précision mesurée ~2 ms sur signaux de test.
- Downbeat : deux votes sur la position dans la mesure, fenêtres d'un temps (trames entièrement dans le
  temps), en ignorant la première mesure audible (artefact de début de fichier) :
  1. frontières de section fortes ;
  2. **entrées de kick / basse** : le temps où les graves *atteignent* leur plateau (à 2 dB près) après une
     montée d'au moins 6 dB. Une nappe qui gonfle progressivement ne compte pas, seul le temps du plateau compte.
     Ce vote pèse 75 % quand il est fourni (≥ 12 dB d'entrées cumulées).
  Si le vote n'est pas décisif (< 1,5× le second), le meilleur candidat est gardé avec l'avertissement
  « downbeat incertain ». Le repli « le morceau commence sur un temps 1 » ne sert qu'en l'absence totale
  d'indice. Ce réglage a été validé sur 3 morceaux corrigés à l'oreille (Garrix, Alesso, Ingrosso).
- Correction manuelle : BPM imposé, premier temps imposé, décalage ±10 ms ou ±1 temps → ré-analyse.

## Tonalité — `analyzer.ts`, `key.ts`
- Essentia `KeyExtractor` (profil `edma`) sur 3 extraits de 50 s, vote pondéré par la force.
- Si les votes divergent : **analyse complémentaire** (profils `bgate` et `temperley` sur 2 min) ; si le
  désaccord persiste, résultat marqué **ambigu** avec ses alternatives plutôt qu'une fausse précision.
- Notations : musicale, Camelot, Open Key. Correction manuelle parmi les 24 tonalités.

## Structure, phrases, sections — `structure.ts`
- Caractéristiques par mesure (trames entièrement contenues dans la mesure, pour éviter qu'une attaque
  voisine ne « fuie ») : énergie, graves < 130 Hz, brillance, activité de kick.
- « Groove présent » jugé **relativement au niveau des drops du morceau** (p90), avec hystérésis.
- Repères : retour du groove après ≥ 4 mesures calmes, entrée de basse (+3 dB, validée par médiane pour
  ignorer les impacts isolés), riser (pente de brillance), fin de pleine énergie (outro), arrêt du kick.
- **Drops par palier d'énergie** (prioritaires) : un drop est une zone où la courbe d'énergie (médiane sur
  3 mesures) reste ≥ 90 % de son 90ᵉ centile pendant **au moins 12 mesures** (trous ≤ 2 mesures fermés).
  - Une zone dont les graves sont nettement plus faibles que ceux du drop le plus lourd est écartée :
    quartile bas des 8 premières mesures plus de 2,5 dB en dessous. Cela exclut un couplet avec batterie
    joué avant le vrai drop.
  - Position : la mesure où les graves atteignent le plateau du drop après un creux (la coupure d'une
    mesure avant le drop ne gagne pas). Ce point mesuré n'est pas recalé sur les phrases. À défaut, c'est
    le plus fort changement montant.
  - Le breakdown est la zone sous le palier *entre* les deux drops.
  - S'il n'y a aucune baisse d'énergie en fin de morceau, l'outro est le plus fort changement de section
    16, 24… mesures après le dernier drop.
  - Repli si aucun palier n'est trouvé : ancienne logique (entrée de basse, retour du groove).
- Positions calées sur la grille de phrases dont la phase est votée par les changements forts, sauf
  quand un changement net (≥ moitié du plus fort changement montant) donne la position exacte.
- **Phrases** : 32, 16 ou 8 mesures seulement si ≥ 60 % de la force des changements tombe sur la grille ;
  sinon « pas de phrasé régulier » (aucune ligne affichée).
- **Sections** : repères + changements forts → timeline. Vocabulaire EDM (build / drop / breakdown) ou
  générique (« section principale », « break ») selon le profil. Une section couverte à ≥ 50 % par un
  passage vocal **net** reçoit le suffixe « · voix ». Couplet / refrain ne sont proposés que sur preuve
  forte (voir *Détection vocale*) ; sinon ils ne sont pas devinés.
- **Limites** : calibré sur de la musique électronique ; les morceaux sans contraste d'énergie (ambient,
  certains morceaux live) donnent peu de sections et une confiance faible.

## Énergie — `energy.ts`
- Par mesure, sur des échelles **absolues** (comparables entre morceaux) : loudness RMS (45 %), densité
  d'attaques (25 %), poids des graves (15 %), brillance (15 %). Score 1–10 = 75ᵉ percentile.
- Événements : montées / baisses (|Δ| ≥ 0,12 sur moyennes de 4 mesures), pic (fenêtre de 8 mesures).
- **Limites** : estimation algorithmique, pas une mesure objective ; les productions EDM très compressées
  se regroupent entre 7,5 et 9.

## Smart Cues — `cues.ts`
- Candidats = repères détectés + suggestions Mix In / Out + entrées de voix (jamais d'intervalles
  réguliers). Entrées de voix : début des passages vocaux de ≥ 4 mesures (2 au plus), calé sur la grille
  de 4 mesures s'il est à ±1 mesure ; confiance moyenne (passage net) ou faible, jamais forte. Le type
  « vocal » est en dernière priorité dans les profils EDM / house / techno / trance : il ne déplace jamais
  un repère structurel proche.
- Sélection par profil : exclusions, suppressions apprises, priorité, nombre maximum, écart minimal
  (pas de marqueurs redondants), puis pads chronologiques ou par priorité. Nom, couleur par fonction,
  confiance et justification par cue.

## Smart Loops — `loops.ts`
- Intro / outro rythmiques (kick sur ≥ 75 % des mesures) : plus longue longueur autorisée qui tient.
- 1 mesure juste avant chaque drop ; début de breakdown (optionnel). Toujours calées sur la mesure.
- Proposées non validées ; seules les boucles validées sont exportées par défaut.

## Mix In / Mix Out — `mix.ts`
- Mix In : début d'intro (longueur jusqu'au premier changement, rythmique ou non), entrée plus tardive sur
  un début de phrase si l'intro est longue, entrée du kick.
- Mix Out : début d'outro ; N mesures avant la fin (N = durée de transition du profil), jamais dans les
  8 premières mesures d'un drop, seulement si l'outro est absente ou courte.
- Voix : chaque fenêtre porte `vocals` = none / light / strong / unknown et sa raison le dit (« aucune voix
  détectée », « voix possible », « voix nette — éviter de superposer avec un passage chanté »). Une voix
  nette fait perdre un niveau de confiance. Si toutes les sorties sont chantées, une sortie supplémentaire
  « fin instrumentale » (≥ 8 mesures sans voix détectée, après le dernier drop) est proposée.
  `unknown` (pas de contenu harmonique mesurable) n'ajoute rien : l'absence de preuve n'est pas présentée
  comme « instrumental ».
- Matching : si la sortie de A et l'entrée de B sont toutes deux « voix nette », avertissement « éviter de
  superposer les deux passages chantés » et −5 points.
- **Limite** : la détection vocale n'est pas validée et manque encore des voix (voir ci-dessous) :
  « aucune voix détectée » ne garantit pas une fenêtre instrumentale.

## Détection vocale — `vocalModel.ts` + `vocals.ts` (expérimentale, non validée)

CueKoda est un logiciel **gratuit et non commercial** : cela rend utilisable le modèle d'Essentia, sous
licence CC BY-NC-SA 4.0, qui était écarté en v0.3.0.

### Options évaluées (hors ligne, compatibles worker_threads Node, aucun réseau à l'analyse)

| Option | Licence | Taille | CPU mesuré / morceau | Localisation | Verdict |
|---|---|---|---|---|---|
| **Modèle Essentia `voice_instrumental-musicnn-msd-2`** (MTG, TensorFlow.js) + backend WebAssembly de TensorFlow.js | poids CC BY-NC-SA 4.0 (MTG) — compatible avec un logiciel gratuit non commercial ; tfjs Apache-2.0 | modèle 3,2 Mo ; `@tensorflow/tfjs` + `tfjs-backend-wasm` (fichiers .wasm de quelques Mo) | **~5–10 s** (morceaux de 3 à 5,5 min, 1 cœur) | fenêtres de 3 s ; entraîné sur 1000 extraits étiquetés **par extrait** | **retenu, signal principal** |
| Heuristique spectrale maison (fluctuation de hauteur cohérente, d'après le « fluctogram » de Lehner et al., ICASSP 2014) | code du projet | 0 | ~0,4–0,5 s | à la mesure | **retenue en complément** (bords à la mesure) et en **repli** si le modèle est absent |
| Même modèle, backend TensorFlow.js « cpu » (pur JS) | idem | idem | ~300 s | — | écarté : 30× trop lent |
| Même modèle, backend WebAssembly avec gros lots | idem | idem | — | — | plante (« memory access out of bounds ») : lots de 4 fenêtres |
| Séparation de sources (Spleeter, Demucs) | MIT | ~75–300 Mo + runtime | ordre de grandeur temps réel (non mesuré) | fine | écarté : coût ; à revoir avec Stems (§16) |
| VAD parole (Silero, ONNX) | MIT | ~2 Mo | — | fine | écarté : parole, pas chant mixé |

Sources : [modèles Essentia](https://essentia.upf.edu/models.html), [revue sur la détection de voix
chantée, 2018](https://arxiv.org/pdf/1806.01180). Les lignes Spleeter / Demucs / Silero sont des ordres de
grandeur documentaires, pas des mesures.

### Algorithme
1. **Modèle** (`vocalModel.ts`) : signal 44,1 kHz → 16 kHz (sinc fenêtré, 32 points) → log-mel MusiCNN
   (Hann 512, pas 256, 96 bandes Slaney, log10(1 + 10000·x)) recalculé en JS — **identique à Essentia**
   à 10⁻³ près (test unitaire), 5× plus rapide que l'appel WASM par trame → fenêtres de 187 trames (3 s)
   **sans recouvrement** → P(voix) par fenêtre (backend WebAssembly, lots de 4). Modèle lu dans
   `models/voice_instrumental-musicnn-msd-2/` ; jamais téléchargé pendant l'analyse.
2. **Heuristique** (`vocals.ts`) : STFT 2048 / pas 512 à 22,05 kHz, log-magnitude en 25 cents de 400 Hz à
   4 kHz, 5 bandes d'une octave ; décalage de hauteur entre trames t−2 et t par corrélation (±100 cents).
   Une bande « bouge » si son décalage reste entre 5 et 90 cents / 46 ms pendant ≥ 2 trames ; trame
   vocale si ≥ 2 bandes bougent dans le même sens. Score par mesure = part de trames vocales, pénalisée
   pour un mouvement à sens unique (risers).
3. **Fusion par mesure** : P(voix) du modèle moyennée sur les fenêtres qui recouvrent la mesure, puis
   `0,7 × modèle (0,5 → 0, 0,9 → 1) + 0,3 × heuristique (0 → 0, 0,4 → 1)`. Le modèle décide : l'heuristique
   seule ne peut pas déclarer une voix quand le modèle est indécis (P ≤ 0,5).
4. Lissage médian 3 mesures, hystérésis (0,35 / 0,25 ; heuristique seule : 0,20 / 0,13), trous d'une
   mesure comblés, passages < 2 mesures supprimés ; passage « net » si score moyen ≥ 0,55 (0,32).
5. Confiance : **moyenne au mieux** (passage net ≥ 4 mesures), sinon faible — jamais forte tant que rien
   n'est validé sur des annotations horodatées. `method` indique le détecteur utilisé ; `modelCurve` et
   `heuristicCurve` gardent les deux signaux par mesure.
6. **Repli** : modèle absent, `CUEKODA_VOCAL_MODEL=0` ou échec du backend → heuristique seule, signalée
   dans la note (« Heuristique seule »). La clé de cache inclut la présence du modèle.

### Couplet / refrain
Uniquement sur les sections que la structure n'a pas nommées (`section`) : ≥ 2 sections de ≥ 8 mesures
couvertes à ≥ 75 % par des passages **nets**, avec un écart d'énergie ≥ 0,12 → les plus énergiques
« Refrain », les autres « Couplet », confiance faible (pas d'analyse de répétition). Drops / breakdowns
nommés par la structure ne sont jamais renommés. Sur les 13 échantillons réels : jamais déclenchée.

### Mesures (2026-11-14, moteur 0.3.1)
Part des mesures marquées « voix » :

| Morceau | Heuristique seule (0.3.0) | Modèle + heuristique (0.3.1) |
|---|---|---|
| Calling (ft. Ryan Tedder) | 32 % | **62 %** (dont 52 % nets) |
| Don't You Worry Child (ft. John Martin) | 8 % | **58 %** (25 % nets) |
| This Dream of You | 30 % | 36 % (14 % nets) |
| Heroes (ft. Tove Lo) | 67 % | 25 % (faibles uniquement : le modèle hésite, P ≈ 0,5–0,7) |
| Too Soon (feat. Nymbius) | 0 % | 0 % (P ≈ 0,3 partout : voix rare ou très traitée ? non vérifié) |
| Dolce Vita, Live The Life, Hustle (présumés instrumentaux) | 0 % | 0 % |
| Dream Chaser, We Are One, Replicant World (présumés instrumentaux) | 0 % | 2 %, 2 %, 10 % (faibles) |
| Fantasy, We Are (statut inconnu) | 42 %, 11 % | 53 %, 31 % |
| Voix synthétique (test e2e) | passage exact 16–32 | passage exact 16–32 (repli testé aussi) |
| Synthétiques sans voix | 0 | 0 |

Temps d'analyse total : ~9–15 s par morceau avec le modèle, contre ~4 s sans (1 cœur par morceau ; la
file en lance plusieurs en parallèle). Les statuts « chanté » / « présumé instrumental » viennent des
crédits et non d'une écoute vérifiée ; **aucune annotation horodatée** : précision et rappel ne sont
pas mesurés, et les seuils ont été choisis sur ces mêmes morceaux (risque de sur-ajustement).

### Limites connues
- Le modèle a appris sur des extraits étiquetés globalement : il dit « ces 3 s sonnent chantées », pas
  où la voix commence ; la précision à la mesure vient de l'heuristique et reste approximative.
- Voix très traitées, hachées (vocal chops) ou au second plan : souvent faibles ou manquées (Heroes).
- Leads synthétiques expressifs : peuvent donner des passages faibles (Replicant World).
- « Aucune voix détectée » ne prouve pas qu'un passage est instrumental.

### Crédits
Modèle `voice_instrumental-musicnn-msd-2` : Music Technology Group, Universitat Pompeu Fabra (Pablo
Alonso, 2020), licence [CC BY-NC-SA 4.0](https://essentia.upf.edu/models.html), texte complet dans
`models/voice_instrumental-musicnn-msd-2/LICENSE`. Référence : Alonso-Jiménez, Bogdanov, Pons, Serra,
« Tensorflow Audio Models in Essentia », ICASSP 2020. Usage commercial exclu sans licence MTG.

## Fusion avec les corrections — `merge.ts`
Une ré-analyse conserve : cues `user` ou verrouillés (et leurs pads), boucles validées / `user` /
verrouillées, timeline de sections dès qu'elle a été éditée. Les suggestions automatiques ne remplissent que
les trous.

- Les **memory cues** (cues sans pad, ajoutées par « + Memory cue » ou quand les 8 pads sont pleins) sont
  conservées comme les autres cues du DJ.
- Les **passages vocaux** corrigés (Structure → Voix) remplacent ceux du détecteur à chaque ré-analyse ;
  les courbes du détecteur restent celles de la nouvelle analyse.
## Matching — `matching.ts`
Score sur 100 : relation Camelot (même, ±1, relative, +2, diagonale), écart de tempo (y compris
demi/double), écart d'énergie, longueur des fenêtres outro / intro. Chaque critère est justifié.

## Doublons — `duplicates.ts`
- Exact : même SHA-256 du contenu.
- **Empreinte acoustique** (`fingerprint.ts`) : chromagramme (12 classes de hauteur, 65 Hz–2 kHz) moyenné par
  mesure, quantifié sur 0–255 ; comparaison par corrélation centrée (Pearson) mesure à mesure, au meilleur
  décalage (±64 mesures), seulement à tempo égal (±1 %).
- Même enregistrement, autre fichier ou encodage : ≥ 90 % des mesures concordent sur ≥ 80 % de la durée.
- Versions liées : ≥ 16 mesures consécutives identiques (radio edit / extended…), ou même titre de base.
  Explicitement « pas des doublons ».
- Calibrage (13 morceaux réels + copie réencodée en AAC + version coupée de 30 s) : réencodage 115 mesures
  consécutives / 100 % ; version coupée 67 mesures / 72 % ; 78 paires de morceaux différents : **2 mesures
  au maximum**, ≤ 5 %. Analyses antérieures sans empreinte : ancienne règle (durée, tempo, tonalité, énergie).
- Rien n'est jamais supprimé.

## Apprentissage — `learning.ts`
Statistiques locales par type de cue (proposé / supprimé / déplacé). Un type supprimé dans ≥ 80 % de
≥ 5 propositions n'est plus proposé. Réinitialisable. Pas de modèle opaque.

## Cache
Clé = SHA-256 du fichier + version du moteur + profil + corrections + suppressions apprises.
Un fichier inchangé n'est pas ré-analysé ; une nouvelle version du moteur invalide le cache.

## Validation
| Mesure | Jeu | Résultat (v0.2.0, v0.3.0 pour la voix) |
|---|---|---|
| BPM | 2 morceaux synthétiques (128, 174 BPM) | exact |
| Phase de grille | idem | 2,0 / 2,1 ms |
| Tonalité | idem (Am, C) | exacte |
| Frontières de sections / cues | idem | exactes à la mesure près (tolérance 0) |
| Non-régression | 13 morceaux réels (`samples/`) | référence v0.3.1 ; écarts vs v0.2.0 / v0.3.0 limités aux cues « Vocal » (tempo, clé, grille, sections inchangés) |
| Voix | voir *Détection vocale* | exacte sur synthétique ; nettement meilleure avec le modèle sur voix réelles, non mesurée faute d'annotations |
| Temps d'analyse | 9 morceaux réels, 3 workers | 17,8 s au total ; 58 ms depuis le cache |

La référence de non-régression détecte les changements, elle ne mesure pas la justesse.

### Évaluation sur références vérifiées (`evaluate.ts`, `npm run eval`)
Dans l'app, onglet Infos › « Valider comme référence » enregistre l'état d'un morceau **après vérification à
l'oreille** (BPM, temps 1, clé, cues, sections, voix, ressenti d'énergie optionnel). `npm run eval` ré-analyse
chaque référence **sans les corrections ni le cache** et mesure : BPM à ±1 % et erreurs d'octave, erreur de
phase de grille (médiane), temps 1 correct, tonalité (score MIREX : 1 exacte, 0,5 quinte, 0,3 relative,
0,2 parallèle), F1 des hot cues à ±1 temps, F1 des frontières de sections à ±1 mesure, corrélation de
Spearman entre le score d'énergie et le ressenti. Contrôlé sur vérité terrain synthétique (BPM exact, phase
2 ms, clé exacte, cues 7/7, sections 6/6). **Aucune référence réelle n'est encore enregistrée** : ce sont ces
mesures qui permettront de calibrer les confiances et l'échelle d'énergie.
