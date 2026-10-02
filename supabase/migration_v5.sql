-- ============================================================
--  MIGRATION v5 — Relevés compteurs du MATIN (ouverture) +
--  calcul automatique des litres (ouverture J+1 − ouverture J).
--  À exécuter dans Supabase > SQL Editor > Run (après v4).
-- ============================================================

-- Relevés d'ouverture (matin). Les colonnes e1..g4 existantes deviennent le "contrôle 16h".
alter table daily_reports add column if not exists e1_m numeric;
alter table daily_reports add column if not exists e2_m numeric;
alter table daily_reports add column if not exists e3_m numeric;
alter table daily_reports add column if not exists e4_m numeric;
alter table daily_reports add column if not exists g1_m numeric;
alter table daily_reports add column if not exists g2_m numeric;
alter table daily_reports add column if not exists g3_m numeric;
alter table daily_reports add column if not exists g4_m numeric;

-- On recrée les vues (l'ordre des colonnes change)
drop view if exists v_alerts;
drop view if exists v_stock_forecast;
drop view if exists v_latest_stock;
drop view if exists v_report_metrics;

create view v_report_metrics as
with base as (
  select r.*,
    coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
      +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0) as cash_declare,
    coalesce(ess_bon,0)+coalesce(gas_bon,0) as ventes_bon,
    coalesce(e1_m,0)+coalesce(e2_m,0)+coalesce(e3_m,0)+coalesce(e4_m,0) as e_open,
    coalesce(g1_m,0)+coalesce(g2_m,0)+coalesce(g3_m,0)+coalesce(g4_m,0) as g_open
  from daily_reports r),
withlead as (
  select *,
    lead(e_open) over (partition by station_id order by report_date) as e_open_next,
    lead(g_open) over (partition by station_id order by report_date) as g_open_next,
    lead(report_date) over (partition by station_id order by report_date) as next_date
  from base),
calc as (
  select *,
    case when next_date = report_date + 1 and e_open>0 and e_open_next>=e_open then e_open_next - e_open end as ess_litres_calc,
    case when next_date = report_date + 1 and g_open>0 and g_open_next>=g_open then g_open_next - g_open end as gas_litres_calc
  from withlead)
select c.*,
  -- ventes = saisie manuelle (déclaré) ; les litres calculés servent au CONTRÔLE (écart)
  coalesce(c.ess_litres, c.ess_litres_calc) as ess_litres_retenu,
  coalesce(c.gas_litres, c.gas_litres_calc) as gas_litres_retenu,
  (coalesce(c.ess_litres,0) + coalesce(c.gas_litres,0))
    * (select marge_unitaire from settings where id=1) as marge_estimee,
  coalesce(c.ess_litres,0) * coalesce(c.ess_pu,0)
    + coalesce(c.gas_litres,0) * coalesce(c.gas_pu,0) as ca_carburant,
  (select coalesce(sum(montant),0) from expenses e where e.report_date=c.report_date and e.station_id=c.station_id) as total_depense,
  (select coalesce(sum(montant),0) from deposits d where d.report_date=c.report_date and d.station_id=c.station_id) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons
from calc c;

create view v_latest_stock as
select s.id as station_id, s.nom, s.seuil_essence, s.seuil_gasoil,
  (select report_date from daily_reports r where r.station_id=s.id order by report_date desc limit 1) as derniere_date,
  (select ess_stock from daily_reports r where r.station_id=s.id and ess_stock is not null order by report_date desc limit 1) as ess_stock,
  (select gas_stock from daily_reports r where r.station_id=s.id and gas_stock is not null order by report_date desc limit 1) as gas_stock,
  (select total_bon_cumul from daily_reports r where r.station_id=s.id and total_bon_cumul is not null order by report_date desc limit 1) as bons_restant,
  (select gaz_stock_3 from daily_reports r where r.station_id=s.id and gaz_stock_3 is not null order by report_date desc limit 1) as gaz_stock_3,
  (select gaz_stock_6 from daily_reports r where r.station_id=s.id and gaz_stock_6 is not null order by report_date desc limit 1) as gaz_stock_6,
  (select gaz_stock_12 from daily_reports r where r.station_id=s.id and gaz_stock_12 is not null order by report_date desc limit 1) as gaz_stock_12,
  (select gaz_stock_38 from daily_reports r where r.station_id=s.id and gaz_stock_38 is not null order by report_date desc limit 1) as gaz_stock_38,
  (select lubrifiant_stock from daily_reports r where r.station_id=s.id and lubrifiant_stock is not null order by report_date desc limit 1) as lubrifiant_stock
from stations s;

create view v_stock_forecast as
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
  case when c.conso_ess_jour>0 then round(l.ess_stock / c.conso_ess_jour, 1) end as jours_essence,
  case when c.conso_gas_jour>0 then round(l.gas_stock / c.conso_gas_jour, 1) end as jours_gasoil
from v_latest_stock l left join conso c on c.station_id = l.station_id;

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
-- écart entre litres déclarés à la main et litres calculés depuis les compteurs d'ouverture
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
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_report_metrics, v_alerts, v_latest_stock, v_stock_forecast to authenticated, anon;
