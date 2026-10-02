# Spécifications techniques — Application de gestion de station-service

> Document de référence pour l'onboarding d'un ingénieur. Rédigé **à partir de la lecture du code source** (React + Vite + Supabase) et des scripts SQL du dépôt `station-app`. Chaque affirmation s'appuie sur un fichier réel ; les points inférés sont explicitement marqués « (inféré) ».
>
> - **Version applicative** : `1.0.0` (`package.json`, `name: "station-beaurivage"`)
> - **État du schéma** : migrations `schema.sql` → `v33` (dernière migration lue : `migration_v33.sql`)
> - **Domaine métier** : suivi quotidien d'une (ou plusieurs) station-service au Bénin — carburant (essence/gasoil), gaz, lubrifiant, supérette — avec anti-fraude, réconciliation des versements, prévision de commande et contrôles réglementaires (ANM).
> - **Langue de l'UI** : français ; devise **FCFA** (XOF).

---

## 1. Vue d'ensemble de l'architecture

L'application est une **SPA (Single Page Application) React** servie en statique, adossée à un **BaaS Supabase** (Backend-as-a-Service). **Il n'y a pas de backend applicatif custom** : toute la logique serveur est portée par Postgres (vues SQL, fonctions PL/pgSQL, triggers, RLS) et par **une seule Edge Function** (OCR des bordereaux). Le navigateur parle directement à Supabase via la librairie `@supabase/supabase-js` en utilisant la **clé anon publique** ; la sécurité repose entièrement sur le **Row Level Security (RLS)** de Postgres.

### Schéma d'architecture (texte)

```
┌──────────────────────────────────────────────────────────────────┐
│  NAVIGATEUR (mobile-first, PWA-like)                               │
│  React 18 + Vite + react-router-dom (routes lazy) + Recharts       │
│                                                                    │
│  Contextes :  AuthProvider ── session + profil + rôle              │
│               StationProvider ── station courante (scoping)        │
│                                                                    │
│  supabase-js (clé ANON) ─┐                                         │
│    • Auth (email/mot de passe)                                     │
│    • PostgREST (tables + vues, filtrées par RLS)                   │
│    • Storage (bucket "bordereaux", images compressées côté client) │
│    • Realtime (canal postgres_changes sur daily_reports)           │
│    • functions.invoke('ocr-bordereau')                             │
└───────────────┬──────────────────────────────────┬────────────────┘
                │ HTTPS + JWT utilisateur           │
                ▼                                   ▼
┌───────────────────────────────────┐   ┌────────────────────────────┐
│  SUPABASE (Postgres managé)       │   │  Edge Function (Deno)      │
│  • Tables métier + RLS            │   │  ocr-bordereau/index.ts    │
│  • ~30 vues SQL (métriques,       │   │  • SERVICE_ROLE_KEY        │
│    alertes, réconciliation,       │   │  • ANTHROPIC_API_KEY       │
│    prévision, stock)              │   │  • appel Vision Claude     │
│  • Fonctions : is_admin(),        │   │    → montant/date/réf lus  │
│    my_station(), my_role(),       │   │    → maj deposits.*_ocr    │
│    notify_missing(), audit,       │   └────────────────────────────┘
│    prevent_role_change(), purge   │
│  • Triggers d'audit + garde-fous  │   ┌────────────────────────────┐
│  • pg_cron (notifications 8h/16h) │   │  API Anthropic (Vision)    │
│  • Storage bucket "bordereaux"    │   │  claude-sonnet-4-6         │
└───────────────────────────────────┘   └────────────────────────────┘

Hébergement front : Vercel (build statique, alias public station-beta-green.vercel.app)
```

### Principes structurants

1. **Pas de serveur applicatif** : le client écrit directement dans les tables. Les règles métier « dures » (qui peut écrire/supprimer, verrou du passé, anti-auto-promotion) sont dans le RLS et les triggers, **pas** dans le front.
2. **Le calcul est déporté dans les vues SQL** : le front lit surtout des vues (`v_report_metrics`, `v_alerts`, `v_reorder`, `v_pole_recon_jour`, …). Les KPI, alertes, réconciliations et prévisions sont recalculés en base à la volée. Le front agrège peu (surtout de l'affichage).
3. **Le client ne peut PAS exécuter de DDL** : création de tables/vues/policies, migrations → **l'utilisateur les colle manuellement dans le SQL Editor Supabase**. Le déploiement de code (front) et de schéma (SQL) sont deux flux distincts.
4. **Multi-station** : une même instance gère plusieurs stations (`stations`), chaque donnée porte un `station_id`, et le RLS scope l'accès (`my_station()`), sauf pour l'admin (accès global).

---

## 2. Stack technique & dépendances

### Dépendances (`package.json`)

| Paquet | Version | Rôle |
|---|---|---|
| `react` | `^18.3.1` | UI |
| `react-dom` | `^18.3.1` | rendu DOM |
| `react-router-dom` | `^6.26.2` | routing SPA + `lazy`/`Suspense` |
| `@supabase/supabase-js` | `^2.45.4` | client Auth/DB/Storage/Realtime/Functions |
| `recharts` | `^2.12.7` | graphiques (tableau de bord) |
| `vite` (dev) | `^5.4.8` | bundler / dev server |
| `@vitejs/plugin-react` (dev) | `^4.3.1` | plugin React (Fast Refresh, JSX) |

`"type": "module"` (ESM). Scripts : `dev` (vite), `build` (`vite build` → `dist/`), `preview`.

### Build Vite

`vite.config.js` est **minimal** : uniquement `plugins: [react()]`. Aucune configuration de chunking manuelle, d'alias ni de base path. Le découpage en chunks vient donc **exclusivement des `import()` dynamiques** dans `src/App.jsx`.

### Découpage en chunks (lazy loading)

`src/App.jsx` charge **toutes les pages via `React.lazy(() => import(...))`** (une par route), enveloppées dans un `<Suspense fallback="Chargement…">`. Seuls `Login` et `NotifBanner` sont importés statiquement. Bénéfice documenté dans le code : *« réduit fortement le bundle initial (surtout pour gérant/vendeuse) »* — un gérant qui n'a accès qu'à la saisie ne télécharge pas le code du tableau de bord, des graphiques Recharts, etc.

Pages chargées à la demande : `Submit`, `Dashboard`, `Alerts`, `History`, `Suppliers`, `Stations`, `BankRecon`, `Orders`, `Inspections`, `OcrCheck`, `AuditLog`, `Finance`, `Products`, `Stock`, `Entries`, `Aide`.

### `index.html`

`lang="fr"`, viewport verrouillé (`maximum-scale=1.0, user-scalable=no` → comportement app mobile), `theme-color=#1F4E78` (bleu de marque), titre « Outil de gestion de station ». Point d'entrée `/src/main.jsx`.

---

## 3. Structure du dépôt (arborescence commentée)

```
station-app/
├── index.html                 # shell HTML (racine SPA)
├── vite.config.js             # config Vite minimale (plugin React)
├── vercel.json                # rewrite SPA : /(.*) → /index.html
├── package.json               # deps + scripts
├── .env / .env.example        # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
├── .env.local                 # jeton Vercel CLI (VERCEL_OIDC_TOKEN)
├── .vercel/                   # lien projet Vercel (projectId, orgId, name="station")
│
├── src/
│   ├── main.jsx               # bootstrap : BrowserRouter > AuthProvider > App
│   ├── App.jsx                # Shell (sidebar/nav) + routes lazy + garde-fous de rôle
│   ├── styles.css             # styles globaux (variables CSS : --primary, --danger…)
│   ├── lib/
│   │   ├── supabase.js        # createClient(anon) + const BORDEREAUX_BUCKET
│   │   ├── auth.jsx           # AuthProvider/useAuth : session, profil, rôles, signIn/Up/Out
│   │   ├── station.jsx        # StationProvider/useStation : liste stations + station courante
│   │   ├── format.js          # fcfa/num/numFR/frDate/today + ALERT_LABELS
│   │   └── image.js           # compressImage() : redimension 1600px + JPEG q0.7
│   ├── components/
│   │   └── NotifBanner.jsx    # bandeau notifications (table notifications, refresh 5 min)
│   └── pages/                 # une page par écran (toutes lazy)
│       ├── Login.jsx          # connexion / inscription (email+mot de passe)
│       ├── Submit.jsx         # ★ Saisie du jour (matin/16h/soir) + mode vendeuse — 700 lignes
│       ├── Stock.jsx          # stock gaz/lub/supérette, mouvements, sorties déduites
│       ├── Orders.jsx         # commandes (workflow proposée→…→reçue), réceptions partielles
│       ├── Inspections.jsx    # contrôles ANM (inopinés)
│       ├── Aide.jsx           # aide contextuelle
│       ├── Dashboard.jsx      # tableau de bord admin (KPI, Recharts, prévision, realtime)
│       ├── History.jsx        # historique des « points » (réconciliation par jour/pôle)
│       ├── Entries.jsx        # « Saisies & photos » : détail jour par jour + vignettes
│       ├── Alerts.jsx         # liste v_alerts + masquage (alert_dismissals)
│       ├── Finance.jsx        # point financier / compte de résultat mensuel
│       ├── BankRecon.jsx      # rapprochement bancaire (appariement glouton)
│       ├── OcrCheck.jsx       # « Vérif bordereaux » : déclenche l'Edge Function OCR
│       ├── AuditLog.jsx       # journal d'audit immuable (admin)
│       ├── Products.jsx       # catalogue produits & prix (gaz/lub/supérette)
│       ├── Suppliers.jsx      # fournisseurs
│       └── Stations.jsx       # stations, équipe (rôles/rattachement), prix & marge, lubrifiants
│
├── supabase/
│   ├── schema.sql             # base v1 : profiles, daily_reports, expenses, deposits, RLS…
│   ├── seed_from_audit.sql    # données historiques (409 jours + 382 versements)
│   ├── storage_policies.sql   # policies bucket bordereaux (select/insert authenticated)
│   ├── migration_v2.sql … v33 # migrations incrémentales (voir §12)
│   ├── migrations_v14_v24.sql       # regroupement idempotent v14→v24
│   ├── migration_FINALE_v27_v30.sql # regroupement v27→v30 (réécritures majeures)
│   ├── migration_v31_v33.sql        # regroupement v31→v33
│   ├── hotfix_trigger.sql, hotfix_roles.sql, cleanup_tests.sql
│   └── functions/
│       ├── ocr-bordereau/index.ts   # Edge Function OCR (Deno)
│       └── README_OCR.md            # déploiement OCR
│
├── tools/
│   └── import_whatsapp.py     # import de données depuis exports WhatsApp
│
├── test_*.mjs                 # scripts de test bout-en-bout locaux (node), non CI
├── load_seed.mjs              # rechargement des données historiques
│
├── docs/                      # (ce document)
├── DEPLOIEMENT.md             # guide de déploiement (⚠ mentionne Netlify, cf. §11/§13)
├── ARCHIVAGE.md               # politique de rétention des photos
├── GUIDE_ADMIN.md / .pdf, GUIDE_GERANT.md, IMPORT_WHATSAPP.md, README.md
└── dist/                      # build de production (généré)
```

**Note** : le prompt évoque des répertoires `docs/`, `guides/` — au moment de la lecture, `docs/` n'existait pas (créé pour ce document) et il n'y a pas de dossier `guides/` : les guides sont des fichiers Markdown à la racine (`GUIDE_ADMIN.md`, `GUIDE_GERANT.md`).

---

## 4. Authentification & autorisation

### Supabase Auth

- **Mécanisme** : email + mot de passe (`supabase.auth.signInWithPassword` / `signUp` / `signOut`, dans `lib/auth.jsx`). Inscription avec `options.data.full_name`.
- **Contexte React** (`AuthProvider`) : au montage, `getSession()` puis abonnement `onAuthStateChange`. À chaque changement de session, `loadProfile(userId)` recharge la ligne `profiles`. Expose : `session, profile, loading, role, isAdmin, isPompiste, isVendeuse, signIn, signUp, signOut`.
- **Login** (`pages/Login.jsx`) : bascule login/signup, messages d'erreur traduits en français (`traduire()`). Mot de passe min. 6 caractères. `DEPLOIEMENT.md` recommande de **désactiver « Confirm email »** côté Supabase pour simplifier.

### Table `profiles` & création automatique

`profiles(id uuid PK → auth.users, full_name, role, station_id, created_at)`.

À l'inscription, le trigger `on_auth_user_created` (fonction `handle_new_user()`, `security definer`) crée automatiquement un profil avec **`role = 'gerant'` par défaut** et `full_name = raw_user_meta_data.full_name` (repli sur l'email).

### Rôles

Contrainte `profiles_role_check` (état final, v24) : `role IN ('gerant','admin','pompiste','vendeuse')`.

| Rôle | Accès (dérivé de `App.jsx` + RLS) |
|---|---|
| **admin** | Tout : pilotage, finance, administration, toutes stations. Seul à voir Tableau de bord, Historique, Alertes, Finance, Rapprochement, Vérif bordereaux, Audit, Produits, Fournisseurs, Stations. |
| **gérant** | Exploitation d'une station : Saisie du jour, Stock, Commandes, Contrôles ANM, Aide. |
| **pompiste** | Saisie restreinte (compteurs, stock, photos) : pas de ventes/versements, pas de Commandes/Contrôles. Redirigé de `/commandes` vers `/saisie`. |
| **vendeuse** | Uniquement la partie **supérette** : saisie des ventes supérette (par produit) + vue Supérette du Stock. Menu « Saisie » devient « Saisie supérette », « Stock » devient « Supérette ». Route par défaut `/stock`. |

Le routage applique les gardes-fous : toute route admin non autorisée fait `<Navigate to="/saisie" />` ; la route `*` redirige selon le rôle (`admin → /tableau`, `vendeuse → /stock`, sinon `/saisie`). **Ces gardes-fous front sont une commodité UX** : la vraie protection est le RLS (le front ne peut de toute façon rien lire/écrire hors de ses droits).

### Fonctions SQL de sécurité

```sql
-- Vrai si l'utilisateur courant est admin (security definer → contourne le RLS de profiles)
create function public.is_admin() returns boolean language sql stable security definer …
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');

-- Station rattachée à l'utilisateur (scoping des données)
create function public.my_station() returns bigint language sql stable security definer …
  select station_id from profiles where id = auth.uid();

-- Rôle de l'utilisateur (v11) — sert à bloquer le pompiste sur les écritures financières
create function public.my_role() returns text …
  select role from profiles where id = auth.uid();
```

### Garde-fou anti auto-promotion (verrou de rôle)

`schema.sql` définit `prevent_role_change()` en trigger `BEFORE UPDATE` sur `profiles`. Subtilité **volontaire et documentée** : la fonction est en **`security INVOKER` (défaut)**, pas `definer`, pour que `current_user` reflète le rôle appelant.

```sql
if new.role is distinct from old.role
   and current_user = 'authenticated'   -- utilisateur de l'app
   and not public.is_admin() then
  raise exception 'Seul un administrateur peut modifier le rôle d''un compte.';
end if;
```

Conséquence : un utilisateur normal de l'app **ne peut pas se promouvoir admin** ; seul un admin (ou l'éditeur SQL `postgres` / `service_role`, dont `current_user ≠ 'authenticated'`) le peut. La promotion initiale du 1er admin se fait donc en SQL (`update profiles set role='admin' …`).

### Scoping par station

- Le **StationProvider** (`lib/station.jsx`) charge `stations`, puis fixe `stationId` : pour un non-admin, `profile.station_id` (repli 1re station) ; pour l'admin, la 1re station, modifiable via un `<select>` dans l'AppBar (`StationPicker`). Un non-admin voit un simple `chip` « 📍 Ma station » non modifiable.
- Côté données, la plupart des tables portent `station_id` et les policies SELECT/écriture utilisent `is_admin() or station_id = my_station()`.

---

## 5. Modèle de données (état courant reconstruit)

> Reconstruit à partir de `schema.sql` + toutes les migrations, les plus récentes faisant foi. Types : `numeric` = FCFA/litres/quantités ; dates en `date` ; horodatages `timestamptz`.

### Diagramme de relations (texte)

```
auth.users ──1:1── profiles(id) ──N:1── stations(id)
                       │
       created_by (uuid) sur presque toutes les tables métier
                       │
stations(id) ─1:N─ daily_reports ─(report_date, station_id) unique
             ─1:N─ expenses, deposits, deliveries, submissions
             ─1:N─ fuel_orders ─1:N─ order_receptions
             ─1:N─ inspections, bank_lines, notifications
             ─1:N─ stock_movements, charges, alert_dismissals
             ─1:N─ superette_sales ─N:1─ products(id)
             ─1:N─ attachments
suppliers(id) ─1:N─ deliveries(supplier_id)
settings(id=1) : ligne unique globale (prix, marges, seuils réappro)
lubrifiant_types : catalogue historique des références lubrifiant
audit_log : journal append-only (déclenché par triggers)
```

### `profiles` — utilisateurs
`id uuid PK`, `full_name`, `role` (`gerant|admin|pompiste|vendeuse`), `station_id → stations`, `created_at`. RLS : chacun voit/modifie le sien, admin voit/modifie tout ; trigger anti-promotion.

### `stations` — points de vente (v3)
`id bigint PK`, `nom`, `compte_bancaire`, `seuil_essence` (déf. 2000 L), `seuil_gasoil` (2000), `seuil_gaz` (5 bouteilles/type, v12), `seuil_lubrifiant` (2 unités, v12), `created_at`. Seed initial : « Beaurivage » et « Vedoko ».

### `settings` — paramètres globaux (ligne unique `id=1`)
Prix de vente `essence_pv` (725), `gasoil_pv` (750) ; `marge_unitaire` (25 F/L) ; prix d'achat `essence_pa` (705), `gasoil_pa` (730, v8). Taux commissions autres pôles `taux_gaz` (8 %), `taux_superette` (8 %, v15). `taux_perte_acceptable` (5 %, v16). `superette_stock_initial` (v23). Réappro : `delai_livraison_jours` (3), `jours_securite` (2) (v29). Contrainte `one_row check(id=1)`. RLS : lecture authenticated, update admin.

### `daily_reports` — le « Point » du jour (cœur du modèle)
Clé métier **unique `(station_id, report_date)`** (v3, remplace l'unicité par date seule). Colonnes principales :
- **Carburant vendu** : `ess_litres, ess_pu, ess_bon, ess_espece`, idem `gas_*`.
- **Autres pôles (espèces)** : `gaz_espece, superette_espece, lubrifiant_espece`.
- **Compteurs 16h (contrôle)** : `e1..e4, g1..g4`. **Compteurs ouverture/matin** : `e1_m..e4_m, g1_m..g4_m` (v5).
- **Stock cuve** : `ess_stock, gas_stock` (litres). **Gaz par type** : `gaz_stock_3/6/12/38` (stock) et `gaz_vendu_3/6/12/38` (v2). **Lubrifiant** : `lubrifiant_stock jsonb` (`{"5W30 1L": 6, …}`).
- `total_bon_cumul` (encours de bons), `note`, `created_by`, `created_at`.

**Logique clé** : les litres vendus peuvent être **déclarés** (`ess_litres`) et/ou **recalculés** depuis les relevés d'ouverture consécutifs (`ess_litres_calc = e_open(J+1) − e_open(J)`), l'écart servant de contrôle anti-fraude. En base réelle (Realtime) : table publiée dans `supabase_realtime`.

### `expenses` — dépenses en espèces
`report_date, station_id, categorie` (SBEE/SUPERETTE/CARBURANT/AUTRE), `montant`, `motif`, `justificatif boolean`, `photo_path` (v17, justificatif obligatoire côté front), `created_by`.

### `deposits` — versements bancaires (avec bordereau)
`report_date, station_id, pole` (`carburant|gaz|superette|lubrifiant|gaz_lubrifiant`), `montant`, `deposit_date`, `ref_bordereau`, `photo_path` (bucket bordereaux). **Période** : `periode_debut, periode_fin` (v27) — un versement couvre une plage de jours de recette. OCR : `montant_ocr, date_ocr, ref_ocr, ocr_ecart, ocr_at` (v10).

### `deliveries` — livraisons/achats hors carburant
`report_date, station_id, type` (essence/gasoil/gaz/lubrifiant/autre), `quantite, unite, pu_achat, montant, fournisseur, supplier_id → suppliers, note`.

### `suppliers` — fournisseurs (v3)
`id, nom, categorie` (superette/lubrifiant/gaz/autre), `contact, note`. RLS ouverte à tout authentifié (all).

### `products` — catalogue produits & prix (v21)
`id, categorie` (gaz/lubrifiant/superette/autre), `nom, unite, prix_achat, prix_vente, seuil, actif, ordre`, `unique(categorie, nom)`. Ajout v31 : `statut` (`valide|en_attente`), `created_by → auth.users`, `station_id`. Un non-admin peut **proposer** un produit uniquement `statut='en_attente'` (policy dédiée), l'admin le valide.

### `fuel_orders` — commandes (carburant + autres pôles, v7/v20/v22)
`id, station_id, produit` (essence/gasoil/…), `quantite_commandee, bons_base`, `statut` (`proposee|validee|lancee|partielle|recue|annulee`), `cuve_avant, cuve_apres`, `report_date` (jour de réception), `prix_achat, montant`. Traçabilité : `proposed_by/at, validated_by/at, lancee_at, recu_by/at`. Paiement : `cheque_montant, cheque_ref` (v20), `date_proposition, date_lancement` (v20). Multi-produit : `categorie` (carburant/gaz/lubrifiant/superette), `mode_paiement` (bons/cheque/especes), `montant_paiement`, `lignes jsonb` (supérette : `[{"article","qte"}]`) (v22).

### `order_receptions` — réceptions partielles (v28)
`id, order_id → fuel_orders (on delete cascade), station_id, report_date, quantite_recue`, `cuve_avant, cuve_apres` (carburant), `prix_achat, montant, photo_path, note, created_by`. Une commande peut être reçue en plusieurs fois ; le statut passe `lancee → partielle → recue` quand le cumul atteint le commandé à la marge près.

### `stock_movements` — journal de mouvements de stock (v23)
`id, station_id, categorie` (gaz/lubrifiant/superette/carburant), `produit`, `type` (entree/sortie/ajustement), `quantite` (unités), `valeur` (FCFA, supérette), `source` (reception/vente/achat/perte/inventaire), `ref, note, date_mouvement, created_by`. Depuis v26, plus de sortie auto gaz/lubrifiant : les sorties sont **déduites** de deux relevés déclarés (voir `v_sorties_deduites`).

### `superette_sales` — ventes supérette détaillées (v31)
`id, station_id, report_date, product_id → products (on delete set null), nom` (libellé figé), `quantite, prix_vente, montant`, `created_by default auth.uid()`. Le total alimente `daily_reports.superette_espece`.

### `attachments` — photos-preuves (v6)
`id, station_id, report_date, categorie` (compteur/stock/facture/bordereau/reception/autre), `photo_path` (bucket), `note, created_by`. Support de l'archivage (v29, rétention 6/24 mois).

### `inspections` — contrôles ANM inopinés (v7)
`id, station_id, date_controle, organisme` (déf. ANM), `pompes, prelevement_litres, retour_cuve_litres, conforme boolean, observations, fiche_photo_path, created_by`.

### `bank_lines` — lignes du relevé bancaire (v4)
`id, station_id, date_operation, montant, reference, note, created_by`. Réservé admin (RLS `for all using is_admin()`).

### `notifications` — rappels 8h/16h (v9)
`id, station_id, type, message, resolved boolean, created_at`. Alimentée par `notify_missing()` via pg_cron ; affichée par `NotifBanner`.

### `charges` — charges mensuelles (v14)
`id, station_id, mois` (`YYYY-MM`), `categorie` (LOYER/SALAIRES/PRELEVEMENT_GERANT/IMPOTS/…/AUTRE + `AUTRES_PRODUITS` comme revenu côté front), `montant, note, created_by`. RLS : lecture station, écriture admin.

### `alert_dismissals` — alertes traitées/masquées (v14)
`id, station_id, report_date, type, note, dismissed_by, dismissed_at`, `unique(station_id, report_date, type)`. Réservé admin.

### `submissions` — journal des envois (moments, v2)
`id, report_date, station_id, moment` (matin/apres-midi/soir/superette/autre), `created_by`. Sert à `notify_missing()` (détecter un moment non envoyé).

### `lubrifiant_types` — références lubrifiant (v18)
`id, nom unique, actif, ordre`. Historique ; largement doublonné par `products(categorie='lubrifiant')` (v21). Toujours géré dans l'écran Stations.

### `audit_log` — journal immuable (v11)
`id, table_name, row_id, action` (INSERT/UPDATE/DELETE), `station_id, changed_by, changed_by_email, old_data jsonb, new_data jsonb, changed_at`. Alimenté par trigger `audit_trigger()` sur `daily_reports, deposits, expenses, deliveries, fuel_orders, inspections`. Lecture admin seule.

---

## 6. Vues SQL

> ~30 vues. Elles portent la logique métier (le front lit surtout ces vues). Ci-dessous, rôle + colonnes produites + logique. Beaucoup ont été **réécrites** au fil des migrations : l'état décrit est le plus récent (v25/v26/v27/v30/v31/v32/v33).

### `v_report_metrics` — métriques par point (état v27)
Base de presque tout. Par `(station_id, report_date)` calcule :
- `cash_declare` = somme des espèces des 5 pôles ; `ventes_bon` = `ess_bon+gas_bon`.
- `e_open/g_open` = somme des compteurs d'ouverture ; via `lead()`, `ess_litres_calc/gas_litres_calc` = litres recalculés depuis l'ouverture du **lendemain** (si jours consécutifs et compteur croissant).
- `ess_litres_retenu/gas_litres_retenu` = `coalesce(déclaré, calculé)`.
- `marge_estimee` = (litres) × `settings.marge_unitaire` ; `ca_carburant` = litres × prix unitaire.
- `total_depense`, `total_verse`, `total_livraisons` (sous-requêtes). **Évolution clé du rattachement du versement** : v25 rattache `total_verse` au **jour de recette `deposit_date`** ; v27 le rattache au **dernier jour de la période** (`periode_fin`).

### `v_ventes_mensuelles` — agrégat mensuel (état v27, perf)
Par `(station_id, mois YYYY-MM)` : `litres_carburant, ca_carburant, commission_carburant, ventes_gaz/superette/lubrifiant, recettes_especes, ventes_bon, total_verse, total_depense, total_livraisons, jours`. **v27 la réécrit en agrégation directe** (CTE `dr/dep/exp/del` + jointures) au lieu de sous-requêtes corrélées ligne à ligne → tableau de bord nettement plus rapide. Consommée par `Dashboard` et `Finance`.

### `v_latest_stock` — dernier état de stock connu (v5)
Par station : `derniere_date`, `ess_stock, gas_stock, bons_restant` (dernier `total_bon_cumul`), `gaz_stock_3/6/12/38`, `lubrifiant_stock`, seuils. Chaque colonne = dernière valeur **non nulle** déclarée. Base des alertes stock bas et du bloc « Stock temps réel » du dashboard.

### `v_stock_forecast` — autonomie / prévision (v5)
Conso moyenne/jour sur les **30 derniers relevés** (`avg(ess_litres_retenu)` filtré > 0), puis `jours_essence = ess_stock / conso_ess_jour` (idem gasoil). Colonnes : `conso_ess_jour, conso_gas_jour, jours_essence, jours_gasoil` + stock/seuils.

### `v_stock_recon` — anti-coulage cuve (v13)
Réconciliation cuve : `cuve_attendue = cuve(J) − litres_vendus(J) + livraisons(J)` (livraisons = `sum(cuve_apres−cuve_avant)` des `fuel_orders` reçues du jour), puis `ecart_ess = cuve(J+1) − attendue` (idem gasoil). Un écart > 300 L → alerte `ECART_STOCK` (fuite/vol).

### `v_pertes_livraison` / `v_pertes_mensuelles` — pertes livraison (v16)
Par commande reçue : `livre = cuve_apres − cuve_avant`, `perte_litres = commandé − livré`, `seuil_acceptable = commandé × taux%`, `perte_na_litres` (part au-delà du seuil), `perte_na_montant` (× prix d'achat). Agrégat mensuel = base d'une éventuelle retenue sur salaire du gérant (cf. `Finance`).

### `v_bons_baisses` / `v_bons_hausses` — traçage des bons (v19)
Détecte les variations de l'encours de bons (`total_bon_cumul`) non justifiées : baisse non couverte par commandes (`bons_base`) ni loyer payé en bons → `BONS_INEXPLIQUES` ; hausse > ventes à bon du jour → bons fictifs. **NB** : ces branches d'alerte ont été **retirées de `v_alerts`** lors de la réécriture v27 et non réintroduites en v32 (les vues sous-jacentes existent toujours mais ne sont plus branchées).

### `v_stock_declare_jour` / `v_stock_produits` / `v_sorties_deduites` (v23→v26)
- `v_stock_declare_jour` : dépivote le stock **déclaré** gaz (colonnes) + lubrifiant (jsonb) par produit/jour.
- `v_stock_produits` (réécrite v26) : stock actuel = **dernier relevé déclaré** par produit (`distinct on … order by report_date desc`).
- `v_sorties_deduites` : `sortie(J) = déclaré(veille) + entrées(J) − déclaré(J)`. Une sortie négative = entrée oubliée (signalée en rouge dans `Stock`).

### `v_stock_valeur` — valorisation du stock (v23)
Gaz+lubrifiant : `stock × prix_achat` (catalogue) ; supérette : `stock_initial + entrées − sorties` (en valeur). Affichée dans `Finance` et `Stock` (admin).

### `v_recette_groupe_jour` — recette espèce par groupe de pôle/jour (v27)
Regroupe les pôles pour la réconciliation : `carburant` (ess+gas espèce, + `depense` du jour), `gaz_lub` (gaz+lubrifiant), `superette`. Les dépenses ne sortent que de la caisse **carburant**.

### `v_verse_groupe` — versements regroupés par (groupe, période) (v27)
Mappe `pole` → `pole_groupe` (`gaz/lubrifiant/gaz_lubrifiant → gaz_lub`), somme `verse` et compte `nb_bordereaux` par `(periode_debut, periode_fin)`.

### `v_verse_recon` — réconciliation par période (v27, anti-coulage caisse)
Pour chaque versement (groupe+période) : `recette_periode` (somme des espèces du groupe sur la plage), `depense_periode`, et **`ecart = recette_periode − depense_periode − verse`**. Un `ecart > 1000` (manque) → alerte `VERSEMENT_INCOMPLET`. Principe : un versement peut couvrir plusieurs jours ; on compare le **cumulé** de la période, pas jour par jour.

### `v_pole_recon_jour` — réconciliation jour/groupe pour l'Historique (v27→v33)
Par jour/groupe : `espece, depense, verse` (si une période finit ce jour), `ecart` (porté sur le dernier jour), `nb_cloture`, `couvert` (jour inclus dans une période versée). **v33** ajoute en fin de vue `recette_cloture, depense_cloture` = recette/dépense **cumulées** de la/les période(s) clôturée(s) ce jour (cohérence de l'affichage vs l'écart). Consommée par `History`.

### `v_alerts` — moteur d'alertes (état v32, **la plus réécrite**)
Une ligne par problème : `station_id, report_date, type, gravite, detail`. Branches actives (v32) :
1. `VERSEMENT_INCOMPLET` — écart de période > 1000 (via `v_verse_recon`).
2. `VERSEMENT_MANQUANT` — recette d'un groupe non couverte par un versement depuis > 3 jours.
3. `DEPENSE_NON_JUSTIFIEE` — dépense sans justificatif/motif.
4. `ECART_COMPTEUR` — |litres calculés − déclarés| > 100 L.
5. `STOCK_BAS` — essence/gasoil sous seuil (via forecast).
6. `ECART_STOCK` — anti-coulage cuve (|ecart| > 300 L), **ré-ajouté en v32** après avoir sauté en v27.
7. `POINT_MANQUANT` — jour sans point sur les 14 derniers, pour une station déjà active.

> **Historique important** : `v_alerts` a été recréée à presque chaque migration (v3→v5→v12→v13→v16→v19→v24→v27→v32). Les versions antérieures contenaient aussi `ECART_CAISSE`, `STOCK_BAS_GAZ`, `STOCK_BAS_LUBRIFIANT`, `PERTE_LIVRAISON`, `BONS_INEXPLIQUES`, `ECART_INVENTAIRE`. **La réécriture v27 (par période) a supprimé ces branches** ; seule `ECART_STOCK` a été réintroduite (v32). Les libellés côté front (`ALERT_LABELS`, `format.js`) couvrent encore tous les types historiques, mais tous ne sont plus émis (cf. §13).

### `v_order_reception` — cumul de réception par commande (v28)
Par commande : `quantite_recue_total, reste, nb_receptions, complet` (cumul ≥ commandé − marge `taux_perte_acceptable`). Pilote l'affichage « reste à recevoir » et le passage `partielle → recue`.

### `v_reorder` — prévision de commande carburant (état v30)
Par station × produit (essence/gasoil), croise autonomie (`jours_restant`), **délai de livraison** (`lead`) et marge de sécurité (`secu`) pour produire : `seuil_commande_litres`, `jours_avant_commande`, `date_commande_conseillee`, `date_rupture_estimee`, `commander_maintenant` (bool), `manque_a_gagner_estime` (jours de rupture × conso × marge). **v30** : le `lead` provient du **délai moyen réel calculé** (`v_delai_moyen`), repli sur `settings.delai_livraison_jours` (déf. 3). Affichée dans la carte « 🔮 Prévision de commande » du dashboard.

### `v_order_lead` / `v_delai_moyen` — délai de livraison mesuré (v30)
`v_order_lead` : par commande reçue, `delai_jours = 1re réception − date_lancement`. `v_delai_moyen` : moyenne par station×produit (carburant, délais 0–30 j), + `nb_commandes, delai_min/max`. Alimente `v_reorder`.

### `v_superette_sales` — ventes supérette par produit (v31)
Jointure `superette_sales × products` : `nom` (préféré du catalogue), `quantite, prix_vente, montant, produit_statut`. Vue de synthèse admin.

### `v_attachments_archivables` + `purge_attachments_archivables()` (v29)
Vue = photos au-delà de la rétention (compteur 6 mois, reste 24 mois). Fonction `security definer` (admin only) supprime **les lignes** ; la suppression des **fichiers Storage** est séparée (cf. `ARCHIVAGE.md`, §8).

---

## 7. RLS & sécurité

**Toutes les tables métier ont `enable row level security`.** L'accès API (PostgREST) aux vues est ouvert via `grant select … to authenticated, anon` (le RLS des tables sous-jacentes protège tout de même les données, sauf que les vues sont en `security definer` par défaut du propriétaire — cf. §13, point de vigilance). Politiques principales :

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | soi ou admin | (trigger auto) | soi ou admin (trigger anti-promotion) | — |
| `daily_reports` | admin ou `my_station()` | auth* ; **gérant : `report_date ≥ current_date − 7`** (v11) | auth* ; **gérant : `≥ current_date − 2`** (verrou du passé, v11) | **admin only** |
| `expenses` | admin ou station | auth ∧ **rôle ≠ pompiste** (v11) | (via delete/insert du front) | **admin only** (v11) |
| `deposits` | admin ou station | auth ∧ **rôle ≠ pompiste** | — | **admin only** |
| `deliveries` | admin ou station | auth ∧ **rôle ≠ pompiste** | — | admin ou `created_by` |
| `fuel_orders` | admin ou station | auth ∧ **rôle ≠ pompiste** | admin ou station | **admin only** |
| `order_receptions` | admin ou station | auth ∧ (admin ou station) | — | admin only |
| `stock_movements` | admin ou station | auth ∧ (admin ou station) | — | admin only |
| `superette_sales` | admin ou station | admin ou station | admin ou station | admin ou station |
| `products` | authenticated | **`statut='en_attente'`** (proposition) ; admin : all | admin (all) | admin (all) |
| `charges`, `bank_lines`, `alert_dismissals` | station / admin | **admin only** (for all using is_admin()) | admin | admin |
| `notifications` | admin ou station | (fonction cron) | admin ou station (marquer résolu) | — |
| `stations` | authenticated | admin | admin | — |
| `settings` | authenticated | — | admin | — |
| `suppliers` | authenticated (all) | authenticated | authenticated | authenticated |
| `inspections` | admin ou station | authenticated | — | admin ou `created_by` |
| `audit_log` | **admin only** | (trigger) | — (immuable) | — (immuable) |

\* `auth` = `auth.role() = 'authenticated'`.

**Garanties principales** :
- **Anti-fraude / verrou du passé** : un gérant ne modifie que les 2 derniers jours et ne saisit pas au-delà de 7 jours en arrière ; toute suppression financière est réservée à l'admin.
- **Cloisonnement pompiste** : ne peut pas écrire de données financières (dépôts, dépenses, livraisons, commandes).
- **Journal d'audit immuable** : INSERT via trigger uniquement, aucune policy UPDATE/DELETE → non modifiable depuis l'API.
- **Anti auto-promotion** : trigger `prevent_role_change` (cf. §4).

**Ce que le client ne peut PAS faire** : aucun DDL (CREATE/ALTER/DROP), aucune exécution de fonction non `grant execute`, aucun accès aux données d'une autre station (hors admin), aucune écriture dans `audit_log`/`bank_lines`/`charges` (sauf admin). **La clé anon est publique** (embarquée dans le bundle front, cf. `.env`) — c'est le fonctionnement normal Supabase : elle n'ouvre que ce que le RLS autorise pour un JWT `anon`/`authenticated`.

### Storage policies (`storage_policies.sql`)
Bucket `bordereaux` : `for select to authenticated using (bucket_id='bordereaux')` et `for insert to authenticated …`. Le bucket peut être **privé** (recommandé) ; l'app utilise alors des **URLs signées** (`createSignedUrls`, cf. `Entries.jsx`). `DEPLOIEMENT.md` demande de créer le bucket **public** avec policies INSERT+SELECT — léger écart avec la reco « privé + URLs signées » d'`ARCHIVAGE.md` (cf. §13).

---

## 8. Storage & photos

- **Bucket unique** : `bordereaux` (constante `BORDEREAUX_BUCKET` dans `lib/supabase.js`). Sert à **toutes** les photos : bordereaux de versement, justificatifs de dépenses, compteurs, réceptions, photos-preuves génériques.
- **Compression côté client** (`lib/image.js`, `compressImage`) : avant chaque upload, l'image est redimensionnée à **1600 px max** et ré-encodée en **JPEG qualité 0,7** via `createImageBitmap` + `<canvas>.toBlob`. Une photo de téléphone (3–5 Mo) tombe à ~200–400 Ko (~10×). Non bloquant : GIF ignorés, échec → original renvoyé, et l'original est conservé s'il est déjà plus petit.
- **Convention de chemins** (`Submit.jsx`, `Orders.jsx`) : `${stationId}/<catégorie>/${date}/${Date.now()}_${nomFichierAssaini}` — ex. `1/depenses/2026-07-13/...`, `1/reception/...`, `1/compteurs/...`, `1/photos/...`, et `${sid}/${date}/...` pour les bordereaux de versement. Le nom de fichier est assaini (`replace(/[^\w.\-]/g,'_')`).
- **Affichage** : `getPublicUrl` (bucket public) ou `createSignedUrls(paths, 3600)` (bucket privé, `Entries.jsx`). Les vignettes s'ouvrent en plein écran (`<a target="_blank">`).
- **Obligation métier** (front) : photo **obligatoire** pour chaque dépense, chaque versement, chaque compteur saisi et chaque réception (validations bloquantes dans `Submit.save()` / `receptionOrder()`).
- **Archivage** (`ARCHIVAGE.md`, `v_attachments_archivables`, `purge_attachments_archivables()`) : rétention 6 mois (compteurs) / 24 mois (preuves comptables). Purge en 2 temps : d'abord les **fichiers** du bucket (Edge Function ou manuel — SQL ne supprime pas les objets Storage), puis les **lignes** en base via la fonction admin.

---

## 9. Edge Functions & intégrations

### `ocr-bordereau` (Deno, `supabase/functions/ocr-bordereau/index.ts`)
Seule fonction serveur. Rôle : lire automatiquement le montant/date/référence sur la photo d'un bordereau et le comparer au montant déclaré.

- **Entrée** : `POST { deposit_id }`. Gère CORS + `OPTIONS`.
- **Traitement** : crée un client Supabase avec la **`SUPABASE_SERVICE_ROLE_KEY`** (contourne le RLS), récupère `deposits`, télécharge la photo du bucket `bordereaux`, l'encode en base64, puis appelle **l'API Anthropic Vision** (`https://api.anthropic.com/v1/messages`, modèle **`claude-sonnet-4-6`**, `max_tokens: 300`) avec un prompt spécialisé « reçu bancaire BOA Bénin » qui impose une réponse **JSON compact** `{montant, date, reference}`.
- **Sortie** : parse le JSON (regex `\{…\}`), calcule `ocr_ecart = montant_ocr − montant`, et **met à jour `deposits`** (`montant_ocr, date_ocr, ref_ocr, ocr_ecart, ocr_at`). Renvoie le comparatif au front.
- **Secrets** : `ANTHROPIC_API_KEY` (`sk-ant-…`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Déploiement via `supabase functions deploy ocr-bordereau` + `supabase secrets set …` (ou dashboard). La clé IA **n'est jamais côté navigateur** (déportée serveur).
- **Front** : `pages/OcrCheck.jsx` liste les bordereaux avec photo et déclenche `supabase.functions.invoke('ocr-bordereau', { body:{deposit_id} })` ; écart ≤ 100 F = ✓ OK, sinon rouge.

### pg_cron — notifications 8h/16h (v9, v14)
Extension `pg_cron` (à activer). Deux jobs : `notif-matin-8h` (`0 7 * * *` UTC ≈ 8h Bénin UTC+1) et `notif-16h-17h` (`0 16 * * *`). Chacun appelle `notify_missing('matin'|'apres-midi')`, fonction `security definer` qui insère une `notifications` pour chaque station **active** dont le `submissions` du moment manque (anti-doublon dans la journée). Le bandeau `NotifBanner` les affiche et permet de les marquer « Traité » (`resolved=true`).

> **Historique de planification** : v9 planifie 9h/17h, v14 déplace la notif du matin à 8h (`notif-matin-8h`) en `unschedule`-ant l'ancien job. L'état courant est donc **8h + 16h**.

---

## 10. Front-end

### Routing & lazy loading
- `main.jsx` : `BrowserRouter > AuthProvider > App`. `App` : si `loading` → écran d'attente ; si pas de `session` → `Login` ; sinon `StationProvider > Shell > Suspense > Routes`.
- `Shell` : sidebar responsive (hamburger + overlay mobile), navigation conditionnelle au rôle, `StationPicker`, badge de rôle, bouton déconnexion.
- Routes protégées par ternaires `isAdmin ? <Page/> : <Navigate to="/saisie"/>` (cf. §4). Rewrite SPA côté hébergeur (`vercel.json` : tout → `/index.html`).

### Contextes
- **AuthCtx** (`useAuth`) : session, profil, rôles booléens, actions auth.
- **Ctx station** (`useStation`) : `stations, stationId, setStationId, current, isAdmin`.

### Conventions notables
- **Nombres « à la française »** (`format.js`) : `numFR` interprète le point/espace comme séparateur de milliers (ignoré) et la virgule comme décimale (`"4.277.213" → 4277213`, `"10,5" → 10.5`). `fcfa` formate en FCFA arrondi (`toLocaleString('fr-FR') + ' F'`), `num`, `frDate` (`jj/mm/aaaa`), `today` (ISO `YYYY-MM-DD`).
- **Upsert idempotent** : les écritures du point utilisent `upsert(..., { onConflict: 'station_id,report_date' })` ; les alertes masquées `onConflict: 'station_id,report_date,type'`. Pattern « delete-then-insert » pour les collections liées d'un jour (`expenses`, `deliveries`, `deposits`, `superette_sales`) → resaisie/correction sans doublon.
- **Requêtes parallèles** : les chargements de page groupent les requêtes en `Promise.all` (ex. `Submit.load` = 7 requêtes en parallèle ; `Dashboard`, `Stock`, `Finance`, `Orders`). Le dashboard affiche le stock (rapide) en premier et remplit les blocs lourds (mensuel, alertes) sans bloquer le rendu.
- **Realtime** : `Dashboard.jsx` s'abonne à `supabase.channel('stock-'+stationId).on('postgres_changes', { table:'daily_reports', filter:'station_id=eq.X' }, loadStock)` → le stock temps réel se met à jour dès qu'un point est enregistré. `daily_reports` est publiée dans `supabase_realtime` (v3). `NotifBanner` fait du polling (5 min), pas du realtime.
- **Gestion d'erreurs** : pattern local `const { error } = await supabase…; if (error) setErr(error.message)`. Messages francisés, validations bloquantes côté front (photos, période, relevés 16h obligatoires). Pas de librairie d'état global ni de toasts génériques (petits « flash » locaux `setTimeout`).
- **Graphiques** : Recharts (`BarChart` mensuel « Ventes bon / Espèces / Versé » dans `Dashboard`).

### Écrans clés (résumé fonctionnel)
- **Submit** (700 lignes) : saisie par **moment** (matin = stock+ouverture ; 16h = ventes+compteurs ; soir = achats/dépenses/versements) avec « Tout afficher (avancé) ». Réception de commandes possible à tout moment. **Mode vendeuse** distinct : ventes supérette ligne par ligne (produit du catalogue ou proposition d'un nouveau `en_attente`), total → `superette_espece`. Verrou du passé côté front (`locked` si > 2 jours et non-admin).
- **Orders** : proposition (admin valide), lancement (date), réception partielle/totale (met à jour cuve/stock, statut, mouvements). Affiche pertes livraison vs seuil.
- **Stock** : stock restant (dernier comptage déclaré), actions guidées (livraison = entrée, inventaire = ajustement), valorisation (admin), sorties déduites (admin), journal des mouvements.
- **Dashboard** : stock temps réel + autonomie, prévision de commande, KPI mensuels filtrables, répartition Bon/Espèce carburant, réconciliation versements par mois.
- **History / Entries** : réconciliation par jour/pôle et détail complet d'une journée (toutes valeurs + vignettes photos, URLs signées).
- **Finance** : compte de résultat mensuel (commissions auto par pôle, charges auto SBEE/carburant depuis les dépenses, charges fixes reportables d'un mois sur l'autre, pertes non acceptables, valeur du stock, résultat).
- **BankRecon** : appariement glouton lignes bancaires ↔ versements (montant ±200 F, date ±7 j) ; met en évidence non rapprochés des deux côtés.
- **Alerts** : lit `v_alerts`, filtre par type/année/mois, masque via `alert_dismissals`.
- **AuditLog** : journal immuable, diff lisible des champs surveillés.
- **Stations** : édition stations + seuils, **gestion de l'équipe** (rôle + rattachement station), prix & marge, taux de commission, références lubrifiant.

---

## 11. Déploiement

### Front (Vercel)
- **Build** : `npm install && npm run build` → `dist/` (statique). Rewrite SPA via `vercel.json`.
- **Variables d'env** (Vite, préfixe `VITE_`, injectées au build) : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (cf. `.env.example`). En l'absence des deux, `lib/supabase.js` log un warning et retombe sur des valeurs factices (`http://localhost` / `anon`).
- **Projet Vercel** : `.vercel/project.json` → `projectName: "station"` (projectId/orgId présents). Alias public **`station-beta-green.vercel.app`**. Procédure (d'après le prompt) : `vercel --prod` déclenche un **build distant** ; **l'alias est posé manuellement**.
- **`.env.local`** contient un `VERCEL_OIDC_TOKEN` (jeton CLI). `.gitignore` exclut `node_modules, dist, .env, .env*, .vercel`.

> ⚠️ **Écart de documentation** : `DEPLOIEMENT.md` décrit un déploiement **Netlify** (glisser `dist` sur Netlify Drop). Le projet réel est déployé sur **Vercel** (dossier `.vercel/`, alias `station-beta-green.vercel.app`). `DEPLOIEMENT.md` est donc obsolète sur ce point (cf. §13). La logique reste identique (build statique + rewrite SPA).

### Backend (Supabase — exécuté manuellement)
Le client **ne peut pas exécuter de DDL** : l'utilisateur colle les scripts dans **Supabase → SQL Editor → Run**, dans l'ordre. Séquence (`DEPLOIEMENT.md`, complétée par les migrations postérieures) :
1. Créer le projet Supabase, activer **pg_cron** (Database → Extensions).
2. `schema.sql` → (option) `seed_from_audit.sql` → `migration_v2.sql` … jusqu'à la dernière (`v33`). Les regroupements `migrations_v14_v24.sql`, `migration_FINALE_v27_v30.sql`, `migration_v31_v33.sql` permettent de jouer plusieurs versions d'un coup.
3. Créer le bucket **`bordereaux`** + policies (`storage_policies.sql`).
4. Auth → Providers → Email → décocher « Confirm email ».
5. Créer le compte admin dans l'app, puis en SQL : `update profiles set role='admin' where id=(select id from auth.users where email='…')`. Rattacher les gérants à leur station (écran Stations ou SQL).
6. (Option) OCR : `supabase secrets set ANTHROPIC_API_KEY=…` + `supabase functions deploy ocr-bordereau`.

> Le déploiement **front** et le déploiement **schéma** sont indépendants : l'usage quotidien ne nécessite aucun redéploiement (les données vivent dans Supabase). Un changement de schéma = coller le nouveau SQL ; un changement de code = `vercel --prod`.

---

## 12. Conventions de migration

- **Fichiers** : `supabase/migration_v<NN>.sql`, numérotés séquentiellement. Chaque fichier commence par un cartouche décrivant l'objet + le prérequis (« après vNN »). Regroupements consolidés pour rejouer plusieurs versions d'un coup.
- **Idempotence / rejouabilité** : usage systématique de `create table if not exists`, `add column if not exists`, `create or replace function/view`, `drop policy if exists` + `create policy`, `insert … on conflict do nothing`, `do $$ … exception when … $$`. Les migrations sont annoncées « idempotentes, réexécutables sans casse ».
- **Ordre** : strictement croissant ; les migrations tardives **supersèdent** les définitions antérieures (une même vue, ex. `v_alerts`, est recréée ~9 fois — seule la dernière compte).
- **Contrainte `CREATE OR REPLACE VIEW`** : Postgres **interdit de renommer/réordonner/retirer** des colonnes existantes ; il n'autorise que l'**ajout de colonnes en fin**. Deux techniques dans le dépôt :
  - Ajout en fin de vue (ex. v33 ajoute `recette_cloture, depense_cloture` à la fin de `v_pole_recon_jour`, avec commentaire explicite).
  - Sinon **`drop view … cascade` puis `create view`** quand les colonnes changent (ex. v3, v5, v27, v29, v30 : `drop view if exists v_alerts / v_reorder cascade`). Le `cascade` nettoie les vues dépendantes, qui sont ensuite recréées dans le bon ordre.
- **pg_cron** : (re)planification via `do $$ perform cron.unschedule(...) exception when others then null $$` puis `cron.schedule(...)` → rejouable.
- **Backfill** : les migrations structurantes rétro-remplissent (`update … set station_id=s1 where station_id is null` en v3 ; reprise des périodes de versement en v27).

---

## 13. Dette technique & risques connus

1. **`v_alerts` a perdu des branches d'alerte** lors de la réécriture v27 (passage à la réconciliation par période). Ne sont **plus émis** : `ECART_CAISSE`, `STOCK_BAS_GAZ`, `STOCK_BAS_LUBRIFIANT`, `PERTE_LIVRAISON`, `BONS_INEXPLIQUES`, `ECART_INVENTAIRE` (seul `ECART_STOCK` a été réintroduit en v32). Or `format.js/ALERT_LABELS` et la page Alertes affichent encore ces types → **libellés « morts »** et perte de couverture anti-fraude (les vues sources `v_bons_baisses/hausses`, `v_pertes_livraison` existent mais ne sont plus branchées). À réconcilier.
2. **Documentation de déploiement obsolète** : `DEPLOIEMENT.md` cible Netlify, le projet est sur Vercel. La checklist SQL s'arrête à v11 alors que le schéma va à v33.
3. **Vues exposées `anon`** : `grant select … to anon` sur beaucoup de vues, et les vues sont en `security definer` par défaut (owner). Le RLS des tables sous-jacentes protège, mais toute vue qui n'hérite pas correctement du RLS pourrait sur-exposer. À auditer (notamment que `anon` sans JWT ne lise rien de sensible ; en pratique l'app exige une session).
4. **Cohérence stock/prix multi-station** : `settings` est **une ligne globale unique** (`id=1`) — prix de vente, marges, seuils réappro, `superette_stock_initial` sont **partagés par toutes les stations**. Multi-station réel mais paramètres non séparés par station.
5. **`v_stock_recon`/`v_pertes_livraison` supposent `fuel_orders.statut='recue'` avec `cuve_avant/apres`** ; avec les réceptions **partielles** (v28, `order_receptions`), la logique cuve reste portée par `fuel_orders` (cuve_apres = dernier niveau) — cohérence à vérifier sur les commandes multi-réceptions.
6. **Doublon de catalogue lubrifiant** : `lubrifiant_types` (v18) et `products(categorie='lubrifiant')` (v21) coexistent ; `Submit` lit `products`, `Stations` édite `lubrifiant_types`. Source de vérité ambiguë.
7. **Bucket public vs privé** : `DEPLOIEMENT.md` crée le bucket public ; `ARCHIVAGE.md` recommande privé + URLs signées (déjà supporté par `Entries.jsx`). État à figer.
8. **Pas de CI/CD ni de tests automatisés** : les `test_*.mjs` sont des scripts locaux (`node fichier.mjs`) contre Supabase, non intégrés à un pipeline. Aucun typage (JS pur, pas de TypeScript côté front).
9. **Clé de secours factice** : si les variables d'env manquent, `createClient('http://localhost','anon')` — l'app « démarre » mais échoue silencieusement sur toutes les requêtes (warning console seulement).
10. **`e1..e4/g1..g4` (compteurs 16h) vs `*_m` (ouverture)** : deux jeux de compteurs, sémantique subtile (les litres « retenus » viennent des relevés d'ouverture consécutifs). Documentation métier indispensable pour éviter les erreurs de saisie/interprétation.

---

*Fin du document. Toutes les références de fichiers sont relatives à la racine du dépôt `station-app`.*
