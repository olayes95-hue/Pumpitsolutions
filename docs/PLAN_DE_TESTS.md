# Plan de tests — Station Beau Rivage

Application de suivi quotidien d'une station-service : saisie gérant/pompiste/vendeuse
+ tableau de bord admin avec alertes, finance, stock, commandes et rapprochement bancaire.

Stack : **React 18 + Vite + react-router-dom + Supabase JS + Recharts**, UI en français.

Ce document décrit la stratégie de test complète. La couche **unitaire** est déjà
automatisée (Vitest, voir `tests/`). Les couches **intégration** et **E2E** sont
spécifiées ici et à mettre en place selon la feuille de route (§7).

---

## 1. Outillage en place

| Élément | Valeur |
|---|---|
| Lanceur de tests | **Vitest** (`vitest.config.js`) |
| Environnement DOM | **jsdom** |
| Rendu composants | **@testing-library/react** + **@testing-library/jest-dom** |
| Setup global | `tests/setup.js` (import jest-dom, `cleanup()` après chaque test) |
| Emplacement | `tests/**/*.{test,spec}.{js,jsx}` (+ `src/**/__tests__/**`) |

Commandes :

```bash
npm run test        # mode watch (développement)
npm run test:run    # exécution unique headless (CI)
npm run coverage    # rapport de couverture (nécessite @vitest/coverage-v8)
```

### Tests unitaires déjà écrits (tous verts)

- `tests/format.test.js` — `fcfa`, `num`, `today`, `numFR`, `frDate`, `ALERT_LABELS`
  (cas limites : vide, null, `NaN`, `"4.277.213"`, `"10,5"`, espaces, format FR complet
  `"4.277.213,50"`, chaîne d'espaces → 0, texte non numérique → null).
- `tests/image.test.js` — `compressImage` (branches non-bloquantes : non-image, GIF,
  null, repli sur l'original quand le canvas est indisponible).
- `tests/NotifBanner.test.jsx` — rendu du composant `NotifBanner` avec Supabase et le
  contexte station **mockés** (`vi.mock`).

---

## 2. Inventaire des fonctionnalités, pages et rôles

Rôles applicatifs (déduits de `src/lib/auth.jsx`) : **admin**, **pompiste**,
**vendeuse**, et **gérant** (rôle par défaut, ni admin/pompiste/vendeuse).

Redirection par défaut (`src/App.jsx`) : admin → `/tableau`, vendeuse → `/stock`,
autres → `/saisie`.

| Page (route) | Fichier | Rôles autorisés | Fonction métier |
|---|---|---|---|
| Connexion (`/`) | `Login.jsx` | tous (déconnecté) | Authentification e-mail/mot de passe |
| Saisie du jour (`/saisie`) | `Submit.jsx` | tous | Relevés compteurs matin/16h, index cuves, versements, dépenses, photos |
| Aide (`/aide`) | `Aide.jsx` | tous | Documentation intégrée |
| Stock & mouvements (`/stock`) | `Stock.jsx` | tous (vue « Supérette » pour vendeuse) | Entrées, ajustements, inventaire multi-pôles (gaz/lubrifiant/supérette) |
| Commandes (`/commandes`) | `Orders.jsx` | admin, gérant (pas pompiste/vendeuse) | Commande multi-produits + réception livraison |
| Contrôles ANM (`/controles`) | `Inspections.jsx` | admin, gérant | Inspections réglementaires |
| Tableau de bord (`/tableau`) | `Dashboard.jsx` | admin | KPIs, graphiques Recharts |
| Historique des points (`/historique`) | `History.jsx` | admin | Historique des points du jour + réconciliation par pôle |
| Saisies & photos (`/saisies`) | `Entries.jsx` | admin | Consultation des saisies + bordereaux (URLs signées) |
| Alertes (`/alertes`) | `Alerts.jsx` | admin | Liste et traitement des alertes (cf. `ALERT_LABELS`) |
| Point financier (`/finance`) | `Finance.jsx` | admin | Charges récurrentes, dépenses → charges, résultat |
| Rapprochement (`/rapprochement`) | `BankRecon.jsx` | admin | Appariement versements ↔ relevés banque (tolérance 200 F, fenêtre 7 j) |
| Vérif bordereaux (`/verif-photos`) | `OcrCheck.jsx` | admin | Contrôle OCR des bordereaux de dépense |
| Journal d'audit (`/audit`) | `AuditLog.jsx` | admin | Diff lisible des modifications |
| Produits & prix (`/produits`) | `Products.jsx` | admin | CRUD produits, catégories, prix |
| Fournisseurs (`/fournisseurs`) | `Suppliers.jsx` | admin | CRUD fournisseurs |
| Stations & équipe (`/stations`) | `Stations.jsx` | admin | CRUD stations + affectation des profils/rôles |

Fonctions transverses : `NotifBanner` (bandeau de notifications non résolues),
`StationPicker` (sélecteur de station admin / chip station fixe pour les autres).

---

## 3. Classification par type de test

| Type | Critère | Portée |
|---|---|---|
| **Unitaire** | Logique pure, sans DB ni réseau | `src/lib/format.js`, `src/lib/image.js`, seuils/constantes (`TOL=200`, `WIN=7`, listes produits par défaut), et tout futur helper pur extrait des pages |
| **Composant** | Rendu isolé avec Supabase/cont*ext* mockés | `NotifBanner`, `StationPicker`, sous-composants présentationnels ; formulaires de `Submit`/`Stock` si extraits en composants purs |
| **Intégration** | Nécessite un **Supabase de test** réel (RLS, RPC, vues, triggers) | `auth.jsx`, `station.jsx`, chargements de pages, écritures (`saisie`, `versement`, `commande`), génération d'alertes/notifications par le planificateur, vues `v_pole_recon_jour`, politiques RLS par rôle |
| **E2E (Playwright)** | Parcours utilisateur complet, navigateur réel, contre un environnement seedé | Connexion par rôle, saisie du jour, versement + réconciliation, commande + réception, produit vendeuse à valider, alertes cuve, etc. |

Règle appliquée : **on ne simule jamais** le comportement d'une base réelle (RLS,
triggers, vues) dans un test unitaire. Tout ce qui en dépend est classé
intégration/E2E et documenté ici plutôt que « fauxté ».

### Détail par page

- **Unitaire / composant** (faisable tout de suite, sans DB) : helpers de format,
  compression d'image, logique d'appariement `BankRecon` si extraite en fonction pure,
  calculs d'écarts (caisse, compteur, cuve) si extraits, mapping `ALERT_LABELS`.
- **Intégration** (Supabase de test requis) : `Login`, `Submit`, `Stock`, `Orders`,
  `Products`, `Suppliers`, `Stations`, `Finance`, `Dashboard`, `History`, `Entries`,
  `Alerts`, `AuditLog`, `Inspections`, `OcrCheck`, `NotifBanner` (contre vraies notifs).
- **E2E** : tous les parcours critiques du §5.

---

## 4. Mise en place Playwright (E2E)

```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

`playwright.config.js` (esquisse) :

```js
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    locale: 'fr-FR',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile',   use: { ...devices['Pixel 5'] } }, // les gérants saisissent au téléphone
  ],
})
```

Bonnes pratiques :

- **Sessions par rôle** : un `storageState` pré-authentifié par rôle
  (`e2e/.auth/admin.json`, `gerant.json`, `pompiste.json`, `vendeuse.json`) généré via
  un projet « setup » qui se connecte une fois par rôle et réutilise l'état.
- Le front doit pointer vers le **projet Supabase de test** (`.env.test`, cf. §6),
  jamais la production.
- Sélecteurs stables : privilégier `getByRole`/`getByText` (UI française) ou ajouter des
  `data-testid` sur les éléments clés ; éviter les sélecteurs CSS fragiles.
- Réinitialiser/seed la base **avant** la suite (script de seed idempotent, cf. §6).

---

## 5. Top 15 des scénarios E2E critiques à automatiser

1. **Connexion par rôle** — chaque rôle (admin, gérant, pompiste, vendeuse) se connecte
   et atterrit sur sa page par défaut ; un mauvais mot de passe affiche l'erreur FR.
2. **Contrôle d'accès (RBAC)** — un non-admin naviguant vers `/tableau`, `/finance`,
   `/audit`… est redirigé vers `/saisie` (ou `/stock` pour la vendeuse).
3. **Saisie du jour (gérant)** — relevés compteurs matin + 16h, index cuves, calcul
   automatique des volumes vendus, enregistrement du point du jour.
4. **Saisie avec photo** — ajout d'un bordereau de dépense (upload image compressée),
   vérification que la photo est bien attachée et consultable côté admin (`/saisies`).
5. **Versement + réconciliation** — saisie d'un versement, puis dans `/rapprochement`
   appariement automatique avec un relevé banque (tolérance 200 F / fenêtre 7 j) ;
   cas d'écart au-delà de la tolérance → non apparié.
6. **Alerte versement manquant/incomplet** — journée sans versement (ou partiel) →
   génération de l'alerte `VERSEMENT_MANQUANT` / `VERSEMENT_INCOMPLET`, visible dans
   `NotifBanner` et `/alertes`, puis marquée « Traité ».
7. **Commande multi-produits + réception** — création d'une commande (carburant essence
   + gasoil + lubrifiants), réception partielle puis totale, mise à jour du stock et
   détection `PERTE_LIVRAISON > 5 %`.
8. **Produit vendeuse à valider** — la vendeuse saisit une vente/mouvement supérette qui
   passe en attente de validation admin ; l'admin valide → stock ajusté.
9. **Alerte cuve / écart de stock** — index cuve incohérent avec les ventes →
   `ECART_STOCK` (coulage) et/ou `STOCK_BAS` carburant ; traitement de l'alerte.
10. **Écart de caisse & dépense non justifiée** — dépense sans justificatif → 
    `DEPENSE_NON_JUSTIFIEE` ; écart caisse → `ECART_CAISSE`.
11. **Point financier** — saisie de charges récurrentes, report d'un mois sur l'autre,
    intégration des dépenses quotidiennes en charges, calcul du résultat.
12. **Rapprochement bancaire — import relevé** — chargement d'un relevé, appariement en
    masse, gestion des lignes orphelines des deux côtés.
13. **Administration produits/prix** — création/modification d'un produit et de son prix,
    répercussion sur une nouvelle saisie/commande.
14. **Stations & équipe** — création d'une station, affectation d'un gérant à une station,
    vérification que le sélecteur de station (admin) et le chip (non-admin) reflètent l'affectation.
15. **Historique & audit** — consultation de l'historique des points + réconciliation par
    pôle (`v_pole_recon_jour`), et vérification qu'une modification apparaît dans le
    journal d'audit avec un diff lisible.

Scénarios secondaires (à ajouter ensuite) : contrôles ANM (`/controles`), vérif OCR des
bordereaux (`/verif-photos`), notifications du planificateur 9h/17h, multi-station.

---

## 6. Base Supabase de test jetable + seed (intégration & E2E)

Objectif : une base **éphémère**, isolée de la production, réinitialisable, seedée avec
des données déterministes (une station, un utilisateur par rôle, produits, quelques
journées de saisie).

### Option A — Supabase local (recommandé pour la CI)

```bash
npm install -D supabase            # ou brew install supabase/tap/supabase
supabase init                      # si non déjà fait
supabase start                     # démarre Postgres + Auth + Storage en Docker
supabase db reset                  # applique migrations supabase/*.sql + seed
```

- `supabase start` expose une URL locale et une clé anon → à placer dans `.env.test`
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Les migrations SQL du dossier `supabase/` (schéma, vues comme `v_pole_recon_jour`,
  triggers, RLS) sont appliquées automatiquement, ce qui garantit une parité avec la prod.
- `supabase db reset` rejoue tout **+ le seed** → base propre à chaque exécution.

### Option B — Projet Supabase cloud dédié « test »

- Un projet Supabase séparé (jamais la prod), ses secrets stockés dans le CI
  (GitHub Actions secrets), un script de reset+seed exécuté avant la suite.

### Seed déterministe

Créer `supabase/seed.sql` (ou réutiliser/adapter `load_seed.mjs` déjà présent à la racine) :

- 1 station de test (`Station Test`).
- 4 comptes Auth : `admin@test`, `gerant@test`, `pompiste@test`, `vendeuse@test` avec
  profils/rôles et `station_id` renseignés.
- Catalogue produits (essence, gasoil, gaz, lubrifiants, articles supérette) + prix.
- 2–3 journées de saisie complètes pour alimenter historique, finance et rapprochement.

Le seed doit être **idempotent** (upsert / `on conflict do nothing`) pour pouvoir être
rejoué. Ne jamais pointer les scripts `test_*.mjs` de la racine (anciens scripts manuels)
vers la production.

### Sécurité des tests d'intégration

- Utiliser la **clé anon** (pas la `service_role`) côté front pour tester réellement les
  politiques **RLS** par rôle.
- Un helper de connexion par rôle (`signInWithPassword`) réutilisable entre tests.

---

## 7. Feuille de route de couverture (par phases)

### Phase 0 — Socle (FAIT ✅)
- Vitest + jsdom + Testing Library installés et configurés.
- Tests unitaires `format.js` + `image.js` (cas limites).
- 1 test composant (`NotifBanner`) avec Supabase mocké.
- `npm run test:run` vert en CI.

### Phase 1 — Élargir l'unitaire (sans DB)
- Extraire en fonctions pures la logique métier enfouie dans les pages (calcul des
  volumes vendus, écarts caisse/compteur/cuve, appariement `BankRecon`, seuils d'alerte)
  puis les couvrir par des tests unitaires. *(Nécessite de refactorer `src/pages/*`,
  actuellement modifiés par un autre process — à coordonner.)*
- Tests composant supplémentaires : `StationPicker`, éléments de formulaire présentationnels.
- Ajouter `@vitest/coverage-v8` et fixer un seuil (ex. lignes ≥ 70 % sur `src/lib`).

### Phase 2 — Intégration (Supabase de test)
- Mettre en place Supabase local + seed (§6) et un `.env.test`.
- Tests d'intégration : `auth.jsx`/`station.jsx`, RLS par rôle, chargement des pages
  clés, écritures (saisie, versement, commande), génération d'alertes/notifications,
  vues de réconciliation.
- Brancher ces tests dans un projet Vitest séparé (env `node`, pas jsdom) ou via des
  scripts dédiés, exécutés contre l'instance locale.

### Phase 3 — E2E Playwright
- Installer Playwright + sessions par rôle (§4).
- Automatiser les 15 scénarios critiques (§5) contre la base seedée.
- Exécution en CI (Chromium + profil mobile), traces sur échec.

### Phase 4 — Intégration continue & qualité
- Pipeline CI : `npm run test:run` (unitaire) sur chaque PR ; intégration + E2E sur la
  branche principale / nightly (Supabase local en service Docker).
- Rapports de couverture + tendance ; budget de non-régression sur les alertes et la
  finance (les zones à plus fort risque métier).
- Données de test versionnées et idempotentes ; aucun test flaky toléré.

---

## 8. Résumé exécution

```bash
# Unitaire (headless, CI) — 30 tests verts aujourd'hui
npm run test:run

# Unitaire en watch (développement)
npm run test

# (à venir) intégration contre Supabase local
supabase start && supabase db reset && npm run test:run

# (à venir) E2E
npx playwright test
```
