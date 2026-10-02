-- ============================================================
--  MIGRATION v3 — Multi-station + fournisseurs + stock/autonomie
--  Idempotente et auto-suffisante (inclut les ajouts v2).
--  À exécuter UNE FOIS dans Supabase > SQL Editor > Run.
--  Rattache toutes les données existantes à "Station 1".
-- ============================================================

-- ---------- (v2) settings, stock, gaz/lubrifiant, deliveries, submissions ----------
create table if not exists settings (
  id int primary key default 1, essence_pv numeric not null default 725,
  gasoil_pv numeric not null default 750, marge_unitaire numeric not null default 25,
  constraint one_row check (id = 1));
insert into settings (id) values (1) on conflict (id) do nothing;

alter table daily_reports add column if not exists ess_stock numeric;
alter table daily_reports add column if not exists gas_stock numeric;
alter table daily_reports add column if not exists gaz_stock_3 numeric;
alter table daily_reports add column if not exists gaz_stock_6 numeric;
alter table daily_reports add column if not exists gaz_stock_12 numeric;
alter table daily_reports add column if not exists gaz_stock_38 numeric;
alter table daily_reports add column if not exists gaz_vendu_3 numeric;
alter table daily_reports add column if not exists gaz_vendu_6 numeric;
alter table daily_reports add column if not exists gaz_vendu_12 numeric;
alter table daily_reports add column if not exists gaz_vendu_38 numeric;
alter table daily_reports add column if not exists lubrifiant_stock jsonb;

create table if not exists deliveries (
  id bigint generated always as identity primary key, report_date date not null,
  type text not null, quantite numeric, unite text, pu_achat numeric, montant numeric,
  fournisseur text, note text, created_by uuid references profiles(id), created_at timestamptz default now());
create index if not exists idx_deliveries_date on deliveries(report_date);

create table if not exists submissions (
  id bigint generated always as identity primary key, report_date date not null,
  moment text not null, created_by uuid references profiles(id), created_at timestamptz default now());
create index if not exists idx_submissions_date on submissions(report_date);

-- ---------- (v3) Stations ----------
create table if not exists stations (
  id bigint generated always as identity primary key,
  nom text not null,
  compte_bancaire text,
  seuil_essence numeric default 2000,   -- litres : seuil d'alerte stock bas
  seuil_gasoil  numeric default 2000,
  created_at timestamptz default now());
insert into stations (nom) select 'Beaurivage' where not exists (select 1 from stations);
insert into stations (nom) select 'Vedoko' where (select count(*) from stations) < 2;
-- renomme si elles avaient été créées avec les noms par défaut
update stations set nom='Beaurivage' where nom='Station 1';
update stations set nom='Vedoko'     where nom='Station 2';

-- ---------- (v3) Fournisseurs (supérette / autre ; carburant = unique, non géré ici) ----------
create table if not exists suppliers (
  id bigint generated always as identity primary key,
  nom text not null, categorie text default 'superette',  -- superette / lubrifiant / gaz / autre
  contact text, note text, created_at timestamptz default now());

-- ---------- (v3) station_id partout + backfill Station 1 ----------
do $$ declare s1 bigint; begin
  select id into s1 from stations order by id limit 1;
  -- ajoute la colonne si absente
  alter table daily_reports add column if not exists station_id bigint references stations(id);
  alter table expenses     add column if not exists station_id bigint references stations(id);
  alter table deposits     add column if not exists station_id bigint references stations(id);
  alter table deliveries   add column if not exists station_id bigint references stations(id);
  alter table submissions  add column if not exists station_id bigint references stations(id);
  alter table profiles     add column if not exists station_id bigint references stations(id);
  alter table deliveries   add column if not exists supplier_id bigint references suppliers(id);
  -- backfill vers Station 1
  update daily_reports set station_id=s1 where station_id is null;
  update expenses     set station_id=s1 where station_id is null;
  update deposits     set station_id=s1 where station_id is null;
  update deliveries   set station_id=s1 where station_id is null;
  update submissions  set station_id=s1 where station_id is null;
end $$;

-- unicité du point : (station, date) au lieu de (date)
alter table daily_reports drop constraint if exists daily_reports_report_date_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='uq_report_station') then
    alter table daily_reports add constraint uq_report_station unique (station_id, report_date);
  end if;
end $$;

-- ---------- helpers ----------
create or replace function public.my_station()
returns bigint language sql stable security definer set search_path=public as $$
  select station_id from profiles where id = auth.uid();
$$;

-- ---------- Vues ----------
-- On supprime d'abord (l'ordre des colonnes change → create or replace échouerait)
drop view if exists v_alerts;
drop view if exists v_stock_forecast;
drop view if exists v_latest_stock;
drop view if exists v_report_metrics;

create or replace view v_report_metrics as
with base as (
  select r.*,
    coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
      +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0) as cash_declare,
    coalesce(ess_bon,0)+coalesce(gas_bon,0) as ventes_bon,
    coalesce(e1,0)+coalesce(e2,0)+coalesce(e3,0)+coalesce(e4,0) as e_total,
    coalesce(g1,0)+coalesce(g2,0)+coalesce(g3,0)+coalesce(g4,0) as g_total,
    (coalesce(ess_litres,0)+coalesce(gas_litres,0))
      * (select marge_unitaire from settings where id=1) as marge_estimee
  from daily_reports r),
withprev as (
  select *,
    lag(e_total) over (partition by station_id order by report_date) as e_prev,
    lag(g_total) over (partition by station_id order by report_date) as g_prev,
    lag(report_date) over (partition by station_id order by report_date) as prev_date
  from base)
select w.*,
  (select coalesce(sum(montant),0) from expenses e where e.report_date=w.report_date and e.station_id=w.station_id) as total_depense,
  (select coalesce(sum(montant),0) from deposits d where d.report_date=w.report_date and d.station_id=w.station_id) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=w.report_date and l.station_id=w.station_id) as total_livraisons,
  case when prev_date = report_date - 1 and e_total>=e_prev then e_total-e_prev end as e_litres_compteur,
  case when prev_date = report_date - 1 and g_total>=g_prev then g_total-g_prev end as g_litres_compteur
from withprev w;

-- Dernier stock connu + bons restant, par station
create or replace view v_latest_stock as
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

-- Autonomie : conso moyenne/jour (30 derniers jours saisis) & jours restants
create or replace view v_stock_forecast as
with conso as (
  select station_id,
    avg(ess_litres) filter (where ess_litres is not null) as conso_ess_jour,
    avg(gas_litres) filter (where gas_litres is not null) as conso_gas_jour
  from (
    select station_id, report_date, ess_litres, gas_litres,
      row_number() over (partition by station_id order by report_date desc) as rn
    from daily_reports) t
  where rn <= 30
  group by station_id)
select l.station_id, l.nom, l.ess_stock, l.gas_stock, l.seuil_essence, l.seuil_gasoil,
  c.conso_ess_jour, c.conso_gas_jour,
  case when c.conso_ess_jour>0 then round(l.ess_stock / c.conso_ess_jour, 1) end as jours_essence,
  case when c.conso_gas_jour>0 then round(l.gas_stock / c.conso_gas_jour, 1) end as jours_gasoil
from v_latest_stock l left join conso c on c.station_id = l.station_id;

-- Alertes (avec station_id + alerte stock bas)
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
-- stock bas essence
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Essence: '||round(coalesce(l.ess_stock,0))||' L en stock (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.ess_stock is not null and l.ess_stock < l.seuil_essence
union all
-- stock bas gasoil
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Gasoil: '||round(coalesce(l.gas_stock,0))||' L en stock (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil;

-- ---------- RLS ----------
alter table stations enable row level security;
alter table suppliers enable row level security;
alter table settings enable row level security;
alter table deliveries enable row level security;
alter table submissions enable row level security;

drop policy if exists p_stations_sel on stations;
create policy p_stations_sel on stations for select using (auth.role()='authenticated');
drop policy if exists p_stations_upd on stations;
create policy p_stations_upd on stations for update using (is_admin());
drop policy if exists p_stations_ins on stations;
create policy p_stations_ins on stations for insert with check (is_admin());

drop policy if exists p_suppliers_all on suppliers;
create policy p_suppliers_all on suppliers for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

drop policy if exists p_settings_sel on settings;
create policy p_settings_sel on settings for select using (auth.role()='authenticated');
drop policy if exists p_settings_upd on settings;
create policy p_settings_upd on settings for update using (is_admin());

-- Scoping par station : admin voit tout, gérant voit sa station
drop policy if exists p_reports_sel on daily_reports;
create policy p_reports_sel on daily_reports for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_dep_sel on deposits;
create policy p_dep_sel on deposits for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_deliv_sel on deliveries;
create policy p_deliv_sel on deliveries for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_deliv_ins on deliveries;
create policy p_deliv_ins on deliveries for insert with check (auth.role()='authenticated');
drop policy if exists p_deliv_del on deliveries;
create policy p_deliv_del on deliveries for delete using (is_admin() or created_by=auth.uid());
drop policy if exists p_sub_sel on submissions;
create policy p_sub_sel on submissions for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_sub_ins on submissions;
create policy p_sub_ins on submissions for insert with check (auth.role()='authenticated');

grant select on v_report_metrics, v_alerts, v_latest_stock, v_stock_forecast to authenticated, anon;

-- Temps réel : le tableau de bord admin se met à jour quand le gérant enregistre un point
do $$ begin
  begin
    alter publication supabase_realtime add table daily_reports;
  exception when duplicate_object then null; when others then null;
  end;
end $$;

-- ---------- (aide) pour renommer / configurer tes stations ----------
-- update stations set nom='NOM RÉEL', compte_bancaire='06673940006', seuil_essence=2000, seuil_gasoil=2000 where id=1;
-- pour rattacher un gérant à une station :
-- update profiles set station_id=1 where id=(select id from auth.users where email='gerant@email');
