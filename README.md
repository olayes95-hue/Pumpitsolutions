# PumpIT

Pilotez votre station, où que vous soyez.

Application de suivi de station-service : saisie du jour, stock, commandes, finance, alertes.
Ce projet est la refonte de `gestionStation` à l'identité PumpIT. Il utilise **la même base Supabase** : aucune migration de données n'est nécessaire.

## Démarrer

```bash
cp .env.example .env      # puis collez les deux clés du projet Supabase existant
npm install
npm run dev               # http://localhost:5173
```

Les deux variables sont celles de l'ancienne application (Supabase > Project Settings > API) :

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Autres commandes : `npm run build` (production), `npm run test:run` (tests).

## Mettre en ligne sans couper l'ancienne application

1. Poussez ce dossier dans un nouveau dépôt GitHub.
2. Importez-le dans Vercel (ou Netlify) et ajoutez les deux variables d'environnement.
3. Dans Supabase > Authentication > URL Configuration, ajoutez l'adresse du nouveau site aux « Redirect URLs ». Sans cela, les e-mails de confirmation renvoient vers l'ancienne application.
4. Testez avec un compte de chaque rôle (gérant, pompiste, vendeuse, direction, admin).
5. Quand tout est validé, pointez le nom de domaine sur le nouveau projet.

Les deux applications peuvent tourner en parallèle sur la même base tant que le schéma ne change pas.
Pour essayer sans risque, créez un second projet Supabase avec une copie de la base et utilisez ses clés dans `.env`.

## Ce qui est repris tel quel

- Toute la logique métier des pages (`src/pages`, `src/lib`) : requêtes, calculs, validations, contrôles de saisie.
- Les rôles et permissions (`src/lib/auth.jsx`), le choix de station, les routes (mêmes adresses : `/saisie`, `/tableau`, `/commandes`...).
- Le stockage des photos (bucket `bordereaux`) et la fonction `ocr-bordereau`.
- L'historique SQL de la base dans `supabase/` (référence, rien à exécuter).

## Ce qui est nouveau

- **Design system PumpIT** dans `src/ds/pumpit` : `tokens.css` (couleurs, typographies, espacements, rayons) et 22 composants réécrits (boutons en pilule, cartes arrondies, barre de niveau, badges d'état).
- **Navigation en 5 espaces** (`src/App.jsx`) : Aujourd'hui, Pilotage, Stock, Finance, Réglages. Barre latérale sur ordinateur, barre d'onglets en bas sur téléphone.
- **Page de connexion** à la marque, icônes d'application, manifeste pour l'ajout à l'écran d'accueil.
- **Polices Outfit et Rubik** embarquées dans l'application (aucun appel à Google Fonts, utile sur connexion faible).
- **Textes au vouvoiement**, comme le demande la charte.
- **Garde-fou d'erreur** : une page en erreur affiche un message au lieu d'un écran blanc.

## Règles de la charte à respecter dans le code

- Ne jamais écrire une couleur ou une police en dur : utiliser les variables de `tokens.css`.
- Un seul bouton vert (`tone="primary"`) par écran. Les autres actions : `dark`, `neutral`, `outline`.
- Le Vert Pump ne sert pas de couleur de texte sur fond clair : utiliser `--accent` (Vert texte).
- Le Citron est réservé aux alertes et aux badges. Le rouge est réservé aux erreurs et aux pannes.
- Un état combine toujours une couleur et un texte.
- Couleurs d'activité (`--act-*`) dans cet ordre : carburants, lubrifiants, gaz, supérette, lavage.
- Icônes Lucide uniquement, à déclarer dans `src/ds/pumpit/components/core/Icon.jsx`.

## Reste à faire

- **Multi-clients** : la base n'a pas de niveau « client » au-dessus des stations. À traiter avant de vendre PumpIT à plusieurs exploitants.
- **Activité Lavage** : prévue par la charte (couleur déjà définie), absente de la base.
- **Bucket `bordereaux` public** : passer aux URL signées (déjà fait dans `History.jsx`).
- **Un seul bouton vert par écran** : appliqué aux actions de ligne et aux filtres. Les pages Commandes et Stations gardent plusieurs boutons verts dans des formulaires distincts, à arbitrer écran par écran.
- **Logo** : les fichiers fournis sont des PNG. La charte demande le SVG pour le web : remplacer `public/brand/*.png` dès qu'il est disponible.
