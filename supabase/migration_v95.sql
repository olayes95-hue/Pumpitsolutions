-- ============================================================
--  MIGRATION v95 — Fix décalage d'un jour dans la déduction du mouvement
--  compteur causé par un contrôle/intervention (migration_v87).
--
--  Confirmé sur un cas réel (Beaurivage, contrôle ANM du 08/09/2026) :
--  ECART_COMPTEUR s'est déclenché le 09/09, avec un écart EXACTEMENT égal
--  au prélèvement total du contrôle (186 L essence, 178 L gasoil) — preuve
--  que la déduction de v87 n'a eu aucun effet sur ce jour.
--
--  Cause : "matin" = relevé pris à 8h du jour J, qui capture tout mouvement
--  compteur survenu la VEILLE (journée J-1), contrôle inclus. v87 rattachait
--  le mouvement du contrôle à report_date = date_controle (08/09) — mais
--  le relevé qui capture réellement ce mouvement est celui du LENDEMAIN
--  (09/09). La déduction visait donc la mauvaise ligne, sans effet.
--
--  Fix : la CTE `insp` sort désormais report_date = date_controle + 1 jour.
--  Reste de la vue identique à v87 (aucun autre changement).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v93). Idempotente.
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
insp as (
  -- Mouvement compteur expliqué par un contrôle/intervention (prélèvement + retour en cuve),
  -- rattaché au relevé du LENDEMAIN du contrôle (date_controle + 1) — c'est ce relevé matin
  -- qui capture le mouvement de la journée du contrôle, pas celui du jour même.
  select i.station_id, (i.date_controle + 1) as report_date,
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

alter view public.v_stock_recon set (security_invoker = on);
grant select on v_stock_recon to authenticated, anon;
