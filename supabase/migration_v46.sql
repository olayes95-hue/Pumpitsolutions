-- ============================================================
--  MIGRATION v46 — Nombre de machines par station configurable (jusqu'à 10).
--
--  Jusqu'ici, exactement 4 pompes essence (E1-E4) + 4 pompes gasoil
--  (G1-G4) étaient câblées en dur (colonnes fixes de daily_reports).
--  Certaines stations ont plus de 4 machines : on étend le modèle à
--  10 pompes essence + 10 gasoil (colonnes nullables, aucun impact sur
--  les stations qui n'en utilisent que 4 — les colonnes e5..e10/g5..g10
--  restent NULL pour elles) et on ajoute un réglage par station pour
--  choisir combien sont réellement affichées/obligatoires.
--
--  v_report_metrics est la SEULE vue qui lit les colonnes individuelles
--  (elle somme les relevés du matin pour calculer les litres vendus) —
--  recréée pour inclure e5_m..e10_m / g5_m..g10_m. Toutes les autres
--  vues (v_alerts, v_stock_recon, etc.) sont en aval et n'ont pas besoin
--  d'être touchées.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v45). Idempotente.
-- ============================================================

-- ── 1. Colonnes compteurs supplémentaires (E5-E10, G5-G10, relevés 16h + matin) ──
alter table daily_reports add column if not exists e5 numeric;
alter table daily_reports add column if not exists e6 numeric;
alter table daily_reports add column if not exists e7 numeric;
alter table daily_reports add column if not exists e8 numeric;
alter table daily_reports add column if not exists e9 numeric;
alter table daily_reports add column if not exists e10 numeric;
alter table daily_reports add column if not exists g5 numeric;
alter table daily_reports add column if not exists g6 numeric;
alter table daily_reports add column if not exists g7 numeric;
alter table daily_reports add column if not exists g8 numeric;
alter table daily_reports add column if not exists g9 numeric;
alter table daily_reports add column if not exists g10 numeric;
alter table daily_reports add column if not exists e5_m numeric;
alter table daily_reports add column if not exists e6_m numeric;
alter table daily_reports add column if not exists e7_m numeric;
alter table daily_reports add column if not exists e8_m numeric;
alter table daily_reports add column if not exists e9_m numeric;
alter table daily_reports add column if not exists e10_m numeric;
alter table daily_reports add column if not exists g5_m numeric;
alter table daily_reports add column if not exists g6_m numeric;
alter table daily_reports add column if not exists g7_m numeric;
alter table daily_reports add column if not exists g8_m numeric;
alter table daily_reports add column if not exists g9_m numeric;
alter table daily_reports add column if not exists g10_m numeric;

-- ── 2. Réglage par station : combien de machines sont réellement utilisées (1 à 10) ──
alter table stations add column if not exists nombre_machines integer not null default 4;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='nombre_machines_range') then
    alter table stations add constraint nombre_machines_range check (nombre_machines between 1 and 10);
  end if;
end $$;

-- ── 3. v_report_metrics : élargit e_open/g_open aux relevés matin des machines 5-10 ──
--
-- IMPORTANT : la vue en place liste ses colonnes EXPLICITEMENT (au lieu de r.*) pour
-- reproduire EXACTEMENT l'ordre des colonnes déjà exposées aujourd'hui (vérifié via
-- information_schema.columns sur la base réelle). Postgres refuse un CREATE OR REPLACE
-- VIEW qui déplacerait une colonne existante ("cannot change name of view column") —
-- avec r.*, les nouvelles colonnes e5..g10_m de daily_reports s'insèrent AVANT
-- cash_declare et cassent l'ordre. Les 24 nouvelles colonnes sont donc ajoutées à la
-- toute fin, via une jointure séparée sur l'id, plutôt que mêlées dans r.*.
create or replace view v_report_metrics as
with base as (
  select
    r.id, r.report_date, r.ess_litres, r.ess_pu, r.ess_bon, r.ess_espece,
    r.gas_litres, r.gas_pu, r.gas_bon, r.gas_espece, r.gaz_espece, r.superette_espece,
    r.lubrifiant_espece, r.e1, r.e2, r.e3, r.e4, r.g1, r.g2, r.g3, r.g4,
    r.total_bon_cumul, r.note, r.created_by, r.created_at, r.ess_stock, r.gas_stock,
    r.gaz_stock_3, r.gaz_stock_6, r.gaz_stock_12, r.gaz_stock_38,
    r.gaz_vendu_3, r.gaz_vendu_6, r.gaz_vendu_12, r.gaz_vendu_38,
    r.lubrifiant_stock, r.station_id,
    r.e1_m, r.e2_m, r.e3_m, r.e4_m, r.g1_m, r.g2_m, r.g3_m, r.g4_m,
    coalesce(r.ess_espece,0)+coalesce(r.gas_espece,0)+coalesce(r.gaz_espece,0)
      +coalesce(r.superette_espece,0)+coalesce(r.lubrifiant_espece,0) as cash_declare,
    coalesce(r.ess_bon,0)+coalesce(r.gas_bon,0) as ventes_bon,
    coalesce(r.e1_m,0)+coalesce(r.e2_m,0)+coalesce(r.e3_m,0)+coalesce(r.e4_m,0)
      +coalesce(r.e5_m,0)+coalesce(r.e6_m,0)+coalesce(r.e7_m,0)+coalesce(r.e8_m,0)+coalesce(r.e9_m,0)+coalesce(r.e10_m,0) as e_open,
    coalesce(r.g1_m,0)+coalesce(r.g2_m,0)+coalesce(r.g3_m,0)+coalesce(r.g4_m,0)
      +coalesce(r.g5_m,0)+coalesce(r.g6_m,0)+coalesce(r.g7_m,0)+coalesce(r.g8_m,0)+coalesce(r.g9_m,0)+coalesce(r.g10_m,0) as g_open
  from daily_reports r),
withlead as (
  select *,
    lead(e_open) over (partition by station_id order by report_date) as e_open_next,
    lead(g_open) over (partition by station_id order by report_date) as g_open_next,
    lead(report_date) over (partition by station_id order by report_date) as next_date
  from base),
calc as (
  select *,
    case when next_date = report_date + 1 and e_open>0 and e_open_next>=e_open and (e_open_next - e_open) < 30000 then e_open_next - e_open end as ess_litres_calc,
    case when next_date = report_date + 1 and g_open>0 and g_open_next>=g_open and (g_open_next - g_open) < 30000 then g_open_next - g_open end as gas_litres_calc
  from withlead)
select c.*,
  coalesce(c.ess_litres, c.ess_litres_calc) as ess_litres_retenu,
  coalesce(c.gas_litres, c.gas_litres_calc) as gas_litres_retenu,
  (coalesce(c.ess_litres,0) + coalesce(c.gas_litres,0))
    * (select marge_unitaire from settings where id=1) as marge_estimee,
  coalesce(c.ess_litres,0) * coalesce(c.ess_pu,0)
    + coalesce(c.gas_litres,0) * coalesce(c.gas_pu,0) as ca_carburant,
  (select coalesce(sum(montant),0) from expenses e
     where e.report_date=c.report_date and e.station_id=c.station_id and coalesce(e.non_cash,false)=false) as total_depense,
  (select coalesce(sum(montant),0) from deposits d
     where d.station_id=c.station_id and coalesce(d.periode_fin, d.deposit_date, d.report_date)=c.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons,
  -- Nouvelles colonnes (v46) : ajoutées en tout dernier, jamais mêlées à r.* plus haut.
  r2.e5, r2.e6, r2.e7, r2.e8, r2.e9, r2.e10,
  r2.g5, r2.g6, r2.g7, r2.g8, r2.g9, r2.g10,
  r2.e5_m, r2.e6_m, r2.e7_m, r2.e8_m, r2.e9_m, r2.e10_m,
  r2.g5_m, r2.g6_m, r2.g7_m, r2.g8_m, r2.g9_m, r2.g10_m
from calc c
join daily_reports r2 on r2.id = c.id;

grant select on v_report_metrics to authenticated, anon;
