-- ============================================================
--  MIGRATION CONSOLIDÉE v31 → v40 — À EXÉCUTER EN UNE FOIS.
--  Ouvre CE fichier dans Supabase > SQL Editor et clique Run.
--  À exécuter APRÈS la FINALE v27→v30. Idempotente et rejouable
--  (sûr même si certaines de ces migrations ont déjà été passées
--  individuellement — tout est en IF NOT EXISTS / CREATE OR REPLACE).
--
--    v31 = ventes supérette par produit + produits proposés (à valider)
--    v32 = reconnecte l’alerte anti-coulage cuve (ECART_STOCK)
--    v33 = Historique : recette cumulée de la période au jour de clôture
--    v34 = perf : index fuel_orders + v_order_reception en LATERAL
--    v35 = écart compteur : sépare vrai écart / relevé matin manquant
--    v36 = carburant/déplacement propriétaire = charge NON-CASH
--    v37 = garde-fou anti-coulage (plus de fausses alertes "fuite" impossibles)
--    v38 = réconciliation cuve/compteur en BACKWARD (sens correct)
--    v39 = bons en cours impactés par les bons utilisés en commande
--    v40 = perte livraison correcte pour réceptions partielles/multiples
-- ============================================================


-- ============================================================
--  MIGRATION CONSOLIDÉE v31 → v33 — À EXÉCUTER EN UNE FOIS.
--  Ouvre CE fichier dans Supabase > SQL Editor et clique Run.
--  À exécuter APRÈS la FINALE v27→v30. Idempotente et rejouable.
--    v31 = ventes supérette par produit + produits proposés (à valider)
--    v32 = reconnecte l’alerte anti-coulage cuve (ECART_STOCK)
--    v33 = Historique : recette cumulée de la période au jour de clôture
-- ============================================================


-- ============================================================
--  MIGRATION v31 — Ventes supérette PAR PRODUIT + produits
--  proposés par la vendeuse (validés ensuite par l'admin).
--
--  1) La vendeuse saisit ses ventes ligne par ligne : elle choisit
--     un produit du catalogue (quantité + prix de vente), ou en
--     AJOUTE un absent de la liste — celui-ci est créé « en attente »
--     et l'admin le valide / corrige ensuite.
--  2) Les lignes sont stockées dans superette_sales ; le total
--     alimente daily_reports.superette_espece (réconciliation inchangée).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v30 / FINALE v27→v30).
--  Idempotente et rejouable.
-- ============================================================

-- ── 1. Catalogue : statut de validation + provenance ────────
alter table products add column if not exists statut     text not null default 'valide';  -- valide / en_attente
alter table products add column if not exists created_by uuid references auth.users(id);
alter table products add column if not exists station_id bigint references stations(id);

-- La vendeuse / le gérant peut PROPOSER un produit, mais uniquement « en_attente ».
-- (L'admin garde p_products_all : insert/update/delete libres, dont la validation.)
drop policy if exists p_products_ins_pending on products;
create policy p_products_ins_pending on products
  for insert to authenticated
  with check (statut = 'en_attente');

-- ── 2. Ventes supérette détaillées (une ligne par produit) ──
create table if not exists superette_sales (
  id          bigint generated always as identity primary key,
  station_id  bigint not null references stations(id),
  report_date date   not null,
  product_id  bigint references products(id) on delete set null,
  nom         text   not null,                    -- libellé figé au moment de la vente
  quantite    numeric not null default 1,
  prix_vente  numeric not null default 0,
  montant     numeric not null default 0,         -- quantite * prix_vente
  created_by  uuid default auth.uid(),
  created_at  timestamptz default now());

create index if not exists idx_superette_sales_day on superette_sales(station_id, report_date);

alter table superette_sales enable row level security;
grant select, insert, update, delete on superette_sales to authenticated;

-- Lecture / écriture : admin partout, sinon uniquement sa station.
drop policy if exists p_ssales_sel on superette_sales;
create policy p_ssales_sel on superette_sales for select
  using (is_admin() or station_id = my_station());
drop policy if exists p_ssales_ins on superette_sales;
create policy p_ssales_ins on superette_sales for insert
  with check (is_admin() or station_id = my_station());
drop policy if exists p_ssales_upd on superette_sales;
create policy p_ssales_upd on superette_sales for update
  using (is_admin() or station_id = my_station())
  with check (is_admin() or station_id = my_station());
drop policy if exists p_ssales_del on superette_sales;
create policy p_ssales_del on superette_sales for delete
  using (is_admin() or station_id = my_station());

-- ── 3. Vue de synthèse (admin) : ventes supérette par produit ─
create or replace view v_superette_sales as
select s.station_id, s.report_date, s.product_id,
       coalesce(p.nom, s.nom) as nom,
       s.quantite, s.prix_vente, s.montant,
       p.statut as produit_statut
from superette_sales s
left join products p on p.id = s.product_id;

grant select on v_superette_sales to authenticated, anon;


-- ============================================================
--  MIGRATION v32 — Reconnecte l'anti-coulage carburant aux Alertes.
--
--  La réconciliation cuve ↔ litres vendus existe déjà (v_stock_recon, v13) :
--     cuve(J) − litres vendus(J) + livraisons(J)  doit ≈ cuve(J+1).
--  Mais la réécriture de v_alerts en v27 (FINALE) avait fait sauter l'alerte
--  ECART_STOCK. On la ré-ajoute ici, à l'IDENTIQUE de la logique v27 + les
--  deux branches cuve (essence / gasoil). Aucune modif front nécessaire :
--  la page Alertes lit v_alerts et connaît déjà le libellé ECART_STOCK.
--
--  À exécuter dans Supabase > SQL Editor > Run (après la FINALE v27→v30).
--  Idempotente (create or replace).
-- ============================================================

create or replace view v_alerts as
-- a) écart de versement sur une période clôturée (carburant net de dépenses)
select station_id, periode_fin as report_date, 'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  case when pole_groupe='carburant'
    then 'carburant : (espèce '||round(recette_periode)||' − dépenses '||round(depense_periode)||') ≠ versé '||round(verse)||' → écart '||round(ecart)||' F'
    else pole_groupe||' : recette '||round(recette_periode)||' ≠ versé '||round(verse)||' → écart '||round(ecart)||' F' end as detail
from v_verse_recon where ecart > 1000
union all
-- b) recette d'un groupe non couverte par un versement depuis plus de 3 jours
select r.station_id, r.report_date, 'VERSEMENT_MANQUANT', 'haute',
  'Recette '||r.pole_groupe||' '||round(r.espece)||' F non versée (aucune période ne la couvre, > 3 j)'
from v_recette_groupe_jour r
where r.espece > 1000 and r.report_date < current_date - 3
  and not exists (select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin)
union all
-- c) dépense non justifiée
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
-- d) écart compteur (litres déclarés vs calculés)
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics where ess_litres_calc is not null and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
-- e) stock carburant bas
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Essence: '||round(coalesce(l.ess_stock,0))||' L (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.ess_stock is not null and l.ess_stock < l.seuil_essence
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Gasoil: '||round(coalesce(l.gas_stock,0))||' L (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil
union all
-- f) ANTI-COULAGE carburant : cuve déclarée vs cuve attendue (RÉ-AJOUTÉ v32)
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon where ecart_ess is not null and abs(ecart_ess) > 300
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon where ecart_gas is not null and abs(ecart_gas) > 300
union all
-- g) point du jour manquant
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;


-- ============================================================
--  MIGRATION v33 — Historique cohérent : sur le jour de CLÔTURE d'un
--  versement, afficher la RECETTE CUMULÉE de la période (celle qui sert
--  au calcul de l'écart), pas seulement la recette du jour.
--
--  Avant : « CA Gaz+Lub » = recette du seul jour, alors que l'écart rouge
--  porte sur toute la période → la ligne paraissait incohérente.
--  On expose recette_cloture / depense_cloture dans v_pole_recon_jour ;
--  le front les affiche sur le jour de clôture.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v32).
--  Idempotente (create or replace).
-- ============================================================

create or replace view v_pole_recon_jour as
select r.station_id, r.report_date, r.pole_groupe,
  r.espece, r.depense,
  coalesce((select sum(vr.verse) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date),0) as verse,
  coalesce((select sum(vr.ecart) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date),0) as ecart,
  (select count(*) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date) as nb_cloture,
  exists(select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin) as couvert,
  -- NOUVEAU (v33) : ajoutées EN FIN de vue (create or replace n'autorise que
  -- l'ajout de colonnes à la fin). Recette / dépense CUMULÉES de la/les
  -- période(s) qui se clôture(nt) ce jour — base réelle de l'écart affiché.
  (select sum(vr.recette_periode) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date) as recette_cloture,
  (select sum(vr.depense_periode) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date) as depense_cloture
from v_recette_groupe_jour r;

grant select on v_pole_recon_jour to authenticated, anon;


-- ============================================================
--  MIGRATION v34 — Performance (sûre, sans changement de comportement).
--
--  1) Index manquant sur fuel_orders(station_id, report_date) : utilisé par
--     v_stock_recon et les filtres de réception (seul index existant =
--     (station_id, created_at)).
--  2) v_order_reception : la somme des quantités reçues était recalculée
--     3× par ligne (total, reste, complet). On la calcule UNE fois via
--     LATERAL. Colonnes et résultats identiques.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v31_v33). Idempotente.
-- ============================================================

-- 1) Index
create index if not exists idx_orders_st_date on fuel_orders(station_id, report_date);

-- 2) v_order_reception : agrégat calculé une seule fois (LATERAL)
create or replace view v_order_reception as
with t as (select coalesce(taux_perte_acceptable,5) as tx from settings where id=1)
select o.id as order_id, o.station_id, o.produit, o.categorie, o.quantite_commandee,
  coalesce(rc.recu, 0)                                   as quantite_recue_total,
  greatest(o.quantite_commandee - coalesce(rc.recu, 0), 0) as reste,
  coalesce(rc.nb, 0)                                     as nb_receptions,
  (coalesce(rc.recu, 0) >= o.quantite_commandee - o.quantite_commandee * (select tx from t)/100) as complet
from fuel_orders o
left join lateral (
  select sum(r.quantite_recue) as recu, count(*) as nb
  from order_receptions r where r.order_id = o.id
) rc on true;

grant select on v_order_reception to authenticated, anon;


-- ============================================================
--  MIGRATION v35 — Écart compteur : lever le biais du "décalage".
--
--  Problème : l'écart compteur = (index matin J+1) − (index matin J) vs déclaré(J).
--  Si le relevé du matin de J+1 n'a pas été mis à jour (index identique à J),
--  l'avance réelle apparaît un jour trop tard : le jour J affichait un faux
--  "compteurs 0 L vs déclaré X" et le volume glissait sur J+1.
--
--  Correctif : on sépare deux cas dans v_alerts —
--    • ECART_COMPTEUR : l'index a RÉELLEMENT avancé (>0) mais diffère du déclaré.
--    • RELEVE_COMPTEUR_MANQUANT : l'index du matin du lendemain n'a pas augmenté
--      (identique/absent) → vérification impossible (plus de faux "0 L").
--  Ajout aussi du contrôle GASOIL (avant : essence seule).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v32/v31_v33). Idempotente.
-- ============================================================

create or replace view v_alerts as
-- a) écart de versement sur une période clôturée (carburant net de dépenses)
select station_id, periode_fin as report_date, 'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  case when pole_groupe='carburant'
    then 'carburant : (espèce '||round(recette_periode)||' − dépenses '||round(depense_periode)||') ≠ versé '||round(verse)||' → écart '||round(ecart)||' F'
    else pole_groupe||' : recette '||round(recette_periode)||' ≠ versé '||round(verse)||' → écart '||round(ecart)||' F' end as detail
from v_verse_recon where ecart > 1000
union all
-- b) recette d'un groupe non couverte par un versement depuis plus de 3 jours
select r.station_id, r.report_date, 'VERSEMENT_MANQUANT', 'haute',
  'Recette '||r.pole_groupe||' '||round(r.espece)||' F non versée (aucune période ne la couvre, > 3 j)'
from v_recette_groupe_jour r
where r.espece > 1000 and r.report_date < current_date - 3
  and not exists (select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin)
union all
-- c) dépense non justifiée
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
-- d) écart compteur RÉEL : l'index a avancé (>0) mais diffère du déclaré (> 100 L)
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics
where ess_litres_calc is not null and ess_litres_calc > 0 and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Gasoil: compteurs '||round(gas_litres_calc)||' L vs déclaré '||round(gas_litres)||' L'
from v_report_metrics
where gas_litres_calc is not null and gas_litres_calc > 0 and gas_litres is not null and abs(gas_litres_calc - gas_litres) > 100
union all
-- d') relevé du matin du LENDEMAIN manquant/non mis à jour → vérification impossible
--     (index identique ou absent) : remplace l'ancien faux "compteurs 0 L".
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur essence du matin du '||to_char(report_date+1,'DD/MM')||' manquant ou non mis à jour (index identique à la veille) — impossible de vérifier les '||round(ess_litres)||' L déclarés le '||to_char(report_date,'DD/MM')
from v_report_metrics
where next_date = report_date + 1 and ess_litres is not null and ess_litres > 100 and coalesce(e_open_next,0) <= coalesce(e_open,0)
union all
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur gasoil du matin du '||to_char(report_date+1,'DD/MM')||' manquant ou non mis à jour (index identique à la veille) — impossible de vérifier les '||round(gas_litres)||' L déclarés le '||to_char(report_date,'DD/MM')
from v_report_metrics
where next_date = report_date + 1 and gas_litres is not null and gas_litres > 100 and coalesce(g_open_next,0) <= coalesce(g_open,0)
union all
-- e) stock carburant bas
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Essence: '||round(coalesce(l.ess_stock,0))||' L (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.ess_stock is not null and l.ess_stock < l.seuil_essence
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Gasoil: '||round(coalesce(l.gas_stock,0))||' L (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil
union all
-- f) ANTI-COULAGE carburant : cuve déclarée vs cuve attendue (v32)
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon where ecart_ess is not null and abs(ecart_ess) > 300
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon where ecart_gas is not null and abs(ecart_gas) > 300
union all
-- g) point du jour manquant
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;


-- ============================================================
--  MIGRATION v36 — « Carburant / déplacement » du propriétaire = charge
--  NON-CASH (aucun paiement en espèces).
--
--  Le propriétaire prélève de l'essence pour son déplacement : c'est une
--  CHARGE mensuelle (déjà remontée au Point financier sous « Carburant /
--  déplacement (auto) »), mais AUCUN cash ne sort de la caisse. Or elle était
--  comptée comme une dépense espèce → elle réduisait à tort le « cash à verser »
--  et faussait la réconciliation des versements.
--
--  Correctif : colonne expenses.non_cash ; les dépenses non-cash sont
--  EXCLUES des sommes de dépenses ESPÈCES (v_report_metrics.total_depense,
--  v_recette_groupe_jour carburant, v_ventes_mensuelles.total_depense), mais
--  restent visibles comme charge dans le Point financier (inchangé).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v35). Idempotente.
-- ============================================================

alter table expenses add column if not exists non_cash boolean not null default false;

-- Reprise : les dépenses catégorie CARBURANT = prélèvement carburant du proprio (non-cash).
update expenses set non_cash = true where upper(coalesce(categorie,'')) = 'CARBURANT' and non_cash = false;

-- ── v_report_metrics : total_depense = dépenses ESPÈCES uniquement ───
create or replace view v_report_metrics as
with base as (
  select r.*,
    coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
      +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0) as cash_declare,
    coalesce(ess_bon,0)+coalesce(gas_bon,0) as ventes_bon,
    coalesce(e1_m,0)+coalesce(e2_m,0)+coalesce(e3_m,0)+coalesce(e4_m,0) as e_open,
    coalesce(g1_m,0)+coalesce(g2_m,0)+coalesce(g3_m,0)+coalesce(g4_m,0) as g_open
  from daily_reports r),
withlead as (
  select *,
    lead(e_open) over (partition by station_id order by report_date) as e_open_next,
    lead(g_open) over (partition by station_id order by report_date) as g_open_next,
    lead(report_date) over (partition by station_id order by report_date) as next_date
  from base),
calc as (
  select *,
    case when next_date = report_date + 1 and e_open>0 and e_open_next>=e_open then e_open_next - e_open end as ess_litres_calc,
    case when next_date = report_date + 1 and g_open>0 and g_open_next>=g_open then g_open_next - g_open end as gas_litres_calc
  from withlead)
select c.*,
  coalesce(c.ess_litres, c.ess_litres_calc) as ess_litres_retenu,
  coalesce(c.gas_litres, c.gas_litres_calc) as gas_litres_retenu,
  (coalesce(c.ess_litres,0) + coalesce(c.gas_litres,0))
    * (select marge_unitaire from settings where id=1) as marge_estimee,
  coalesce(c.ess_litres,0) * coalesce(c.ess_pu,0)
    + coalesce(c.gas_litres,0) * coalesce(c.gas_pu,0) as ca_carburant,
  (select coalesce(sum(montant),0) from expenses e
     where e.report_date=c.report_date and e.station_id=c.station_id and coalesce(e.non_cash,false)=false) as total_depense,
  (select coalesce(sum(montant),0) from deposits d
     where d.station_id=c.station_id and coalesce(d.periode_fin, d.deposit_date, d.report_date)=c.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons
from calc c;

grant select on v_report_metrics to authenticated, anon;

-- ── v_recette_groupe_jour : dépense carburant = ESPÈCES uniquement ──
create or replace view v_recette_groupe_jour as
select d.station_id, d.report_date, 'carburant'::text as pole_groupe,
       coalesce(d.ess_espece,0)+coalesce(d.gas_espece,0) as espece,
       coalesce((select sum(e.montant) from expenses e
         where e.station_id=d.station_id and e.report_date=d.report_date and coalesce(e.non_cash,false)=false),0) as depense
from daily_reports d
union all
select station_id, report_date, 'gaz_lub',
       coalesce(gaz_espece,0)+coalesce(lubrifiant_espece,0), 0 from daily_reports
union all
select station_id, report_date, 'superette',
       coalesce(superette_espece,0), 0 from daily_reports;

grant select on v_recette_groupe_jour to authenticated, anon;

-- ── v_ventes_mensuelles : total_depense mensuel = ESPÈCES uniquement ─
create or replace view v_ventes_mensuelles as
with dr as (
  select station_id, to_char(report_date,'YYYY-MM') as mois,
    sum(coalesce(ess_litres,0)+coalesce(gas_litres,0)) as litres_carburant,
    sum(coalesce(ess_litres,0)*coalesce(ess_pu,0)+coalesce(gas_litres,0)*coalesce(gas_pu,0)) as ca_carburant,
    sum((coalesce(ess_litres,0)+coalesce(gas_litres,0)) * (select marge_unitaire from settings where id=1)) as commission_carburant,
    sum(coalesce(gaz_espece,0)) as ventes_gaz,
    sum(coalesce(superette_espece,0)) as ventes_superette,
    sum(coalesce(lubrifiant_espece,0)) as ventes_lubrifiant,
    sum(coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
        +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0)) as recettes_especes,
    sum(coalesce(ess_bon,0)+coalesce(gas_bon,0)) as ventes_bon,
    count(*) as jours
  from daily_reports group by station_id, to_char(report_date,'YYYY-MM')
),
dep as (
  select station_id, to_char(coalesce(periode_fin, deposit_date, report_date),'YYYY-MM') as mois,
    sum(montant) as total_verse
  from deposits group by 1,2
),
exp as (
  select station_id, to_char(report_date,'YYYY-MM') as mois, sum(montant) as total_depense
  from expenses where coalesce(non_cash,false)=false group by 1,2
),
del as (
  select station_id, to_char(report_date,'YYYY-MM') as mois, sum(montant) as total_livraisons
  from deliveries group by 1,2
)
select dr.station_id, dr.mois, dr.litres_carburant, dr.ca_carburant, dr.commission_carburant,
  dr.ventes_gaz, dr.ventes_superette, dr.ventes_lubrifiant, dr.recettes_especes, dr.ventes_bon,
  coalesce(dep.total_verse,0)     as total_verse,
  coalesce(exp.total_depense,0)   as total_depense,
  coalesce(del.total_livraisons,0) as total_livraisons,
  dr.jours
from dr
left join dep on dep.station_id=dr.station_id and dep.mois=dr.mois
left join exp on exp.station_id=dr.station_id and exp.mois=dr.mois
left join del on del.station_id=dr.station_id and del.mois=dr.mois;

grant select on v_ventes_mensuelles to authenticated, anon;


-- ============================================================
--  MIGRATION v37 — Fiabiliser l'anti-coulage cuve & l'écart compteur.
--
--  Problème : quand les index compteurs du matin sont saisis de façon
--  incohérente (petit nombre un jour, totaliseur complet un autre), le
--  « litres vendus » calculé explose (ex. 966 518 L/jour) → cuve attendue
--  NÉGATIVE → fausse alerte « fuite/vol » démesurée.
--
--  Correctif (approuvé par l'utilisateur) :
--   1) v_report_metrics : on plafonne ess/gas_litres_calc — un écart d'index
--      matin ≥ 30 000 L n'est PAS crédible → ignoré (NULL), ne se propage plus.
--   2) v_alerts : ECART_STOCK « fuite/vol » n'est émis que si le résultat est
--      PLAUSIBLE (cuve attendue ≥ 0, litres ≤ 30 000, |écart| ≤ 20 000). Sinon,
--      nouvelle alerte DONNEES_INCOHERENTES « compteur/cuve à vérifier ».
--
--  À exécuter dans Supabase > SQL Editor > Run (après v36). Idempotente.
-- ============================================================

-- ── 1. v_report_metrics : plafonner le litres-compteur (garde v36 : non_cash) ──
create or replace view v_report_metrics as
with base as (
  select r.*,
    coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
      +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0) as cash_declare,
    coalesce(ess_bon,0)+coalesce(gas_bon,0) as ventes_bon,
    coalesce(e1_m,0)+coalesce(e2_m,0)+coalesce(e3_m,0)+coalesce(e4_m,0) as e_open,
    coalesce(g1_m,0)+coalesce(g2_m,0)+coalesce(g3_m,0)+coalesce(g4_m,0) as g_open
  from daily_reports r),
withlead as (
  select *,
    lead(e_open) over (partition by station_id order by report_date) as e_open_next,
    lead(g_open) over (partition by station_id order by report_date) as g_open_next,
    lead(report_date) over (partition by station_id order by report_date) as next_date
  from base),
calc as (
  select *,
    case when next_date = report_date + 1 and e_open>0 and e_open_next>=e_open and (e_open_next - e_open) < 30000 then e_open_next - e_open end as ess_litres_calc,
    case when next_date = report_date + 1 and g_open>0 and g_open_next>=g_open and (g_open_next - g_open) < 30000 then g_open_next - g_open end as gas_litres_calc
  from withlead)
select c.*,
  coalesce(c.ess_litres, c.ess_litres_calc) as ess_litres_retenu,
  coalesce(c.gas_litres, c.gas_litres_calc) as gas_litres_retenu,
  (coalesce(c.ess_litres,0) + coalesce(c.gas_litres,0))
    * (select marge_unitaire from settings where id=1) as marge_estimee,
  coalesce(c.ess_litres,0) * coalesce(c.ess_pu,0)
    + coalesce(c.gas_litres,0) * coalesce(c.gas_pu,0) as ca_carburant,
  (select coalesce(sum(montant),0) from expenses e
     where e.report_date=c.report_date and e.station_id=c.station_id and coalesce(e.non_cash,false)=false) as total_depense,
  (select coalesce(sum(montant),0) from deposits d
     where d.station_id=c.station_id and coalesce(d.periode_fin, d.deposit_date, d.report_date)=c.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons
from calc c;

grant select on v_report_metrics to authenticated, anon;

-- ── 2. v_alerts : garde-fou anti-coulage + alerte « données à vérifier » ──
create or replace view v_alerts as
-- a) écart de versement sur une période clôturée
select station_id, periode_fin as report_date, 'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  case when pole_groupe='carburant'
    then 'carburant : (espèce '||round(recette_periode)||' − dépenses '||round(depense_periode)||') ≠ versé '||round(verse)||' → écart '||round(ecart)||' F'
    else pole_groupe||' : recette '||round(recette_periode)||' ≠ versé '||round(verse)||' → écart '||round(ecart)||' F' end as detail
from v_verse_recon where ecart > 1000
union all
-- b) recette non couverte > 3 jours
select r.station_id, r.report_date, 'VERSEMENT_MANQUANT', 'haute',
  'Recette '||r.pole_groupe||' '||round(r.espece)||' F non versée (aucune période ne la couvre, > 3 j)'
from v_recette_groupe_jour r
where r.espece > 1000 and r.report_date < current_date - 3
  and not exists (select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin)
union all
-- c) dépense non justifiée
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
-- d) écart compteur RÉEL (index a avancé, plafonné en amont)
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics
where ess_litres_calc is not null and ess_litres_calc > 0 and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Gasoil: compteurs '||round(gas_litres_calc)||' L vs déclaré '||round(gas_litres)||' L'
from v_report_metrics
where gas_litres_calc is not null and gas_litres_calc > 0 and gas_litres is not null and abs(gas_litres_calc - gas_litres) > 100
union all
-- d') relevé du matin du lendemain manquant/non mis à jour
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur essence du matin du '||to_char(report_date+1,'DD/MM')||' manquant ou non mis à jour (index identique à la veille) — impossible de vérifier les '||round(ess_litres)||' L déclarés le '||to_char(report_date,'DD/MM')
from v_report_metrics
where next_date = report_date + 1 and ess_litres is not null and ess_litres > 100 and coalesce(e_open_next,0) <= coalesce(e_open,0)
union all
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur gasoil du matin du '||to_char(report_date+1,'DD/MM')||' manquant ou non mis à jour (index identique à la veille) — impossible de vérifier les '||round(gas_litres)||' L déclarés le '||to_char(report_date,'DD/MM')
from v_report_metrics
where next_date = report_date + 1 and gas_litres is not null and gas_litres > 100 and coalesce(g_open_next,0) <= coalesce(g_open,0)
union all
-- e) stock carburant bas
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Essence: '||round(coalesce(l.ess_stock,0))||' L (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.ess_stock is not null and l.ess_stock < l.seuil_essence
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Gasoil: '||round(coalesce(l.gas_stock,0))||' L (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil
union all
-- f) ANTI-COULAGE carburant : seulement si le résultat est PLAUSIBLE
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_ess is not null and abs(ecart_ess) > 300
  and ess_attendu >= 0 and ess_next >= 0 and coalesce(ess_litres_retenu,0) <= 30000 and abs(ecart_ess) <= 20000
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_gas is not null and abs(ecart_gas) > 300
  and gas_attendu >= 0 and gas_next >= 0 and coalesce(gas_litres_retenu,0) <= 30000 and abs(ecart_gas) <= 20000
union all
-- f') DONNÉES INCOHÉRENTES : résultat physiquement impossible → vérifier les index (pas une fuite)
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Essence: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — litres calculés '||round(coalesce(ess_litres_retenu,0))||' L, cuve attendue '||round(ess_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_ess is not null and (ess_attendu < 0 or coalesce(ess_litres_retenu,0) > 30000 or abs(ecart_ess) > 20000)
union all
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Gasoil: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — litres calculés '||round(coalesce(gas_litres_retenu,0))||' L, cuve attendue '||round(gas_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_gas is not null and (gas_attendu < 0 or coalesce(gas_litres_retenu,0) > 30000 or abs(ecart_gas) > 20000)
union all
-- g) point du jour manquant
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;


-- ============================================================
--  MIGRATION v38 — Réconciliation compteur & cuve dans le BON SENS (backward).
--
--  Modèle réel (confirmé par l'utilisateur) :
--    • Les relevés (index compteur + niveau de cuve) sont les valeurs RÉELLES
--      à 8h du jour J.
--    • Les ventes déclarées du jour J couvrent la période 8h(J-1) → 8h(J).
--
--  Donc ventes(J) doivent = mouvement compteur backward = index_matin(J) −
--  index_matin(J-1) ; et cuve(J) = cuve(J-1) − ventes(J) + livraisons(J).
--
--  L'ancienne formule calculait EN AVANT (matin(J+1) − matin(J)), soit la
--  période du LENDEMAIN → décalage d'un jour → faux écarts compteur et cuves
--  attendues négatives. On repasse tout en backward.
--
--  On NE touche PAS v_report_metrics (on recalcule le mouvement dans
--  v_stock_recon). On recrée v_stock_recon (colonnes changées) + v_alerts.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v37). Idempotente.
-- ============================================================

drop view if exists v_stock_recon cascade;   -- (dépendance : v_alerts, recréé plus bas)

-- ── v_stock_recon : mouvement compteur & cuve attendue, en BACKWARD ──
create view v_stock_recon as
with b as (
  select station_id, report_date, ess_stock, gas_stock, ess_litres, gas_litres, e_open, g_open,
    lag(ess_stock)   over w as ess_prev,
    lag(gas_stock)   over w as gas_prev,
    lag(e_open)      over w as e_open_prev,
    lag(g_open)      over w as g_open_prev,
    lag(report_date) over w as prev_date
  from v_report_metrics
  window w as (partition by station_id order by report_date)
),
mv as (
  select b.*,
    -- mouvement compteur de la PÉRIODE des ventes du jour (8h veille → 8h jour)
    case when b.prev_date = b.report_date - 1 and b.e_open>0 and b.e_open_prev>0
           and b.e_open >= b.e_open_prev and (b.e_open - b.e_open_prev) < 30000
         then b.e_open - b.e_open_prev end as ess_mouvement,
    case when b.prev_date = b.report_date - 1 and b.g_open>0 and b.g_open_prev>0
           and b.g_open >= b.g_open_prev and (b.g_open - b.g_open_prev) < 30000
         then b.g_open - b.g_open_prev end as gas_mouvement,
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.report_date and o.produit='essence' and o.statut='recue') as deliv_ess,
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.report_date and o.produit='gasoil' and o.statut='recue') as deliv_gas
  from b
)
select mv.*,
  coalesce(ess_litres, ess_mouvement) as ess_retenu,
  coalesce(gas_litres, gas_mouvement) as gas_retenu,
  -- cuve attendue = cuve de la VEILLE − ventes du jour + livraisons du jour
  (ess_prev - coalesce(ess_litres, ess_mouvement, 0) + deliv_ess) as ess_attendu,
  (gas_prev - coalesce(gas_litres, gas_mouvement, 0) + deliv_gas) as gas_attendu,
  case when prev_date = report_date - 1 and ess_stock is not null and ess_prev is not null
       then ess_stock - (ess_prev - coalesce(ess_litres, ess_mouvement, 0) + deliv_ess) end as ecart_ess,
  case when prev_date = report_date - 1 and gas_stock is not null and gas_prev is not null
       then gas_stock - (gas_prev - coalesce(gas_litres, gas_mouvement, 0) + deliv_gas) end as ecart_gas
from mv;

grant select on v_stock_recon to authenticated, anon;

-- ── v_alerts : compteur & cuve pilotés par le nouveau v_stock_recon (backward) ──
create view v_alerts as
-- a) écart de versement sur une période clôturée
select station_id, periode_fin as report_date, 'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  case when pole_groupe='carburant'
    then 'carburant : (espèce '||round(recette_periode)||' − dépenses '||round(depense_periode)||') ≠ versé '||round(verse)||' → écart '||round(ecart)||' F'
    else pole_groupe||' : recette '||round(recette_periode)||' ≠ versé '||round(verse)||' → écart '||round(ecart)||' F' end as detail
from v_verse_recon where ecart > 1000
union all
-- b) recette non couverte > 3 jours
select r.station_id, r.report_date, 'VERSEMENT_MANQUANT', 'haute',
  'Recette '||r.pole_groupe||' '||round(r.espece)||' F non versée (aucune période ne la couvre, > 3 j)'
from v_recette_groupe_jour r
where r.espece > 1000 and r.report_date < current_date - 3
  and not exists (select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin)
union all
-- c) dépense non justifiée
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
-- d) écart compteur RÉEL (mouvement backward vs déclaré)
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_mouvement)||' L vs déclaré '||round(ess_litres)||' L'
from v_stock_recon
where ess_mouvement is not null and ess_litres is not null and abs(ess_mouvement - ess_litres) > 100
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Gasoil: compteurs '||round(gas_mouvement)||' L vs déclaré '||round(gas_litres)||' L'
from v_stock_recon
where gas_mouvement is not null and gas_litres is not null and abs(gas_mouvement - gas_litres) > 100
union all
-- d') relevé compteur du matin non mis à jour (index identique à la veille)
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur essence du '||to_char(report_date,'DD/MM')||' non mis à jour (index identique à la veille) — impossible de vérifier les '||round(ess_litres)||' L déclarés'
from v_stock_recon
where prev_date = report_date - 1 and ess_litres is not null and ess_litres > 100 and coalesce(e_open,0) <= coalesce(e_open_prev,0)
union all
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur gasoil du '||to_char(report_date,'DD/MM')||' non mis à jour (index identique à la veille) — impossible de vérifier les '||round(gas_litres)||' L déclarés'
from v_stock_recon
where prev_date = report_date - 1 and gas_litres is not null and gas_litres > 100 and coalesce(g_open,0) <= coalesce(g_open_prev,0)
union all
-- e) stock carburant bas
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Essence: '||round(coalesce(l.ess_stock,0))||' L (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.ess_stock is not null and l.ess_stock < l.seuil_essence
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Gasoil: '||round(coalesce(l.gas_stock,0))||' L (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil
union all
-- f) ANTI-COULAGE carburant (backward) : seulement si le résultat est PLAUSIBLE
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_stock)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_ess is not null and abs(ecart_ess) > 300
  and ess_attendu >= 0 and ess_stock >= 0 and coalesce(ess_retenu,0) <= 30000 and abs(ecart_ess) <= 20000
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_stock)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_gas is not null and abs(ecart_gas) > 300
  and gas_attendu >= 0 and gas_stock >= 0 and coalesce(gas_retenu,0) <= 30000 and abs(ecart_gas) <= 20000
union all
-- f') DONNÉES INCOHÉRENTES : résultat physiquement impossible → vérifier (pas une fuite)
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Essence: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — ventes '||round(coalesce(ess_retenu,0))||' L, cuve attendue '||round(ess_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_ess is not null and (ess_attendu < 0 or coalesce(ess_retenu,0) > 30000 or abs(ecart_ess) > 20000)
union all
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Gasoil: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — ventes '||round(coalesce(gas_retenu,0))||' L, cuve attendue '||round(gas_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_gas is not null and (gas_attendu < 0 or coalesce(gas_retenu,0) > 30000 or abs(ecart_gas) > 20000)
union all
-- g) point du jour manquant
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;


-- ============================================================
--  MIGRATION v39 — « Bons en cours » impacté par les bons utilisés
--  au LANCEMENT d'une commande (carburant : bons_base ; gaz/lubrifiant :
--  montant_paiement quand mode_paiement='bons').
--
--  Approche DÉRIVÉE (choisie) : on NE MODIFIE PAS daily_reports.total_bon_cumul
--  (saisie manuelle du gérant, upsert complet à chaque « Point du jour » →
--  une déduction écrite là serait écrasée par sa prochaine saisie).
--  À la place, v_latest_stock.bons_restant = dernier total_bon_cumul déclaré
--  − somme des bons dépensés sur des commandes LANCÉES depuis cette
--  déclaration (date_lancement > date de la déclaration, hors commandes
--  annulées). Nouvelle colonne bons_utilises_depuis (transparence UI).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v38). Idempotente.
-- ============================================================

create or replace view v_latest_stock as
select s.id as station_id, s.nom, s.seuil_essence, s.seuil_gasoil,
  (select report_date from daily_reports r where r.station_id=s.id order by report_date desc limit 1) as derniere_date,
  (select ess_stock from daily_reports r where r.station_id=s.id and ess_stock is not null order by report_date desc limit 1) as ess_stock,
  (select gas_stock from daily_reports r where r.station_id=s.id and gas_stock is not null order by report_date desc limit 1) as gas_stock,
  case when (select total_bon_cumul from daily_reports r where r.station_id=s.id and total_bon_cumul is not null order by report_date desc limit 1) is null
    then null
    else
      (select total_bon_cumul from daily_reports r where r.station_id=s.id and total_bon_cumul is not null order by report_date desc limit 1)
      - coalesce((
          select sum(case
              when o.categorie = 'carburant' then coalesce(o.bons_base,0)
              when o.categorie in ('gaz','lubrifiant') and o.mode_paiement = 'bons' then coalesce(o.montant_paiement,0)
              else 0 end)
          from fuel_orders o
          where o.station_id = s.id and o.date_lancement is not null and o.statut <> 'annulee'
            and o.date_lancement > (select report_date from daily_reports r where r.station_id=s.id and r.total_bon_cumul is not null order by report_date desc limit 1)
        ), 0)
  end as bons_restant,
  (select gaz_stock_3 from daily_reports r where r.station_id=s.id and gaz_stock_3 is not null order by report_date desc limit 1) as gaz_stock_3,
  (select gaz_stock_6 from daily_reports r where r.station_id=s.id and gaz_stock_6 is not null order by report_date desc limit 1) as gaz_stock_6,
  (select gaz_stock_12 from daily_reports r where r.station_id=s.id and gaz_stock_12 is not null order by report_date desc limit 1) as gaz_stock_12,
  (select gaz_stock_38 from daily_reports r where r.station_id=s.id and gaz_stock_38 is not null order by report_date desc limit 1) as gaz_stock_38,
  (select lubrifiant_stock from daily_reports r where r.station_id=s.id and lubrifiant_stock is not null order by report_date desc limit 1) as lubrifiant_stock,
  -- NOUVEAU (v39, ajouté en fin de vue) : bons consommés depuis la dernière déclaration (transparence).
  coalesce((
    select sum(case
        when o.categorie = 'carburant' then coalesce(o.bons_base,0)
        when o.categorie in ('gaz','lubrifiant') and o.mode_paiement = 'bons' then coalesce(o.montant_paiement,0)
        else 0 end)
    from fuel_orders o
    where o.station_id = s.id and o.date_lancement is not null and o.statut <> 'annulee'
      and o.date_lancement > coalesce((select report_date from daily_reports r where r.station_id=s.id and r.total_bon_cumul is not null order by report_date desc limit 1), '1900-01-01'::date)
  ), 0) as bons_utilises_depuis
from stations s;

grant select on v_latest_stock to authenticated, anon;


-- ============================================================
--  MIGRATION v40 — Perte livraison correcte pour les commandes
--  reçues en PLUSIEURS fois (réceptions partielles).
--
--  Problème : fuel_orders.cuve_avant = cuve_avant de la 1re réception,
--  cuve_apres = cuve_apres de la DERNIÈRE réception (écrasé à chaque
--  réception). Pour une commande reçue en 2+ fois, si du carburant a été
--  VENDU entre les deux livraisons, (dernier cuve_apres − premier cuve_avant)
--  inclut ces ventes → perte de livraison FAUSSEMENT gonflée. Cette perte
--  alimente le Point financier (base de retenue potentielle sur salaire) :
--  impact réel, pas juste cosmétique.
--
--  Correctif : la livraison réelle = SOMME des (cuve_apres − cuve_avant)
--  de CHAQUE réception individuelle (order_receptions stocke déjà cuve
--  avant/après PAR réception) — chaque delta ne couvre que sa propre
--  livraison, insensible aux ventes entre deux réceptions.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v39). Idempotente.
-- ============================================================

create or replace view v_order_livraison as
select order_id, station_id,
  sum(case when cuve_avant is not null and cuve_apres is not null then cuve_apres - cuve_avant else 0 end) as livre_reel,
  sum(quantite_recue) as quantite_recue_total,
  count(*) as nb_receptions
from order_receptions
group by order_id, station_id;

grant select on v_order_livraison to authenticated, anon;

-- v_pertes_livraison : même colonnes qu'avant (v16), calcul de « livre » corrigé.
create or replace view v_pertes_livraison as
with t as (select taux_perte_acceptable as tx from settings where id=1)
select o.id, o.station_id, o.report_date, o.produit,
  o.quantite_commandee,
  coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant) as livre,
  greatest(o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0), 0) as perte_litres,
  round(o.quantite_commandee * (select tx from t) / 100) as seuil_acceptable,
  greatest((o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0)) - o.quantite_commandee * (select tx from t)/100, 0) as perte_na_litres,
  coalesce(o.prix_achat,0) as prix_achat,
  round(greatest((o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0)) - o.quantite_commandee * (select tx from t)/100, 0) * coalesce(o.prix_achat,0)) as perte_na_montant
from fuel_orders o
left join v_order_livraison l on l.order_id = o.id
where o.statut='recue' and o.quantite_commandee is not null
  and (l.livre_reel is not null or (o.cuve_apres is not null and o.cuve_avant is not null));

grant select on v_pertes_livraison to authenticated, anon;
-- v_pertes_mensuelles (agrégation sur v_pertes_livraison) n'a pas besoin d'être
-- recréée : même structure de colonnes, elle hérite automatiquement du correctif.
