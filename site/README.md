# Site CueKoda

Le site est en français et renvoie aussi vers la documentation anglaise. Les images proviennent des captures Electron déjà suivies dans le dépôt.

## Prévisualiser et déployer

Depuis la racine du dépôt avec Node.js 24 et un accès à GitHub :

```sh
node site/build.mjs
```

Ouvrir `site/dist/index.html`. Le deuxième argument facultatif choisit un autre dossier de sortie. Le build appelle l’API publique de GitHub. Il accepte aussi `GH_TOKEN` pour les appels authentifiés en CI.

Dans **Settings → Pages → Build and deployment → Source**, choisir **GitHub Actions**. Lancer ensuite **Actions → Site GitHub Pages → Run workflow** sur `main` si le premier déploiement doit être relancé.

Le site se reconstruit lors de changements affectant la vitrine sur `main`, après un succès d’**Installeurs** sur `main`, lors d’une publication ou édition manuelle de Release et via une vérification planifiée quotidienne. Le déclencheur **Installeurs** couvre les publications faites avec le jeton intégré de GitHub Actions, dont l’événement Release seul ne suffit pas à lancer un autre workflow. La tâche de suivi lit toujours l’état actuel de `main` et de la dernière Release stable. Une erreur API fait échouer le build avant déploiement.

Les numéros de version viennent des noms d’installeurs publiés et les URL pointent sur les fichiers de cette Release. Les notes s’affichent comme texte, avec un lien vers leur rendu GitHub. Le site consulte l’API en lecture seule. L’application conserve ses propres vérifications de build, de taille et de SHA-256.

Pour un domaine personnalisé, vérifier la propriété du domaine sur GitHub, puis renseigner **Settings → Pages → Custom domain**, configurer les DNS et attendre l’émission du certificat avant d’activer **Enforce HTTPS**. [Procédure GitHub](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
