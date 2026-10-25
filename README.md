# MédiDuel — prototype

Quiz de révision en duel, 100 % statique : compatible GitHub Pages, mobile-first, thème sombre.

- Matière, chapitres et nombre de questions (5, 7, 10, 15, 20, ou toutes) au choix ; dernière question ×2, 20 s par question.
- Bruitages synthétisés (aucun fichier audio) avec bouton muet 🔊/🔇 sur l'accueil et pendant le duel.
- Chrono : tic-tac de minuterie mécanique, de plus en plus rapide quand le temps se vide, avec une sonnerie à la fin du temps. Pour revenir au souffle de cocotte-minute, mets `TIMER_SOUND = 'cocotte'` en haut du bloc « Bruitages » de `app.js`.
- Revue des questions en fin de partie : réponse juste, ta réponse, celle de l'adversaire, explication, filtre « Mes erreurs ».

## Tester tout de suite
Ouvre `index.html` dans un navigateur, choisis un pseudo, puis **Entraînement contre un bot**. Aucun réglage nécessaire.

## Activer le duel en ligne (Supabase)
1. Crée un projet sur supabase.com.
2. Project Settings > API : copie l'URL et la clé `anon` / publishable dans `config.js`.
3. (Optionnel) colle `supabase-setup.sql` dans le SQL Editor pour garder l'historique des duels.
4. Le duel utilise Realtime Broadcast + Presence sur des canaux publics. Si rien ne se connecte, vérifie dans les réglages Realtime du projet que l'accès public aux canaux est autorisé.

Les réglages (matière, chapitres, nombre) sont choisis par l'hôte et envoyés à l'invité au lancement.

## Publier sur GitHub Pages
1. Mets tous les fichiers à la racine d'un dépôt GitHub.
2. Settings > Pages > Source : branche `main`, dossier `/ (root)`.
3. Ouvre l'URL fournie sur deux téléphones : l'un crée un salon, l'autre rejoint avec le code ou le lien.

## Ajouter tes cours
Dans `questions.js`, chaque matière a une liste de chapitres et des questions :

```js
{
  key: "neph", name: "Néphrologie", icon: "💧", color: "#38bdf8",
  chapters: ["Maladie rénale chronique", "Glomérulopathies", "IRA et kaliémie"],
  questions: [
    { h: 0, q: "Énoncé ?", c: ["Bonne réponse", "Faux 1", "Faux 2", "Faux 3"], e: "Explication affichée après la réponse." },
  ]
}
```

- `h` = numéro du chapitre (0 pour le premier de la liste `chapters`).
- La **première** proposition (`c[0]`) est toujours la bonne : l'ordre est mélangé automatiquement.
- Le nombre de questions proposé dépend de la réserve : avec 3 chapitres cochés de 3 questions chacun, tu auras jusqu'à 9 questions.
- Un thème sans `chapters` fonctionne aussi : toutes ses questions sont utilisées.

## Limites connues du prototype
- Les bonnes réponses sont dans le JavaScript : un curieux peut les lire. Suffisant entre amis ; pour un classement fiable, il faudrait les vérifier côté serveur (fonction Supabase).
- L'hôte pilote la partie : s'il quitte, le duel s'arrête.
- Reconnexion basique après verrouillage du téléphone (l'invité redemande l'état à l'hôte).
- Les questions d'exemple (12 par matière) sont des brouillons à relire avant de s'en servir pour réviser.
