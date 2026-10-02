-- Fix : un contrôle/intervention (ANM, Bénin Pétro...) fait passer du carburant par la pompe
-- (prélèvement) puis le restitue en cuve — la CUVE ne bouge donc pas, mais l'INDEX COMPTEUR si,
-- puisqu'un index de pompe compte tout débit qui passe, vente ou pas. Sans correction, ce
-- mouvement se comparait aux ventes déclarées comme si c'était un écart compteur suspect
-- (ECART_COMPTEUR dans v_alerts), alors que ce n'en est pas un.
--
-- Fix : déduit, avant comparaison, le mouvement compteur expliqué par les contrôles du jour
-- (index_avant/index_apres saisis par pompe dans inspections.pompes_detail — migration_v86).
-- La cuve (ecart_ess/ecart_gas, anti-coulage) n'est PAS concernée par ce fix : le carburant
-- prélevé étant restitué, elle n'a jamais eu besoin d'ajustement.

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
insp as (
  -- Mouvement compteur expliqué par un contrôle/intervention (prélèvement + retour en cuve),
  -- par station et par jour — somme des (index_après − index_avant) déclarés pompe par pompe.
  select i.station_id, i.date_controle as report_date,
    sum(case when elem->>'produit' = 'essence'
      then greatest(0, coalesce((elem->>'index_apres')::numeric, 0) - coalesce((elem->>'index_avant')::numeric, 0)) else 0 end) as insp_ess,
    sum(case when elem->>'produit' = 'gasoil'
      then greatest(0, coalesce((elem->>'index_apres')::numeric, 0) - coalesce((elem->>'index_avant')::numeric, 0)) else 0 end) as insp_gas
  from inspections i, jsonb_array_elements(coalesce(i.pompes_detail, '[]'::jsonb)) elem
  group by i.station_id, i.date_controle
),
mv as (
  select b.*,
    case when b.prev_date = b.report_date - 1 and b.e_open>0 and b.e_open_prev>0
           and b.e_open >= b.e_open_prev and (b.e_open - b.e_open_prev) < 30000
         then greatest(0, (b.e_open - b.e_open_prev) - coalesce(insp.insp_ess, 0)) end as ess_mouvement,
    case when b.prev_date = b.report_date - 1 and b.g_open>0 and b.g_open_prev>0
           and b.g_open >= b.g_open_prev and (b.g_open - b.g_open_prev) < 30000
         then greatest(0, (b.g_open - b.g_open_prev) - coalesce(insp.insp_gas, 0)) end as gas_mouvement,
    (select coalesce(sum(r.cuve_apres - r.cuve_avant), 0) from order_receptions r
       join fuel_orders o on o.id = r.order_id
       where r.station_id = b.station_id and r.report_date = b.report_date and o.produit = 'essence'
         and r.cuve_avant is not null and r.cuve_apres is not null) as deliv_ess,
    (select coalesce(sum(r.cuve_apres - r.cuve_avant), 0) from order_receptions r
       join fuel_orders o on o.id = r.order_id
       where r.station_id = b.station_id and r.report_date = b.report_date and o.produit = 'gasoil'
         and r.cuve_avant is not null and r.cuve_apres is not null) as deliv_gas
  from b
  left join insp on insp.station_id = b.station_id and insp.report_date = b.report_date
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
