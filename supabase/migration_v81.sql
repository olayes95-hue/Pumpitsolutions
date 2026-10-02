-- Fix : v_stock_recon ignorait les livraisons encore "partielle" (pas complètement
-- soldées) dans le calcul de la cuve attendue — deliv_ess/deliv_gas ne comptaient que
-- les commandes déjà passées au statut 'recue'. Une réception partielle fait pourtant
-- réellement entrer du carburant dans la cuve : ignorée, elle produit un faux écart
-- énorme (fausse alerte "fuite/vol ?") le jour même d'une livraison légitime.
--
-- Fix : lire les livraisons depuis order_receptions (une ligne par passage réel du
-- camion, avec sa propre date/cuve_avant/cuve_apres) plutôt que depuis le statut
-- de la commande parente — même logique que v_order_livraison, qui existait déjà
-- pour la même raison côté page Commandes.

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
    case when b.prev_date = b.report_date - 1 and b.e_open>0 and b.e_open_prev>0
           and b.e_open >= b.e_open_prev and (b.e_open - b.e_open_prev) < 30000
         then b.e_open - b.e_open_prev end as ess_mouvement,
    case when b.prev_date = b.report_date - 1 and b.g_open>0 and b.g_open_prev>0
           and b.g_open >= b.g_open_prev and (b.g_open - b.g_open_prev) < 30000
         then b.g_open - b.g_open_prev end as gas_mouvement,
    (select coalesce(sum(r.cuve_apres - r.cuve_avant), 0) from order_receptions r
       join fuel_orders o on o.id = r.order_id
       where r.station_id = b.station_id and r.report_date = b.report_date and o.produit = 'essence'
         and r.cuve_avant is not null and r.cuve_apres is not null) as deliv_ess,
    (select coalesce(sum(r.cuve_apres - r.cuve_avant), 0) from order_receptions r
       join fuel_orders o on o.id = r.order_id
       where r.station_id = b.station_id and r.report_date = b.report_date and o.produit = 'gasoil'
         and r.cuve_avant is not null and r.cuve_apres is not null) as deliv_gas
  from b
)
select mv.*,
  coalesce(ess_litres, ess_mouvement) as ess_retenu,
  coalesce(gas_litres, gas_mouvement) as gas_retenu,
  (ess_prev - coalesce(ess_litres, ess_mouvement, 0) + deliv_ess) as ess_attendu,
  (gas_prev - coalesce(gas_litres, gas_mouvement, 0) + deliv_gas) as gas_attendu,
  case when prev_date = report_date - 1 and ess_stock is not null and ess_prev is not null
       then ess_stock - (ess_prev - coalesce(ess_litres, ess_mouvement, 0) + deliv_ess) end as ecart_ess,
  case when prev_date = report_date - 1 and gas_stock is not null and gas_prev is not null
       then gas_stock - (gas_prev - coalesce(gas_litres, gas_mouvement, 0) + deliv_gas) end as ecart_gas
from mv;
