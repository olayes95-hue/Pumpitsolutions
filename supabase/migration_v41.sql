-- ============================================================
--  MIGRATION v41 — Seuil de RUPTURE physique de la cuve (200-300 L).
--
--  En dessous d'un certain niveau (crépine de la pompe), il n'y a plus de
--  ventes normales possibles — le stock « utile » s'arrête là, pas à 0 L.
--  Les prédictions (jours d'autonomie, date de rupture estimée, alerte
--  « commander maintenant ») doivent se baser sur (stock − seuil_rupture),
--  pas sur le stock brut.
--
--  Valeur par défaut : 250 L (réglable dans Stations & équipe > Prix & marge).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v40). Idempotente.
-- ============================================================

alter table settings add column if not exists seuil_rupture numeric not null default 250;

-- v_stock_forecast : autonomie calculée sur le stock UTILE (stock − seuil_rupture, plancher 0).
create or replace view v_stock_forecast as
with conso as (
  select station_id,
    avg(ess_litres_retenu) filter (where ess_litres_retenu is not null and ess_litres_retenu>0) as conso_ess_jour,
    avg(gas_litres_retenu) filter (where gas_litres_retenu is not null and gas_litres_retenu>0) as conso_gas_jour
  from (
    select station_id, report_date, ess_litres_retenu, gas_litres_retenu,
      row_number() over (partition by station_id order by report_date desc) as rn
    from v_report_metrics) t
  where rn <= 30
  group by station_id)
select l.station_id, l.nom, l.ess_stock, l.gas_stock, l.seuil_essence, l.seuil_gasoil,
  c.conso_ess_jour, c.conso_gas_jour,
  case when c.conso_ess_jour>0
    then round(greatest(l.ess_stock - (select seuil_rupture from settings where id=1), 0) / c.conso_ess_jour, 1) end as jours_essence,
  case when c.conso_gas_jour>0
    then round(greatest(l.gas_stock - (select seuil_rupture from settings where id=1), 0) / c.conso_gas_jour, 1) end as jours_gasoil
from v_latest_stock l left join conso c on c.station_id = l.station_id;

grant select on v_stock_forecast to authenticated, anon;
-- v_reorder (prévision de commande) lit jours_essence/jours_gasoil depuis v_stock_forecast
-- → hérite automatiquement du correctif, aucune modification nécessaire de son côté.
