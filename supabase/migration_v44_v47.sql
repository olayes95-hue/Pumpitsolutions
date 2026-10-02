-- ============================================================
--  MIGRATION COMBINÉE v44 → v47 — à exécuter en une seule fois dans
--  Supabase > SQL Editor > Run. Idempotente (peut être relancée sans
--  risque si une partie a déjà été appliquée).
--
--  Contenu :
--   v44 — pompe_inactive_apres (détection pompes inactives, Journal de bord)
--   v45 — capacite_essence / capacite_gasoil (jauge cuves, Journal de bord)
--   v46 — nombre_machines configurable (jusqu'à 10) + v_report_metrics élargie
--   v47 — jours_correction_gerant configurable (fenêtre de correction du gérant)
-- ============================================================


-- ============================================================
--  v44 — Détection des pompes inactives (Journal de bord).
--  Une pompe (E1-E4 essence, G1-G4 gasoil) est considérée « inactive »
--  si son relevé 16h n'a pas bougé sur les N dernières saisies
--  journalières où elle a été renseignée (N configurable, par défaut 5).
-- ============================================================

alter table settings add column if not exists pompe_inactive_apres integer not null default 5;


-- ============================================================
--  v45 — Capacité des cuves (état des cuves, Journal de bord).
--  Capacité par station (essence/gasoil), 20 000 L par défaut pour les
--  deux, modifiable par station dans Stations & équipe.
-- ============================================================

alter table stations add column if not exists capacite_essence numeric not null default 20000;
alter table stations add column if not exists capacite_gasoil numeric not null default 20000;


-- ============================================================
--  v46 — Nombre de machines par station configurable (jusqu'à 10).
--  Étend le modèle de 4 pompes essence + 4 gasoil (colonnes fixes) à
--  10 + 10 (colonnes nullables, aucun impact sur les stations qui n'en
--  utilisent que 4). v_report_metrics est la SEULE vue qui lit les
--  colonnes individuelles — recréée pour inclure e5_m..e10_m/g5_m..g10_m.
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
-- IMPORTANT : liste de colonnes EXPLICITE (au lieu de r.*) pour reproduire EXACTEMENT
-- l'ordre des colonnes déjà exposées par la vue en production (vérifié via
-- information_schema.columns). Postgres refuse un CREATE OR REPLACE VIEW qui
-- déplacerait une colonne existante ("cannot change name of view column") — avec r.*,
-- les nouvelles colonnes e5..g10_m de daily_reports s'insèrent AVANT cash_declare et
-- cassent l'ordre. Les 24 nouvelles colonnes sont donc ajoutées à la toute fin, via une
-- jointure séparée sur l'id, plutôt que mêlées dans r.*.
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


-- ============================================================
--  v47 — Fenêtre de correction des saisies par le gérant, configurable
--  par l'admin (remplace les seuils fixes 2j/7j codés en dur par la
--  migration v11 « anti-fraude »). Un seul nombre pour insert ET update
--  (upsert() valide toujours la policy INSERT même sur une ligne
--  existante, via ON CONFLICT — un seuil insert plus étroit que le seuil
--  update ferait échouer une correction pourtant autorisée).
-- ============================================================

alter table settings add column if not exists jours_correction_gerant integer not null default 2;

create or replace function public.jours_correction_gerant()
returns integer language sql stable security definer set search_path=public as $$
  select coalesce((select jours_correction_gerant from settings where id = 1), 2);
$$;

drop policy if exists p_reports_upd on daily_reports;
create policy p_reports_upd on daily_reports for update
  using (is_admin() or (station_id = public.my_station() and report_date >= current_date - public.jours_correction_gerant()));

drop policy if exists p_reports_ins on daily_reports;
create policy p_reports_ins on daily_reports for insert
  with check (is_admin() or (station_id = public.my_station() and report_date >= current_date - public.jours_correction_gerant()));
