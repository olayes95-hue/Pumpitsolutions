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

## Multi-clients, abonnements, back-office

Une seule base sert plusieurs exploitants. Chaque client est une « organisation » : ses stations, saisies, produits, fournisseurs, réglages, comptes et photos sont invisibles des autres. Le cloisonnement est fait par la base (règles RLS), pas par l'application.

### Mise en place, dans cet ordre

1. **Sauvegardez la base**, puis faites le premier essai sur une copie (second projet Supabase).
2. Dans Supabase > SQL Editor, exécutez l'un après l'autre :
   - `supabase/migration_v96_multiclient.sql` (organisations et cloisonnement) ;
   - `supabase/migration_v97_abonnements_photos.sql` (formules, suspension, factures, droits sur les photos, ancienne application) ;
   - `supabase/migration_v99_backoffice_assistance.sql` (supervision et assistance).

   Chaque script est transactionnel (en cas d'erreur, rien n'est modifié) et peut être rejoué.
3. Nommez-vous administrateur de la plateforme et renommez le client initial :
   ```sql
   update public.profiles set is_platform_admin = true
   where id = (select id from auth.users where email = 'vous@exemple.com');
   update public.organisations set nom = 'Nom de votre société' where id = 1;
   ```
4. Redéployez la fonction OCR, corrigée pour vérifier les droits de l'appelant : `supabase functions deploy ocr-bordereau`.
5. Déployez cette application. Dans le back-office (`/admin`) > Réglages, renseignez les numéros d'assistance et l'émetteur des factures.
6. **En dernier**, quand l'ancienne application est arrêtée : `supabase/migration_v98_photos_privees.sql`. Les photos ne sont alors plus lisibles par simple lien.

Toutes les données existantes sont rattachées au client n° 1, en formule Complet.

### Back-office (`/admin`)

Espace séparé de l'application des clients, réservé à l'administrateur de la plateforme.

- **Supervision** : pour chaque client, stations à jour aujourd'hui, dernière saisie, comptes à valider, montant à régler, demandes ouvertes. Le bouton « Ouvrir » fait entrer dans l'application du client.
- **Clients** : création (code d'invitation), formule, suspension et réactivation, coordonnées, factures (émettre, encaisser, annuler, imprimer).
- **Assistance** : toutes les demandes de tous les clients, réponse en direct.
- **Réglages** : numéros d'assistance, émetteur des factures, TVA, prix des formules.

### Ajouter un client

1. Back-office > Clients > « Créer le client », avec sa formule. Un code d'invitation est généré.
2. Le futur administrateur du client crée son compte avec ce code.
3. Cliquez « Ouvrir » sur ce client. Dans Stations et équipe, validez son compte, donnez-lui le rôle administrateur et créez sa première station.
4. Le client gère ensuite seul son équipe : il retrouve son code dans Réglages > Entreprise.

### Formules

| Fonction | Essentiel | Pro | Complet |
|---|---|---|---|
| Saisie, stock, commandes, historique, alertes de caisse et de versement | oui | oui | oui |
| Alertes anti-fraude complètes, prévision de commande | | oui | oui |
| Point financier, rapprochement, bordereaux, export, journal d'audit | | | oui |

La répartition est dans `src/lib/formules.js` (d'après `docs/PLAN_COMMERCIAL.md`). Elle filtre les menus, les écrans et les boutons : c'est un filtrage d'interface. Les prix se règlent dans le back-office.

### Suspension et factures

- Suspendre un client coupe tout accès à ses données, au niveau de la base. Ses comptes voient un écran « Accès suspendu », avec les factures (pour l'administrateur) et l'assistance.
- Encaisser une facture prolonge l'abonnement jusqu'à la fin de la période facturée et réactive le client.
- La suspension est toujours manuelle : un retard de paiement est signalé (« En retard »), jamais sanctionné automatiquement.
- Les factures suivent la mise en page de la charte. « Imprimer » ouvre l'impression du navigateur, qui permet aussi d'enregistrer en PDF. Les numéros sont continus ; une facture émise s'annule, elle ne se supprime pas.
- Aucun paiement en ligne : l'encaissement est saisi à la main (Mobile Money, virement, espèces, chèque).

### Assistance

- Côté client : Réglages (ou Aide) > Assistance. Nouvelle demande avec photo jointe et option « être rappelé », suivi des réponses, boutons Appeler et WhatsApp.
- Les boutons Appeler et WhatsApp ouvrent le téléphone ou WhatsApp de l'appareil : l'appel ne passe pas par l'application.
- Les messages arrivent en temps réel, avec un rafraîchissement automatique en secours.

### À savoir

- **Rôles et permissions** : communs à tous les clients. Seul l'administrateur de la plateforme les modifie.
- **Comptes non validés** : ils ne lisent plus aucune donnée par l'API (auparavant, certaines tables leur étaient lisibles).
- **Ancienne application** : ses inscriptions, sans code, sont rattachées au client coché dans Back-office > Clients > « Ancienne application » (le client initial par défaut). Elle affiche les photos par lien public : arrêtez-la avant la v98.
- **Supprimer un client** (irréversible, par l'éditeur SQL uniquement) : `select public.delete_organisation(2, 'Nom exact du client');`. La fonction indique les dossiers photo à effacer dans Storage.
- **Retour arrière** : `supabase/rollback_v96_multiclient.sql`. Revenir à une base mono-client n'a de sens qu'avec un seul client : s'il y en a plusieurs, supprimez les autres d'abord, ou restaurez la sauvegarde.

### Ce qui a été vérifié

Les migrations ont été testées sur une base PostgreSQL locale reconstruite à partir des fichiers SQL de ce dépôt (schéma + migrations v2 à v95), avec deux clients : 92 contrôles passent et 18 tentatives interdites sont rejetées (lecture ou écriture chez un autre client, élévation de droits, client suspendu, compte non validé, photos, factures, assistance). Les scripts ont aussi été rejoués, annulés, puis rejoués. Ils n'ont pas été exécutés sur la base de production, et le stockage Supabase y était simulé : la copie de l'étape 1 sert à confirmer.

## Reste à faire

- **Paiement en ligne** des abonnements et **appel vocal intégré** : non faits (prestataires payants à choisir).
- **Rôles personnalisables par client** : aujourd'hui communs à tous.
- **Activité Lavage** : prévue par la charte (couleur déjà définie), absente de la base.
- **Un seul bouton vert par écran** : appliqué aux actions de ligne et aux filtres. Les pages Commandes et Stations gardent plusieurs boutons verts dans des formulaires distincts, à arbitrer écran par écran.
- **Logo** : les fichiers fournis sont des PNG. La charte demande le SVG pour le web : remplacer `public/brand/*.png` dès qu'il est disponible.
