-- ============================================================
--  MIGRATION v13 — Anti-coulage : réconciliation cuve/compteurs.
--  cuve(J) − litres vendus(J) + livraisons(J)  doit ≈ cuve(J+1).
--  Sinon -> alerte ECART_STOCK (fuite / vol de volume).
--  À exécuter dans Supabase > SQL Editor > Run (après v12).
-- ============================================================

create or replace view v_stock_recon as
with base as (
  select station_id, report_date, ess_stock, gas_stock, ess_litres_retenu, gas_litres_retenu,
    lead(ess_stock)   over w as ess_next,
    lead(gas_stock)   over w as gas_next,
    lead(report_date) over w as next_date
  from v_report_metrics
  window w as (partition by station_id order by report_date)
),
d as (
  select b.*,
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.report_date and o.produit='essence' and o.statut='recue') as deliv_ess,
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.report_date and o.produit='gasoil' and o.statut='recue') as deliv_gas
  from base b
)
select d.*,
  (d.ess_stock - coalesce(d.ess_litres_retenu,0) + d.deliv_ess) as ess_attendu,
  (d.gas_stock - coalesce(d.gas_litres_retenu,0) + d.deliv_gas) as gas_attendu,
  case when d.next_date = d.report_date + 1 and d.ess_stock is not null and d.ess_next is not null
       then d.ess_next - (d.ess_stock - coalesce(d.ess_litres_retenu,0) + d.deliv_ess) end as ecart_ess,
  case when d.next_date = d.report_date + 1 and d.gas_stock is not null and d.gas_next is not null
       then d.gas_next - (d.gas_stock - coalesce(d.gas_litres_retenu,0) + d.deliv_gas) end as ecart_gas
from d;

grant select on v_stock_recon to authenticated, anon;

-- Recréer v_alerts avec ECART_STOCK
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
select l.station_id, l.derniere_date, 'STOCK_BAS_GAZ','moyenne',
  'Gaz bas : '||concat_ws(', ',
    case when l.gaz_stock_3  < s.seuil_gaz then '3kg='||round(l.gaz_stock_3) end,
    case when l.gaz_stock_6  < s.seuil_gaz then '6kg='||round(l.gaz_stock_6) end,
    case when l.gaz_stock_12 < s.seuil_gaz then '12kg='||round(l.gaz_stock_12) end,
    case when l.gaz_stock_38 < s.seuil_gaz then '38kg='||round(l.gaz_stock_38) end)
from v_latest_stock l join stations s on s.id=l.station_id
where l.gaz_stock_3 < s.seuil_gaz or l.gaz_stock_6 < s.seuil_gaz or l.gaz_stock_12 < s.seuil_gaz or l.gaz_stock_38 < s.seuil_gaz
union all
select l.station_id, l.derniere_date, 'STOCK_BAS_LUBRIFIANT','moyenne',
  'Lubrifiant bas : '||string_agg(kv.key||'='||kv.value, ', ')
from v_latest_stock l join stations s on s.id=l.station_id,
  lateral jsonb_each_text(l.lubrifiant_stock) kv
where l.lubrifiant_stock is not null and kv.value ~ '^[0-9]+$' and kv.value::numeric < s.seuil_lubrifiant
group by l.station_id, l.derniere_date
union all
-- ANTI-COULAGE : écart entre cuve déclarée et cuve attendue
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon where ecart_ess is not null and abs(ecart_ess) > 300
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon where ecart_gas is not null and abs(ecart_gas) > 300
union all
select s.id as station_id, dd::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') dd
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = dd::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < dd::date);

grant select on v_alerts to authenticated, anon;
