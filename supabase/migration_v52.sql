-- ============================================================
--  MIGRATION v52 — Fix : alerte "Écart de cuve (fuite/vol ?)" ignorait
--  les livraisons reçues la veille (faux positifs).
--
--  v_stock_recon est un modèle BACKWARD : les ventes saisies sous la date
--  J couvrent la période 8h(J−1) → 8h(J) (cf. commentaire migration v38).
--  La cuve attendue au jour J doit donc intégrer les livraisons reçues
--  pendant cette même période, c'est-à-dire enregistrées sous J−1 — mais
--  la sous-requête deliv_ess/deliv_gas filtrait sur report_date = J (le
--  jour de l'alerte) au lieu de J−1 (prev_date), donc une livraison de la
--  veille n'était JAMAIS comptée dans la cuve attendue.
--
--  Symptôme observé (Beaurivage, 07/08) : "Gasoil: cuve déclarée 4300 L
--  vs attendue 300 L → écart 4000 L (fuite/vol ?)" alors qu'une livraison
--  de 4000 L avait été reçue la veille (06/08) — écart 100% artificiel,
--  qui matche exactement la quantité livrée.
--
--  Fix : deliv_ess/deliv_gas filtrent désormais sur o.report_date =
--  b.prev_date au lieu de b.report_date. Seule cette condition change —
--  aucune colonne ajoutée/renommée/réordonnée, v_alerts (qui dépend de
--  v_stock_recon) n'a pas besoin d'être recréée.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v51). Idempotente.
-- ============================================================

create or replace view v_stock_recon as
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
    -- FIX v52 : livraisons de la période = enregistrées sous J−1 (prev_date), pas J (report_date)
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.prev_date and o.produit='essence' and o.statut='recue') as deliv_ess,
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.prev_date and o.produit='gasoil' and o.statut='recue') as deliv_gas
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
