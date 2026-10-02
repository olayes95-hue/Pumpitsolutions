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
