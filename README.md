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

## Multi-clients

Une seule base sert plusieurs exploitants. Chaque client est une « organisation » : ses stations, saisies, produits, fournisseurs, réglages et comptes sont invisibles des autres. Le cloisonnement est fait par la base (règles RLS), pas par l'application.

### Mise en place (une fois)

1. **Sauvegardez la base**, puis essayez d'abord sur une copie (second projet Supabase).
2. Dans Supabase > SQL Editor, exécutez `supabase/migration_v96_multiclient.sql`. Le script est transactionnel : en cas d'erreur, rien n'est modifié.
3. Toujours dans l'éditeur SQL, nommez-vous administrateur de la plateforme et renommez le client initial :
   ```sql
   update public.profiles set is_platform_admin = true
   where id = (select id from auth.users where email = 'vous@exemple.com');
   update public.organisations set nom = 'Nom de votre société' where id = 1;
   ```
4. Redéployez la fonction OCR, corrigée pour vérifier les droits de l'appelant : `supabase functions deploy ocr-bordereau`.
5. Déployez cette application.

Ordre à respecter : le SQL d'abord, l'application ensuite. Toutes les données existantes sont rattachées au client n° 1.

### Ajouter un client

1. Réglages > Clients > « Créer le client ». Un code d'invitation est généré.
2. Le futur administrateur du client crée son compte avec ce code.
3. Dans Clients, cliquez « Ouvrir » sur ce client. Dans Stations et équipe, validez son compte, donnez-lui le rôle administrateur et créez sa première station.
4. Revenez à votre client avec « Ouvrir ». Le client gère ensuite seul son équipe avec son code.

### À savoir

- **Rôles et permissions** : communs à tous les clients. Seul l'administrateur de la plateforme les modifie.
- **Réglages** (prix, marges, seuils) : propres à chaque client, copiés à la création.
- **Photos** : le bucket `bordereaux` reste public par lien direct. La liste des fichiers, elle, est cloisonnée.
- **Ancienne application** : elle continue de fonctionner, mais son écran d'inscription n'a pas de champ code. Les comptes créés par là apparaissent dans Clients > « Comptes sans entreprise ».
- **Retour arrière** : `supabase/rollback_v96_multiclient.sql`, utilisable tant qu'il n'y a qu'un seul client.
- **Non couvert** : formules d'abonnement, facturation, suspension d'un client.

### Ce qui a été vérifié

La migration a été testée sur une base PostgreSQL locale reconstruite à partir des fichiers SQL de ce dépôt (schéma + migrations v2 à v95), avec deux clients : 43 contrôles passent (un client ne voit ni ne modifie rien de l'autre, à travers les tables comme les vues) et 6 tentatives d'intrusion sont rejetées. Le script a aussi été rejoué deux fois, annulé, puis rejoué. Il n'a pas été exécuté sur la base de production : la copie de l'étape 1 sert à cela.

## Reste à faire

- **Activité Lavage** : prévue par la charte (couleur déjà définie), absente de la base.
- **Bucket `bordereaux` public** : passer aux URL signées (déjà fait dans `History.jsx`).
- **Un seul bouton vert par écran** : appliqué aux actions de ligne et aux filtres. Les pages Commandes et Stations gardent plusieurs boutons verts dans des formulaires distincts, à arbitrer écran par écran.
- **Logo** : les fichiers fournis sont des PNG. La charte demande le SVG pour le web : remplacer `public/brand/*.png` dès qu'il est disponible.
