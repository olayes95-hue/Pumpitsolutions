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
