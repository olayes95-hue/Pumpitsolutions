-- ============================================================
--  MIGRATION v30 — Calcul AUTOMATIQUE du délai de livraison.
--  Délai = date de LANCEMENT de la commande → date de la 1re RÉCEPTION.
--  La prévision (v_reorder) utilise désormais le délai MOYEN RÉEL par produit
--  (calculé sur l'historique des commandes), avec repli sur le réglage manuel.
--  À exécuter dans Supabase > SQL Editor > Run (après v29).
-- ============================================================

-- 1) Délai par commande reçue (au moins partiellement)
create or replace view v_order_lead as
select o.id as order_id, o.station_id, o.produit, o.categorie,
  o.date_lancement,
  coalesce((select min(r.report_date) from order_receptions r where r.order_id=o.id), o.report_date) as date_reception,
  ( coalesce((select min(r.report_date) from order_receptions r where r.order_id=o.id), o.report_date)
    - o.date_lancement ) as delai_jours
from fuel_orders o
where o.date_lancement is not null
  and o.statut in ('recue','partielle')
  and coalesce((select min(r.report_date) from order_receptions r where r.order_id=o.id), o.report_date) is not null;

grant select on v_order_lead to authenticated, anon;

-- 2) Délai MOYEN par station + produit (carburant), sur délais cohérents (0–30 j)
create or replace view v_delai_moyen as
select station_id, produit,
  round(avg(delai_jours)::numeric, 1) as delai_moyen_jours,
  count(*) as nb_commandes,
  min(delai_jours) as delai_min, max(delai_jours) as delai_max
from v_order_lead
where categorie = 'carburant' and delai_jours between 0 and 30
group by station_id, produit;

grant select on v_delai_moyen to authenticated, anon;

-- 3) v_reorder : utilise le délai moyen CALCULÉ (repli : réglage delai_livraison_jours, sinon 3 j)
--    On DROP d'abord car les colonnes changent (ajout de lead / nb_delai) et
--    CREATE OR REPLACE VIEW interdit de réordonner/renommer les colonnes.
drop view if exists v_reorder cascade;
create view v_reorder as
with p as (
  select coalesce(delai_livraison_jours,3) as lead_def, coalesce(jours_securite,2) as secu,
         coalesce(marge_unitaire,25) as marge from settings where id=1
)
select x.*,
  round(x.conso_jour * (x.lead + x.secu)) as seuil_commande_litres,
  case when x.conso_jour > 0 then greatest(round(x.jours_restant - x.lead - x.secu), 0) end as jours_avant_commande,
  case when x.conso_jour > 0
    then (current_date + greatest(round(x.jours_restant - x.lead - x.secu), 0) * interval '1 day')::date end as date_commande_conseillee,
  case when x.jours_restant is not null then (current_date + round(x.jours_restant) * interval '1 day')::date end as date_rupture_estimee,
  (x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant <= x.lead + x.secu) as commander_maintenant,
  case when x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant < x.lead
    then round((x.lead - x.jours_restant) * x.conso_jour * (select marge from p)) else 0 end as manque_a_gagner_estime
from (
  select f.station_id, f.nom, 'essence'::text as produit,
    f.ess_stock as stock, f.conso_ess_jour as conso_jour, f.jours_essence as jours_restant,
    coalesce((select delai_moyen_jours from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='essence'),
             (select lead_def from p)) as lead,
    (select secu from p) as secu,
    coalesce((select nb_commandes from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='essence'),0) as nb_delai
  from v_stock_forecast f
  union all
  select f.station_id, f.nom, 'gasoil',
    f.gas_stock, f.conso_gas_jour, f.jours_gasoil,
    coalesce((select delai_moyen_jours from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='gasoil'),
             (select lead_def from p)),
    (select secu from p),
    coalesce((select nb_commandes from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='gasoil'),0)
  from v_stock_forecast f
) x;

grant select on v_reorder to authenticated, anon;
