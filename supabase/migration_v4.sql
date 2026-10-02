-- ============================================================
--  MIGRATION v4 — Rapprochement bancaire + alerte "point manquant"
--  À exécuter dans Supabase > SQL Editor > Run (après v3).
-- ============================================================

-- ---------- Lignes du relevé bancaire (crédits = versements reçus par la banque) ----------
create table if not exists bank_lines (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  date_operation date not null,
  montant numeric not null,
  reference text,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now());
create index if not exists idx_bank_station_date on bank_lines(station_id, date_operation);

alter table bank_lines enable row level security;
drop policy if exists p_bank_all on bank_lines;
create policy p_bank_all on bank_lines for all using (is_admin()) with check (is_admin());

-- ---------- Alertes : on ajoute POINT_MANQUANT (14 derniers jours, stations actives) ----------
create or replace view v_alerts as
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
  'Essence: compteur '||round(e_litres_compteur)||' L vs déclaré '||round(coalesce(ess_litres,0))||' L'
from v_report_metrics where e_litres_compteur is not null and ess_litres is not null and abs(e_litres_compteur - ess_litres) > 100
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Essence: '||round(coalesce(l.ess_stock,0))||' L en stock (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.ess_stock is not null and l.ess_stock < l.seuil_essence
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Gasoil: '||round(coalesce(l.gas_stock,0))||' L en stock (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil
union all
-- POINT MANQUANT : jour sans aucun point saisi (14 derniers jours), seulement pour une station déjà active
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;
