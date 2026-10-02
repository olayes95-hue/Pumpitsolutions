-- ============================================================
--  MIGRATION v12 — Alertes stock GAZ et LUBRIFIANT (autres pôles)
--  À exécuter dans Supabase > SQL Editor > Run (après v11).
-- ============================================================

alter table stations add column if not exists seuil_gaz numeric default 5;         -- bouteilles mini / type
alter table stations add column if not exists seuil_lubrifiant numeric default 2;  -- unités mini / référence

-- On recrée v_alerts avec les branches gaz + lubrifiant en plus
drop view if exists v_alerts;
create view v_alerts as
select station_id, report_date, 'VERSEMENT_MANQUANT'::text as type, 'haute'::text as gravite,
  'Cash à verser '||round((cash_declare-total_depense))||' F, aucun versement' as detail
from v_report_metrics where (cash_declare-total_depense) > 1000 and total_verse = 0
union all
select station_id, report_date, 'VERSEMENT_INCOMPLET','haute',
  'Versé '||round(total_verse)||' F < à verser '||round(cash_declare-total_depense)||' F'
from v_report_metrics where total_verse > 0 and total_verse < (cash_declare-total_depense) - 1000
union all
select station_id, report_date, 'ECART_CAISSE','moyenne',
  'Écart '||round(cash_declare-total_depense-total_verse)||' F'
from v_report_metrics where abs(cash_declare-total_depense-total_verse) > 1000 and total_verse > 0
union all
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics where ess_litres_calc is not null and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
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
-- NOUVEAU : gaz bas (par type de bouteille)
select l.station_id, l.derniere_date, 'STOCK_BAS_GAZ','moyenne',
  'Gaz bas : '||concat_ws(', ',
    case when l.gaz_stock_3  < s.seuil_gaz then '3kg='||round(l.gaz_stock_3) end,
    case when l.gaz_stock_6  < s.seuil_gaz then '6kg='||round(l.gaz_stock_6) end,
    case when l.gaz_stock_12 < s.seuil_gaz then '12kg='||round(l.gaz_stock_12) end,
    case when l.gaz_stock_38 < s.seuil_gaz then '38kg='||round(l.gaz_stock_38) end)
from v_latest_stock l join stations s on s.id=l.station_id
where l.gaz_stock_3  < s.seuil_gaz or l.gaz_stock_6  < s.seuil_gaz
   or l.gaz_stock_12 < s.seuil_gaz or l.gaz_stock_38 < s.seuil_gaz
union all
-- NOUVEAU : lubrifiant bas (par référence dans l'inventaire)
select l.station_id, l.derniere_date, 'STOCK_BAS_LUBRIFIANT','moyenne',
  'Lubrifiant bas : '||string_agg(kv.key||'='||kv.value, ', ')
from v_latest_stock l join stations s on s.id=l.station_id,
  lateral jsonb_each_text(l.lubrifiant_stock) kv
where l.lubrifiant_stock is not null and kv.value ~ '^[0-9]+$' and kv.value::numeric < s.seuil_lubrifiant
group by l.station_id, l.derniere_date
union all
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;
