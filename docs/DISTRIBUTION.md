# Distribution et mises à jour

Le dépôt est public. L'application interroge l'API GitHub Releases sans authentification. Si le dépôt
devient privé, les utilisateurs autorisés devront télécharger les installeurs depuis GitHub et les
installer manuellement. [API GitHub Releases](https://docs.github.com/en/rest/releases/assets)

## Intégrité des mises à jour

CueKoda exige une empreinte `sha256:` suivie de 64 caractères hexadécimaux pour l'installeur de la
plateforme courante. Une empreinte absente ou invalide bloque la mise à jour dès sa détection. Avant
installation, la taille et le SHA-256 calculés doivent correspondre aux valeurs publiées par GitHub.
Ce mécanisme vérifie l'intégrité du téléchargement. GitHub fournit à la fois le fichier et l'empreinte,
donc l'application dépend de GitHub pour l'authenticité des deux.

## Signature des artefacts proposée

1. Signer les installeurs définitifs avec Minisign et publier leurs fichiers `.minisig`. Garder la clé
   privée hors du dépôt, de l'application et des identifiants utilisés pour publier les releases.
2. Embarquer la clé publique dans l'application. Vérifier la signature avec un vérificateur compatible
   sur macOS et Windows, après contrôle de l'empreinte et avant ouverture ou exécution de l'installeur.
   Refuser les signatures absentes ou invalides. Lier la signature au numéro de build, par exemple via
   un manifeste signé qui nomme chaque artefact, sa plateforme, sa taille et son SHA-256.
3. Définir la rotation de clé et le canal de distribution de la première version qui impose la signature.
   Valider les cas d'artefact modifié, de fichier signé par une autre clé et de manifeste d'un ancien build.

[Documentation Minisign](https://github.com/jedisct1/minisign)

## Décisions avant diffusion

| Décision | Préparation |
|---|---|
| Visibilité du dépôt | Le canal actuel repose sur les releases publiques. Si la visibilité change, revoir l'accès aux mises à jour, les logs Actions, les artefacts et la disponibilité du code source correspondant. `samples/` contient des morceaux d'artistes et doit rester local. |
| macOS | Prévoir un certificat **Developer ID Application**, activer Hardened Runtime avec les entitlements adaptés à Electron, puis notariser et agrafer le ticket au DMG. Tester Gatekeeper sur un Mac propre avant la diffusion. |
| Windows | Choisir une identité de signature Authenticode, signer l'application et l'installeur NSIS en SHA-256 avec horodatage RFC 3161, puis vérifier les signatures et tester l'installation sur une machine propre. |
| Licences | Le code CueKoda déclare GNU AGPL v3 ou ultérieure et intègre Essentia.js sous AGPL. Vérifier les obligations de redistribution et de fourniture du code source correspondant. ONNX Runtime est sous licence MIT. Confirmer auprès du MTG les conditions exactes de redistribution du graphe TensorFlow.js d’origine **et de sa conversion ONNX**, ou choisir de retirer ou remplacer le modèle pour la diffusion. |

Le site Essentia annonce CC BY-NC-SA 4.0 pour les modèles du MTG. Le fichier `LICENSE` embarqué avec
`voice_instrumental-musicnn-msd-2` mentionne « NoDerivatives » dans son résumé et renvoie à
« ShareAlike » dans le lien qui suit. Ces indications divergent sur le droit de partager une adaptation,
ce qui concerne directement le graphe ONNX dérivé des mêmes poids. Les deux variantes comportent une clause
non commerciale. Demander au MTG une confirmation écrite pour les deux graphes embarqués et les usages prévus.

[Visibilité GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility) ·
[Apple Developer ID](https://developer.apple.com/developer-id/) ·
[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool) ·
[Licences Essentia et modèles](https://essentia.upf.edu/licensing_information.html) ·
[Catalogue du MTG](https://essentia.upf.edu/models.html) ·
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) ·
[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)
