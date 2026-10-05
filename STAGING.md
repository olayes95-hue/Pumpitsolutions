# Environnement de staging (pré-production)

## Ce qui existe

- **Branche git `staging`** — pousser dessus déclenche un déploiement Vercel automatique (Preview), séparé de la production (branche `main`).
- **URL stable** : https://pumpit-app-git-staging-olayes95-9521s-projects.vercel.app (se met à jour à chaque push sur `staging`, pas besoin de changer de lien).
- **Projet Supabase séparé** : `pumpit-staging` (ref `evjzbereanzjjcvskktw`) — base vide, schéma identique à la production (toutes les migrations rejouées jusqu'à `migration_v128`), aucune vraie donnée de station. Les identifiants sont dans `.secrets/staging.env` (jamais commité — voir `.gitignore`).
- Les variables d'environnement Vercel (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) sont déjà configurées sur Vercel, scopées à **Preview + branche `staging`** uniquement — la production garde ses propres valeurs, aucun risque de mélange.

## Workflow recommandé

1. Travailler sur une branche (ou directement sur `staging`), pousser sur `staging` → tester sur l'URL de staging avec la vraie UI, sans toucher aux vraies données.
2. Si une migration SQL est ajoutée : l'exécuter d'abord sur le projet Supabase **`pumpit-staging`** (SQL Editor de ce projet, pas celui de production) pour vérifier qu'elle s'applique sans erreur et donne le bon résultat.
3. Une fois validé : fusionner `staging` dans `main` (`git checkout main && git merge staging && git push`) → ça déploie en production — puis exécuter la même migration SQL sur le projet Supabase de **production**.

## Limites actuelles

- La base de staging est **vide** (pas de vraies stations/ventes) — pour tester un scénario réaliste, il faut saisir des données de test directement dans l'app déployée sur l'URL de staging (elle écrit dans `pumpit-staging`, jamais dans la vraie base).
- Pas de synchronisation automatique production → staging : si de nouvelles migrations sont appliquées en production sans passer par ce workflow, la base de staging prendra du retard. Dans ce cas, rejouer les migrations manquantes sur `pumpit-staging` pour la remettre à niveau.
