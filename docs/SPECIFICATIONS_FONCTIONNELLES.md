# Spécifications fonctionnelles — Application de gestion de station-service

> Document dérivé **intégralement de la lecture du code source** (`src/` React + Vite, `supabase/*.sql`, Edge Function `ocr-bordereau`). Chaque règle énoncée correspond à un comportement effectivement implémenté. Les points non évidents (réconciliation par période, anti-coulage cuve, produits « en attente ») sont explicités. Les incohérences ou limites relevées dans le code sont signalées en fin de document et au fil de l'eau.

---

## 1. Introduction & objectif

### 1.1 Contexte

L'entreprise exploite deux stations-service au Bénin : **Beaurivage** (station n°1) et **Vedoko** (station n°2). Le suivi quotidien de l'exploitation (ventes, caisse, stocks, versements en banque) était auparavant assuré de façon informelle **via WhatsApp** : messages, photos de bordereaux et de compteurs envoyés au fil de la journée, sans structure ni contrôle.

Cette application web remplace ce suivi WhatsApp par un **outil structuré, multi-station, avec pistes d'audit et détection automatique d'anomalies**. Elle vise trois objectifs :

1. **Fiabiliser la saisie** du « point du jour » (ventes carburant/gaz/lubrifiant/supérette, compteurs, stocks) par le personnel de station, avec **preuves photo obligatoires**.
2. **Contrôler la remontée de l'argent** : rapprocher les recettes espèces déclarées, les dépenses, les versements en banque (avec photo de bordereau) et le relevé bancaire réel.
3. **Piloter** : tableau de bord, prévision de réapprovisionnement carburant, point financier mensuel, alertes anti-fraude et anti-coulage.

### 1.2 Nature technique

- **Frontend** : React (Vite), routage `react-router-dom`, graphiques `Recharts`. Interface **entièrement en français**, pensée **mobile-first** (saisie au téléphone sur le terrain).
- **Backend** : **Supabase** (PostgreSQL, Auth, Storage, Row Level Security). La logique métier lourde (métriques, alertes, réconciliation, prévisions) est portée par des **vues SQL** (`v_*`) et des triggers, pas par le client.
- **IA** : une Edge Function `ocr-bordereau` lit le montant d'un bordereau de versement par vision (API Anthropic) et le compare au montant déclaré.
- **Stockage photos** : bucket Supabase Storage nommé `bordereaux`. Toutes les images sont **compressées côté client avant envoi** (redimension max 1600 px, JPEG qualité 0,7).

---

## 2. Glossaire

| Terme | Définition (telle qu'utilisée dans le code) |
|---|---|
| **Point du jour / Point journalier** | Enregistrement quotidien d'exploitation d'une station (table `daily_reports`). Une seule ligne par couple (station, date). |
| **Moment** | Sous-partie de la journée de saisie : **Matin (8h)** = stock + relevés d'ouverture ; **16 h** = ventes de la veille + relevés 16 h (obligatoires) ; **Soir** = achats, dépenses, versements. |
| **Bon** | Vente de carburant réglée **par bon** (crédit client, non encaissée en espèces). Suivie séparément de l'espèce. Le **cumul des bons en cours** (`total_bon_cumul`) est un encours. |
| **Espèce** | Recette encaissée en liquide. C'est l'espèce (pas le bon) qui doit être versée en banque. |
| **Versement / Bordereau** | Dépôt d'espèces en banque (table `deposits`), justifié par la **photo du bordereau**. Un versement porte sur un **pôle** et couvre une **période** (`periode_debut` → `periode_fin`). |
| **Pôle** | Source de la recette : `carburant`, `gaz`, `lubrifiant`, `gaz_lubrifiant`, `superette`. Pour la réconciliation, ils sont regroupés en 3 **groupes** : `carburant`, `gaz_lub` (gaz + lubrifiant + gaz_lubrifiant), `superette`. |
| **Cuve** | Réservoir de carburant enterré. Le **niveau cuve** (litres) est déclaré chaque matin et mis à jour à chaque réception (cuve avant / cuve après dépotage). |
| **Compteur (index)** | Totalisateur de volume d'une pompe. 8 pompes : E1–E4 (essence), G1–G4 (gasoil). Relevés **à l'ouverture** (`*_m`) et **à 16 h** (contrôle). |
| **Coulage** | Perte de volume en cuve inexpliquée (fuite, vol). Détecté par l'écart entre la cuve déclarée et la cuve « attendue » (alerte `ECART_STOCK`). |
| **ANM** | Agence Nationale de Métrologie. Contrôles inopinés de conformité des pompes (prélèvement, retour en cuve, conformité). |
| **Coût de revient / COGS** | Coût des marchandises vendues. Pour la supérette (suivie en valeur), estimé à `recette × (1 − taux_superette%)`. |
| **Marge unitaire carburant** | Marge FCFA par litre (par défaut **25 F/L**), base de la commission carburant. |
| **Perte livraison** | Écart entre litres commandés et litres réellement reçus en cuve. Au-delà du seuil toléré (`taux_perte_acceptable`, défaut **5 %**), elle est « non acceptable ». |

---

## 3. Rôles & permissions

### 3.1 Les quatre rôles

Le rôle est porté par `profiles.role` et lu dans `src/lib/auth.jsx` (`isAdmin`, `isPompiste`, `isVendeuse`, sinon **gérant** par défaut). À l'inscription, un compte est créé automatiquement en rôle **`gérant`** (trigger `handle_new_user`). Seul un admin peut changer un rôle (trigger `prevent_role_change` + RLS).

- **admin** (direction) : accès total, toutes stations, tout le pilotage/finance/administration.
- **gérant** : exploitation d'**une** station (celle de `profiles.station_id`). Saisie complète du point, commandes, contrôles, stock.
- **pompiste** : saisit uniquement **compteurs, stock et photos**. Pas d'accès aux ventes, versements, dépenses, commandes.
- **vendeuse** : saisit uniquement les **ventes de la supérette** (par produit) et voit le **stock supérette**.

### 3.2 Périmètre station (RLS)

Deux fonctions SQL `security definer` cadrent l'accès :
- `is_admin()` → l'utilisateur est admin ;
- `my_station()` → `profiles.station_id` de l'utilisateur.

Règle générale des politiques RLS : **admin voit/écrit tout ; les autres sont limités à leur station** (`station_id = my_station()`). Côté frontend, le sélecteur de station (`StationPicker`) n'est un menu déroulant **que pour l'admin** ; les autres voient leur station figée.

### 3.3 Matrice rôle × page (dérivée de `App.jsx` — nav + gardes de routes)

| Page (route) | admin | gérant | pompiste | vendeuse |
|---|:---:|:---:|:---:|:---:|
| **Saisie du jour** `/saisie` | ✅ (complet) | ✅ (complet) | ✅ (compteurs/stock/photos) | ✅ (supérette uniquement) |
| **Aide** `/aide` | ✅ | ✅ | ✅ | ✅ |
| **Stock & mouvements** `/stock` | ✅ (valorisation, sorties, journal) | ✅ | ✅ | ✅ (supérette) |
| **Commandes** `/commandes` | ✅ | ✅ | ⛔ (redirigé /saisie) | ➖ (pas de lien ; route non gardée) |
| **Contrôles ANM** `/controles` | ✅ | ✅ | ➖ (pas de lien) | ➖ (pas de lien) |
| **Tableau de bord** `/tableau` | ✅ | ⛔ | ⛔ | ⛔ |
| **Historique des points** `/historique` | ✅ | ⛔ | ⛔ | ⛔ |
| **Saisies & photos** `/saisies` | ✅ | ⛔ | ⛔ | ⛔ |
| **Alertes** `/alertes` | ✅ | ⛔ | ⛔ | ⛔ |
| **Point financier** `/finance` | ✅ | ⛔ | ⛔ | ⛔ |
| **Rapprochement** `/rapprochement` | ✅ | ⛔ | ⛔ | ⛔ |
| **Vérif bordereaux (OCR)** `/verif-photos` | ✅ | ⛔ | ⛔ | ⛔ |
| **Journal d'audit** `/audit` | ✅ | ⛔ | ⛔ | ⛔ |
| **Produits & prix** `/produits` | ✅ | ⛔ | ⛔ | ⛔ |
| **Fournisseurs** `/fournisseurs` | ✅ | ⛔ | ⛔ | ⛔ |
| **Stations & équipe** `/stations` | ✅ | ⛔ | ⛔ | ⛔ |

Légende : ✅ accessible ; ⛔ garde de route redirigeant vers `/saisie` (ou `/tableau` pour l'admin) ; ➖ pas de lien de navigation (accès théorique par URL non bloqué — voir §9).

**Page d'atterrissage** (`*`) : admin → `/tableau` ; vendeuse → `/stock` ; autres → `/saisie`.

### 3.4 Permissions d'écriture notables (RLS)

- **Verrouillage du passé** (`daily_reports`) : le gérant ne peut **modifier** que les points dont `report_date >= current_date − 2` et **insérer** que si `report_date >= current_date − 7`. L'admin n'a aucune limite. (Le frontend verrouille aussi tout jour de plus de 2 jours pour gérant/pompiste.)
- **Suppressions financières** (`deposits`, `expenses`, `deliveries`) : **admin uniquement** (ou le créateur pour certaines, selon la migration).
- **Le pompiste** ne peut insérer ni versement, ni dépense, ni achat, ni commande (`my_role() <> 'pompiste'` dans les politiques d'insert).
- **Produits proposés** : tout authentifié peut **insérer un produit uniquement avec `statut = 'en_attente'`** ; seul l'admin le fait passer à `valide`.
- **Journal d'audit** (`audit_log`) : lecture **admin seule**, aucune écriture applicative (alimenté par trigger), immuable.
- **Charges, lignes bancaires, masquage d'alertes** : **admin uniquement**.

---

## 4. Parcours par rôle

### 4.1 Gérant (au quotidien)
1. **Matin (8h)** : ouvre *Saisie du jour*, onglet Matin → saisit le stock cuve (essence/gasoil), les **relevés d'ouverture** des 8 pompes **avec photo de chaque index**, le stock de bouteilles de gaz et de lubrifiants. Envoie.
2. **16 h** : onglet 16 h → saisit les **ventes carburant de la veille** (litres, prix, séparation Bon/Espèce), les **relevés 16 h obligatoires** (8 index + photos), les bouteilles de gaz vendues et les recettes espèces gaz/supérette/lubrifiant, le cumul des bons.
3. **Réception carburant** (à tout moment) : si une commande est arrivée, la réceptionne (litres reçus, cuve avant/après, photo).
4. **Soir** : achats hors carburant (fournisseur), **dépenses** (montant + motif + photo justificatif), **versement** en banque (pôle, montant, **période concernée**, photo bordereau). Vérifie le récapitulatif À verser / Versé / Écart et envoie.
5. Propose des **commandes** de réapprovisionnement, enregistre les **contrôles ANM**, met à jour le **stock** (livraisons hors carburant, corrections d'inventaire).

### 4.2 Vendeuse
- Accède directement au **stock supérette** (page d'atterrissage) et à la **Saisie du jour** réduite à la supérette : choisit un produit du catalogue (validé), saisit **quantité** et **prix de vente**, ligne par ligne. Peut **proposer un produit absent** (créé « en attente », à valider par l'admin). Le total alimente `superette_espece` du point du jour.

### 4.3 Pompiste
- Saisie du jour limitée aux **compteurs (matin + 16 h), stock cuve/gaz/lubrifiant et photos**. Les blocs ventes carburant, gaz vendu, achats, dépenses et versements sont masqués. Peut ajouter des entrées/corrections de **stock**. Pas de commandes ni de contrôles.

### 4.4 Admin (direction)
- **Pilotage** : tableau de bord (stock temps réel, autonomie, prévision de commande, KPI mensuels, réconciliation mensuelle), historique détaillé des points, consultation des saisies & photos, gestion des alertes.
- **Finance** : point financier mensuel (compte de résultat, charges, pertes livraison), rapprochement bancaire, vérification OCR des bordereaux.
- **Administration** : journal d'audit, catalogue produits & prix (dont validation des produits proposés), fournisseurs, stations, équipe (rôles/rattachement), prix & marges, références lubrifiant.
- Peut **corriger n'importe quelle journée** (pas de verrouillage), **valider/refuser** les commandes, **valider** les produits proposés, **supprimer** les données financières.

---

## 5. Spécification par module / page

> Convention : `daily_reports` = point du jour ; les montants sont en FCFA. Les nombres saisis sont normalisés « à la française » (`numFR` : point = séparateur de milliers ignoré, virgule = décimale). L'affichage monétaire arrondit et suffixe « F ».

### 5.1 Login (`/`, `src/pages/Login.jsx`)
- **Objectif** : authentification Supabase (email + mot de passe) ou création de compte.
- **Saisie** : email, mot de passe (min. 6 caractères), + nom complet en mode inscription.
- **Règles** : à l'inscription, profil créé automatiquement en rôle **gérant** ; l'admin ajuste ensuite rôle et station. Messages d'erreur traduits en français (identifiants incorrects, email déjà utilisé, email non confirmé).
- Tant que la session n'est pas chargée : écran « Chargement… ». Sans session : écran de connexion.

### 5.2 Saisie du jour (`/saisie`, `src/pages/Submit.jsx`) — module central
- **Objectif** : saisir le point du jour d'une station pour une date, découpé par **moment** (Matin / 16 h / Soir) avec option « Tout afficher (avancé) ». Le moment par défaut dépend de l'heure (< 12 h matin, < 18 h 16 h, sinon soir).
- **Sélection** : date (max = aujourd'hui). L'ouverture avec `?date=…` (depuis Historique/Saisies) affiche tout.

**Données saisies / affichées selon le moment :**

- **Matin** : stock cuve essence/gasoil (litres) ; **relevés d'ouverture** `e1_m…g4_m` (chacun avec bouton 📷) ; **stock bouteilles gaz** 3/6/12/38 kg (stepper − / +) ; **stock lubrifiants** par référence (JSON `lubrifiant_stock`).
- **16 h** : ventes carburant de la veille — essence & gasoil : litres, prix/L (pré-remplis depuis `settings`), **vente à bon**, **vente en espèces** ; **marge carburant estimée** affichée = (litres essence + gasoil) × marge unitaire. **Relevés 16 h** `e1…g4` (avec photos) — **obligatoires**. Bouteilles de gaz vendues 3/6/12/38 kg ; espèces gaz / supérette / lubrifiant ; **total des bons en cours (cumul)**.
- **Soir** : **Achats hors carburant** (`deliveries` : type gaz/lubrifiant/supérette/autre, quantité, unité, coût, fournisseur) ; **Dépenses** (`expenses` : catégorie SBEE/SUPERETTE/CARBURANT/AUTRE, montant, motif, **photo justificatif**) ; **Versements** (`deposits` : pôle, montant, **période du…au…**, **photo bordereau**).
- **Réception carburant** (bloc affiché dès qu'il existe des commandes `validee`/`lancee`/`partielle`) : indépendant du moment.

**Règles de gestion (validations bloquantes à l'envoi) :**
1. **Journée verrouillée** : gérant/pompiste ne peuvent envoyer si `date < aujourd'hui − 2 j` (message « seul l'administrateur peut modifier »).
2. **Relevés 16 h obligatoires** : à l'envoi du moment 16 h, les 8 index `e1…g4` doivent être remplis.
3. **Photo obligatoire par dépense** (si montant > 0), **par versement** (bordereau), et **période (du…au) obligatoire** avec `periode_debut ≤ periode_fin`.
4. **Photo obligatoire par compteur saisi** (matin ou 16 h) : un index renseigné sans photo (nouvelle ou déjà enregistrée) bloque l'envoi.
5. **Réception** : litres reçus > 0, cuve avant **et** après renseignées, **photo obligatoire** (bon/jauge).

**Mécanique d'enregistrement (idempotente par jour) :**
- `daily_reports` : **upsert** sur `(station_id, report_date)`. Tous les champs numériques passent par `numFR`.
- `expenses`, `deliveries`, `deposits` : **supprimés puis réinsérés** pour la journée (remplacement complet ⇒ la saisie est ré-éditable). Les photos existantes sont conservées ; les nouvelles sont uploadées (chemins horodatés dans le bucket).
- Un versement enregistre `deposit_date = periode_fin` (jour de rattachement de la recette).
- **Photos** : compteurs (`categorie = compteur`, note « libellé — index X »), preuves libres (`categorie = compteur` par défaut), réception (`categorie = reception`).
- **Supérette en valeur** : à chaque envoi, la sortie « vente » supérette du jour est recalculée = `superette_espece × (1 − taux_superette%)` (coût de revient), insérée en `stock_movements` (type `sortie`, source `vente`). Les anciennes sorties auto gaz/lubrifiant du jour sont supprimées (le stock gaz/lubrifiant est désormais **déclaré**, pas déduit à la vente — voir §6).
- Une ligne `submissions` (station, date, moment) est insérée à chaque envoi (sert au planificateur de notifications).

**Cas particuliers :**
- **Réception partielle** : le cumul reçu est recalculé ; la commande passe `recue` si `cumul ≥ commandé − marge`, sinon `partielle`. `cuve_avant` est figée à la 1re réception, `cuve_apres` = dernier niveau ; le stock cuve du jour (`ess_stock`/`gas_stock`) est mis à jour au niveau après réception. Prix d'achat = `settings.essence_pa` / `gasoil_pa`.
- **Vendeuse** : interface distincte (ventes supérette par produit). Ajout d'un produit hors catalogue → `products` en `statut = 'en_attente'`. Les lignes du jour (`superette_sales`) sont **remplacées** à chaque envoi ; le total met à jour `superette_espece`.

### 5.3 Stock & mouvements (`/stock`, `src/pages/Stock.jsx`)
- **Objectif** : voir le stock restant gaz/lubrifiant (et valeur supérette), enregistrer les **entrées** (livraisons) et **corrections d'inventaire**, consulter le journal.
- **Affichage** :
  - **Admin** : valorisation par catégorie + total (`v_stock_valeur`) ; stock restant gaz/lubrifiant (`v_stock_produits`, dernier comptage déclaré) avec seuil et alerte « bas » ; **Sorties déduites** (`v_sorties_deduites`, analyse) ; **journal des mouvements** filtrable par année/mois avec solde valeur et suppression.
  - **gérant/pompiste** : stock restant gaz/lubrifiant + liste simple des 15 dernières entrées (sans filtres ni suppression).
  - **vendeuse** : uniquement supérette.
- **Actions guidées** (tous) : « J'ai reçu une livraison » (entrée) ou « Corriger après inventaire » (ajustement). Pour gaz/lubrifiant : produit + quantité ; pour supérette : montant (valeur). Enregistrées en `stock_movements`.
- **Règle clé** : le stock gaz/lubrifiant affiché provient du **dernier relevé déclaré dans la Saisie du jour**, pas d'un cumul de mouvements. Les sorties/ventes ne sont **pas** saisies ici : elles sont **déduites** (voir §6.3).

### 5.4 Commandes (`/commandes`, `src/pages/Orders.jsx`)
- **Objectif** : gérer le cycle de vie des commandes de réapprovisionnement (carburant, gaz, lubrifiant, supérette).
- **Proposer** (gérant/admin) : choix de la catégorie.
  - **Carburant** : commande **simultanée essence + gasoil** — une **commande par produit** créée pour chaque ligne avec quantité > 0. Champs : quantité (L), bons (base), complément chèque + référence. Coût estimé = quantité × prix d'achat (`settings`).
  - **Gaz / lubrifiant** : une ligne par produit du catalogue, quantité + montant ; mode de paiement (chèque/espèces). **Une commande par produit** avec quantité > 0.
  - **Supérette** : **une seule commande**, plusieurs articles (`lignes` JSON), mode de paiement + montant total.
- **Filtres** : par statut (toutes / proposées / validées / lancées / partielles / reçues) et par catégorie.
- **Actions par statut** :
  - `proposee` → **Valider** ou **Refuser** (admin seulement) ; sinon « en attente de validation ».
  - `validee` → **Lancer** (avec date de lancement).
  - `lancee` / `partielle` → **Réceptionner** (voir §7). Carburant : cuve avant/après + mise à jour du stock cuve dans `daily_reports` ; gaz/lubrifiant/supérette : entrée en `stock_movements`.
  - Suppression : admin uniquement.
- **Contrôle perte livraison** (carburant reçu) : livré = cuve après − cuve avant ; perte = commandé − livré ; seuil = commandé × `taux_perte_acceptable%`. Affiche « dans la tolérance » ou « perte non acceptable » (litres au-delà du seuil).

### 5.5 Contrôles ANM (`/controles`, `src/pages/Inspections.jsx`)
- **Objectif** : tracer les contrôles inopinés (ANM ou autre).
- **Saisie** : date, organisme (défaut ANM), pompes concernées, litres prélevés, litres retournés en cuve, conformité (oui/non/non précisé), observations, **photo de la fiche**.
- **Affichage** : historique décroissant avec badge conforme/non conforme et vignette photo. Suppression par l'admin ou le créateur.

### 5.6 Tableau de bord (`/tableau`, `src/pages/Dashboard.jsx`, admin)
- **Objectif** : pilotage temps réel + mensuel d'une station.
- **Blocs** :
  - **Stock temps réel & autonomie** (`v_latest_stock` + `v_stock_forecast`) : cuve essence/gasoil (litres + jours d'autonomie colorés), bons en cours, total bouteilles gaz. Mise à jour **temps réel** (abonnement Realtime sur `daily_reports`).
  - **Prévision de commande carburant** (`v_reorder`) : stock, conso/jour, autonomie, **délai de livraison calculé** (moyenne réelle lancement→réception, sinon défaut), date de commande conseillée, rupture estimée, badge « commander maintenant » + manque à gagner estimé.
  - **KPI mensuels** (filtre année/mois, `v_ventes_mensuelles`) : ventes à bon, recettes espèces (% du CA), versé banque, **cash non tracé** (espèces − dépenses − versé), marge carburant, livraisons/achats, nombre d'alertes station.
  - **Commandes & contrôles ANM** : reçues / total, conformes / non conformes.
  - **Évolution mensuelle** (barres Recharts : ventes bon / espèces / versé).
  - **Réconciliation versements par mois** : espèces vs versé, écart, taux de couverture (%).

### 5.7 Historique des points (`/historique`, `src/pages/History.jsx`, admin)
- **Objectif** : vue tabulaire par jour, avec **réconciliation par groupe de pôle** (carburant / gaz+lub / supérette).
- **Colonnes par jour** : CA carburant, espèce/versé/écart carburant, CA & versé & écart gaz+lub, CA & versé & écart supérette, bons, présence de photos. Ligne de total.
- **Règles d'affichage de l'écart** (via `v_pole_recon_jour`) :
  - Jour de **clôture d'une période** (`nb_cloture > 0`) : écart affiché ; > 1000 F ⇒ rouge, sinon vert ; surplus (écart < −1000) signalé. La recette affichée est la **recette cumulée de la période** (`recette_cloture`), base réelle de l'écart.
  - Jour **couvert** par une période non encore clôturée : « ✓ inclus » (écart calculé au dernier jour).
  - Recette non rattachée : « en attente ».
- Clic sur une ligne → ouvre la Saisie du jour à cette date (l'admin peut modifier).

### 5.8 Saisies & photos (`/saisies`, `src/pages/Entries.jsx`, admin)
- **Objectif** : consultation détaillée par jour d'un mois, avec **toutes les photos**.
- **Affichage** : sélection mois (2025/2026), liste des jours ; chaque jour dépliable montre ventes carburant, autres pôles, compteurs (ouverture + 16 h), stock, et une galerie photo (`attachments` + bordereaux `deposits`) via **URLs signées** (fonctionne bucket privé ou public). Bouton « Ouvrir / modifier cette journée ».

### 5.9 Alertes (`/alertes`, `src/pages/Alerts.jsx`, admin)
- **Objectif** : lister les anomalies détectées (`v_alerts`) et permettre de les traiter.
- **Fonctions** : filtres année/mois/type ; bascule « Voir les traitées » ; **Traité** (upsert `alert_dismissals` sur `(station, date, type)`) / **Rétablir** (delete). Compteur d'alertes actives et traitées.
- Les libellés/couleurs viennent de `ALERT_LABELS` (`src/lib/format.js`). Détail de chaque type et condition : voir **§6.4**.

### 5.10 Point financier (`/finance`, `src/pages/Finance.jsx`, admin)
- **Objectif** : compte de résultat mensuel (ou annuel) par station.
- **Produits (commissions, automatiques)** :
  - Commission carburant = litres × marge (`v_ventes_mensuelles.commission_carburant`).
  - Commission gaz + lubrifiant = (ventes gaz + lubrifiant) × `taux_gaz%`.
  - Commission supérette = ventes supérette × `taux_superette%`.
  - **Autres produits** (revenus saisis manuellement, catégorie `AUTRES_PRODUITS`).
- **Charges** :
  - **Automatiques** depuis les dépenses quotidiennes : **SBEE** et **CARBURANT** (agrégées par mois).
  - **Fixes / manuelles** (`charges` : LOYER, SALAIRES, PRELEVEMENT_GERANT, IMPOTS, HONORAIRES, PRESTATIONS, PERTE_VENTE_CARBURANT, SONEB, TELEPHONE, AUTRE). Saisissables uniquement pour un **mois précis**. Bouton **« Reporter le mois précédent »** (copie les charges récurrentes hors revenus et hors perte carburant).
- **Résultat** = produits − charges. **Valeur du stock** affichée (gaz + lubrifiant + supérette).
- **Pertes sur livraisons** (`v_pertes_mensuelles`) : litres et montant des pertes **non acceptables** (au-delà du seuil), base d'une éventuelle retenue sur salaire du gérant.

### 5.11 Rapprochement bancaire (`/rapprochement`, `src/pages/BankRecon.jsx`, admin)
- **Objectif** : rapprocher les **versements déclarés** (`deposits`) avec les **crédits du relevé bancaire** (`bank_lines`, saisis manuellement).
- **Appariement** (glouton, calculé côté client) : chaque ligne bancaire cherche un versement non encore apparié tel que |montant banque − montant versé| ≤ **200 F** (tolérance timbre) **et** écart de dates ≤ **7 jours**.
- **Sorties** : KPI (déclarés, crédits banque, rapprochés, non rapprochés) ; **versements déclarés sans crédit banque** (priorité — argent déclaré introuvable) ; **crédits banque sans versement déclaré** (à rattacher) ; liste des rapprochés.
- Saisie/suppression des lignes bancaires réservée à l'admin.

### 5.12 Vérif bordereaux / OCR (`/verif-photos`, `src/pages/OcrCheck.jsx`, admin)
- **Objectif** : comparer le montant **déclaré** d'un versement au montant **lu sur la photo** du bordereau par IA.
- **Fonction** : bouton « Analyser » → appelle l'Edge Function `ocr-bordereau` (vision Anthropic, modèle `claude-sonnet-4-6`). La fonction télécharge la photo depuis Storage, demande un JSON `{montant, date, reference}` (versement espèces Bank of Africa Bénin), calcule `ocr_ecart = montant_ocr − montant déclaré` et stocke le tout sur la ligne `deposits`.
- **Affichage** : vignette, date, pôle, déclaré, lu (OCR), écart. Un écart |>100 F| est signalé « écart détecté » ; sinon « ✓ OK ». KPI : bordereaux avec photo / analysés / écarts.
- **Dépendance** : la fonction serveur doit être déployée avec `ANTHROPIC_API_KEY` (sinon message d'erreur explicite).

### 5.13 Journal d'audit (`/audit`, `src/pages/AuditLog.jsx`, admin)
- **Objectif** : traçabilité immuable de toute création/modification/suppression.
- **Portée** : trigger `audit_trigger` sur `daily_reports`, `deposits`, `expenses`, `deliveries`, `fuel_orders`, `inspections`. Chaque événement stocke qui (email), quand, table, action, `old_data`/`new_data` (JSON).
- **Affichage** : filtres table/action ; **diff lisible** des champs surveillés (litres, montants, compteurs, cuve, statut…). Lecture admin seule ; aucune modification possible.

### 5.14 Produits & prix (`/produits`, `src/pages/Products.jsx`, admin)
- **Objectif** : catalogue par catégorie (gaz / lubrifiant / supérette / autre) : nom, unité, prix d'achat, prix de vente, seuil d'alerte, actif, ordre.
- **Produits à valider** : bloc dédié listant les produits `statut = 'en_attente'` (proposés par une vendeuse). L'admin corrige catégorie/prix puis **Valide** (`statut = valide`, actif) ou **Rejette** (suppression).
- Édition/suppression en ligne des produits existants ; ajout d'un produit à la catégorie courante. Le carburant se règle ailleurs (« Prix & marge » dans Stations).

### 5.15 Fournisseurs (`/fournisseurs`, `src/pages/Suppliers.jsx`, admin)
- **Objectif** : gérer les fournisseurs supérette / lubrifiant / gaz / autre (le carburant a un fournisseur unique non géré ici). Champs : nom, catégorie, contact. Liste + suppression.

### 5.16 Stations & équipe (`/stations`, `src/pages/Stations.jsx`, admin)
- **Objectif** : paramétrage global.
- **Stations** : nom, compte bancaire, seuils d'alerte de stock (essence, gasoil en L ; gaz par type ; lubrifiant en unités). Ajout de station.
- **Équipe** : liste des profils, changement de **rôle** (pompiste/vendeuse/gérant/admin) et **rattachement à une station**.
- **Références lubrifiant** (`lubrifiant_types`) : ajout/renommage/désactivation/suppression des références proposées à la saisie.
- **Prix & marge** (`settings`) : prix de vente essence/gasoil + marge (F/L) ; prix d'achat essence/gasoil ; taux de commission gaz+lubrifiant et supérette (%).

### 5.17 Aide (`/aide`, `src/pages/Aide.jsx`, tous)
- Guide pas-à-pas (Matin / 16 h / Soir), rappel des **photos obligatoires**, du caractère obligatoire des relevés 16 h, du verrouillage à 2 jours, des notifications 8 h / 17 h, et FAQ.

---

## 6. Règles métier transverses

### 6.1 Réconciliation des versements par période et par groupe de pôle

**Principe** : un versement en banque n'est pas forcément quotidien ni mono-pôle. Chaque versement (`deposits`) porte un **pôle** et couvre une **période** `periode_debut → periode_fin`. La réconciliation compare, **par groupe de pôle et par période**, la **somme des recettes espèces** de la période au **montant versé**.

**Groupes de pôle** (`v_verse_groupe`) :
- `carburant` ← pôle `carburant` ;
- `gaz_lub` ← pôles `gaz`, `lubrifiant`, `gaz_lubrifiant` (**cumulables dans un même bordereau**) ;
- `superette` ← pôle `superette`.

**Recette espèce par jour et par groupe** (`v_recette_groupe_jour`) :
- carburant : `ess_espece + gas_espece`, **et** `depense` du jour (les dépenses sortent de la caisse carburant) ;
- gaz_lub : `gaz_espece + lubrifiant_espece`, dépense = 0 ;
- superette : `superette_espece`, dépense = 0.

**Calcul de l'écart** (`v_verse_recon`), pour chaque (station, groupe, période) :
```
recette_periode = Σ espèces du groupe sur [periode_debut ; periode_fin]
depense_periode = Σ dépenses du groupe sur la même période   (≠0 seulement pour carburant)
ecart = recette_periode − depense_periode − verse
```
- **Carburant** : on compare donc **(espèce reçu − dépenses)** au versé.
- Un **écart > 1000 F** (il **manque** du versé) lève l'alerte `VERSEMENT_INCOMPLET`. Un **surplus** (écart négatif : on a versé plus que la recette nette) **n'est pas** une alerte.

**Report jour par jour** (`v_pole_recon_jour`, utilisé par l'Historique) : l'écart est **porté sur le dernier jour de la période** (`periode_fin`). Les jours intermédiaires couverts sont marqués « inclus » (écart 0 en attendant la clôture). Colonnes `recette_cloture` / `depense_cloture` = cumuls de la/des période(s) clôturée(s) ce jour (base de l'écart affiché).

### 6.2 Anti-coulage cuve (`ECART_STOCK`)

Réconciliation volumétrique de la cuve (`v_stock_recon`, base v13) : pour deux jours consécutifs,
```
cuve_attendue(J)  = ess_stock(J) − litres_vendus_retenus(J) + livraisons_reçues(J)
ecart(J) = cuve_déclarée(J+1) − cuve_attendue(J)
```
où `litres_vendus_retenus` = litres déclarés (sinon calculés depuis les compteurs d'ouverture) et `livraisons_reçues` = Σ (cuve après − cuve avant) des commandes carburant `recue` du jour. Un **|écart| > 300 L** (essence ou gasoil) lève l'alerte `ECART_STOCK` (« fuite / vol ? »). C'est le garde-fou contre le **coulage**.

### 6.3 Stock gaz/lubrifiant déclaré + sorties déduites

Depuis la refonte v26, le stock gaz/lubrifiant n'est **plus** décrémenté à la vente. Il est **déclaré chaque jour** (bouteilles gaz par type, JSON lubrifiants). La **consommation** est **déduite** de deux relevés consécutifs (`v_sorties_deduites`) :
```
sortie(J) = stock_déclaré(J−1) + entrées(J) − stock_déclaré(J)
```
Une sortie **négative** signale une **entrée oubliée** (à vérifier). Le stock actuel (`v_stock_produits`) = **dernier relevé déclaré** par produit. La **supérette** reste suivie **en valeur** (coût de revient à la vente, valorisation `v_stock_valeur` = valeur initiale + entrées − sorties).

### 6.4 Alertes — catalogue **effectivement émis** (`v_alerts`, version courante v32)

> La version active de `v_alerts` (après consolidation v27→v30 puis v32) émet les types ci-dessous. `ALERT_LABELS` (front) déclare d'autres libellés (ECART_CAISSE, STOCK_BAS_GAZ, STOCK_BAS_LUBRIFIANT, PERTE_LIVRAISON, BONS_INEXPLIQUES, ECART_INVENTAIRE) **historiquement présents mais non recâblés** dans la vue courante — voir §9.

| Type | Gravité | Condition (SQL) |
|---|---|---|
| `VERSEMENT_INCOMPLET` | haute | `v_verse_recon.ecart > 1000` sur une période clôturée (recette nette − versé) |
| `VERSEMENT_MANQUANT` | haute | Recette espèce d'un groupe `> 1000 F`, jour `< aujourd'hui − 3`, **non couverte** par une période de versement |
| `DEPENSE_NON_JUSTIFIEE` | moyenne | Dépense avec `justificatif = false` **ou** motif vide |
| `ECART_COMPTEUR` | moyenne | Essence : |litres calculés (compteurs d'ouverture) − litres déclarés| > 100 L |
| `STOCK_BAS` | haute | Cuve essence **ou** gasoil < seuil de la station (avec autonomie estimée) |
| `ECART_STOCK` | haute | |écart cuve déclarée vs attendue| > 300 L (essence ou gasoil) — **anti-coulage** |
| `POINT_MANQUANT` | moyenne | Jour sans point saisi (14 derniers jours), pour une station déjà active auparavant |

### 6.5 Produits proposés par la vendeuse (à valider)

Quand une vendeuse vend un article absent du catalogue, elle le crée immédiatement en `products` avec `statut = 'en_attente'` (RLS : insertion autorisée **uniquement** avec ce statut). Le produit est vendable dans la foulée, mais n'apparaît dans le catalogue « officiel » qu'après **validation admin** (page Produits → « À valider »), qui corrige catégorie/prix/seuil et passe le statut à `valide`. Le catalogue proposé à la vendeuse ne liste que les produits `statut = valide` **et** `actif = true`.

### 6.6 Commandes multi-produits & réceptions partielles

- **Multi-produits** : carburant, gaz et lubrifiant génèrent **une commande par produit** (par ligne de quantité > 0) ; la supérette génère **une commande à plusieurs articles** (`lignes` JSON).
- **Réceptions partielles** (`order_receptions`, une ligne par livraison) : cumul reçu suivi par `v_order_reception` (total reçu, reste, nb réceptions, `complet`). Une commande est **complète** quand `cumul ≥ commandé − marge`, avec `marge = commandé × taux_perte_acceptable%`. Tant que le reste dépasse la marge, la commande est `partielle`.

### 6.7 Contrôle des ventes carburant par compteurs

Les litres **déclarés** servent de base au CA et à la marge. Les **litres calculés** (`ess/gas_litres_calc`) proviennent de la différence des **relevés d'ouverture** de deux jours consécutifs (`e_open_next − e_open`, valides seulement si dates consécutives et index croissant). L'écart déclaré/calculé alimente `ECART_COMPTEUR` (essence) et la réconciliation cuve. La **consommation moyenne/jour** (autonomie, prévision) est calculée sur les 30 derniers jours de litres retenus.

---

## 7. Cycle de vie

### 7.1 Commande (`fuel_orders.statut`)
```
proposee ──(admin: Valider)──▶ validee ──(Lancer + date_lancement)──▶ lancee
   │                                                                     │
   └──(admin: Refuser)──▶ annulee                       ┌────────────────┤
                                                        ▼                ▼
                                          (réception partielle)   (réception complète)
                                                partielle ──────────▶ recue
```
- `proposee` : créée par gérant/admin (statut par défaut).
- `validee` : approuvée par l'admin (`validated_by/at`).
- `annulee` (« Refusée ») : rejetée par l'admin.
- `lancee` : commande passée au fournisseur (`date_lancement`, `lancee_at`). Le **délai réel** lancement→1re réception alimente la prévision (`v_delai_moyen`, `v_order_lead`).
- `partielle` : reçue en partie (cumul < commandé − marge).
- `recue` : cumul ≥ commandé − marge (`recu_by/at`, `report_date` = jour de réception).
- Chaque réception écrit `order_receptions` ; carburant met à jour le stock cuve (`daily_reports`), les autres catégories créent une entrée `stock_movements`.

### 7.2 Versement / période
```
Début période (periode_debut) ── recettes espèces s'accumulent, jours « inclus » ──▶ Fin (periode_fin) = clôture
                                                                              │
                                                                              ▼
                                        écart = (Σ recettes − Σ dépenses) − versé, porté sur periode_fin
                                        écart > 1000 F ⇒ alerte VERSEMENT_INCOMPLET
                                        non couvert > 3 j ⇒ alerte VERSEMENT_MANQUANT
```
Un versement peut couvrir un seul jour (période d'un jour) ou plusieurs. La clôture (jour = `periode_fin`) est le moment où l'écart devient « réel » et affiché dans l'Historique.

---

## 8. Notifications / bandeaux

- **Bandeau de notifications** (`NotifBanner`, en haut du contenu) : lit `notifications` non résolues de la station courante ; rafraîchi à l'ouverture puis toutes les 5 min. Bouton **« Traité »** → `resolved = true`.
- **Planificateur** (`pg_cron`, fonction `notify_missing`) : crée une notification si aucune soumission (`submissions`) n'a été faite pour le moment attendu, **sans doublon dans la journée**, et **uniquement pour les stations déjà actives** :
  - **08:00 Bénin (07:00 UTC)** : « Point du matin non reçu (stock + relevés d'ouverture) ».
  - **17:00 Bénin (16:00 UTC)** : « Relevés 16 h non reçus ».
- **Bandeaux de page** : messages de succès (`.ok`), erreurs (`.err`), verrouillage (« Journée verrouillée »), mode pompiste, alertes de validation (photos/relevés manquants). Le tableau de bord se met à jour en **temps réel** via l'abonnement Realtime sur `daily_reports`.

---

## 9. Contraintes & limites connues

Points relevés **dans le code** susceptibles d'impacter le produit :

1. **`v_alerts` réduit** : la version courante (v32) n'émet que 7 types (§6.4). Les vues sous-jacentes existent encore (`v_pertes_livraison`, `v_bons_baisses`, `v_bons_hausses`, écarts d'inventaire, stock bas gaz/lubrifiant, `ECART_CAISSE`) mais ne sont **plus branchées** dans `v_alerts` depuis la refonte v27. Les libellés correspondants figurent pourtant encore dans `ALERT_LABELS` (front) et ne s'afficheront jamais. À clarifier (recâbler ou retirer).
2. **Gardes de routes partielles** : les routes `/commandes` (pour la vendeuse) et `/controles` (pompiste/vendeuse) ne sont pas masquées côté navigation mais **ne sont pas non plus gardées** dans `App.jsx` — accès théorique par saisie d'URL. La RLS reste toutefois la ligne de défense réelle sur les données.
3. **Libellé de rôle** : dans l'en-tête (`Shell`), la vendeuse est étiquetée « Gérant » (le calcul `roleLabel` ne teste pas `isVendeuse`). Cosmétique.
4. **Verrouillage à 2 jours** : le message d'aide dit « aujourd'hui et hier » ; le code verrouille `date < aujourd'hui − 2 j` (donc J, J−1 et J−2 modifiables côté front) tandis que la RLS `update` autorise `report_date >= current_date − 2`. Léger décalage de formulation à vérifier avec la direction.
5. **Réconciliation client vs serveur** : le rapprochement bancaire (appariement glouton, tolérance 200 F / 7 j) est calculé **côté navigateur** et non persisté ; changer les données recalcule tout.
6. **OCR dépendant d'un déploiement** : `/verif-photos` requiert l'Edge Function `ocr-bordereau` déployée avec clé Anthropic ; sinon l'analyse échoue (message explicite).
7. **Multiplicité des fichiers de migration** : le dossier `supabase/` contient de nombreuses migrations incrémentales **et** des consolidations (`migration_FINALE_v27_v30.sql`, `migration_v31_v33.sql`). Plusieurs redéfinissent successivement les mêmes vues (`v_report_metrics`, `v_alerts`) ; **seule la dernière appliquée fait foi** (ex. `total_verse` rattaché à `periode_fin` en v27, et non plus à `deposit_date` comme en v25). Une source de vérité unique du schéma serait souhaitable.
8. **Rétention / archivage photos** : `v_attachments_archivables` + `purge_attachments_archivables()` gèrent la purge des **lignes** (24 mois preuves comptables, 6 mois compteurs) mais **pas les fichiers** du bucket Storage (à purger séparément — cf. `ARCHIVAGE.md`).
9. **Stock cuve à la réception** : l'anti-coulage (`v_stock_recon`) additionne les livraisons via `fuel_orders` (`statut = recue`, `cuve_apres − cuve_avant`) et non via `order_receptions` — en cas de réceptions multiples, seul le dernier couple cuve avant/après de la commande est pris en compte pour la volumétrie.

---

*Fin du document. Toute évolution de `src/pages/*`, `src/lib/*` ou des vues `supabase/*.sql` doit être répercutée ici.*
