-- ============================================================
--  MIGRATION v14 — Charges mensuelles + point financier,
--  gestion des alertes (masquer/traité), notif matin à 8h.
--  À exécuter dans Supabase > SQL Editor > Run (après v13).
-- ============================================================

-- ---------- Charges mensuelles (saisies par l'admin) ----------
create table if not exists charges (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  mois text not null,                 -- 'YYYY-MM'
  categorie text not null,            -- LOYER / SALAIRES / PRELEVEMENT_GERANT / IMPOTS / HONORAIRES /
                                      -- PRESTATIONS / SBEE / SONEB / TELEPHONE / CARBURANT_DEPLACEMENT /
                                      -- PERTE_VENTE_CARBURANT / AUTRE
  montant numeric not null,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now());
create index if not exists idx_charges on charges(station_id, mois);

alter table charges enable row level security;
drop policy if exists p_charges_sel on charges;
create policy p_charges_sel on charges for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_charges_all on charges;
create policy p_charges_all on charges for all using (is_admin()) with check (is_admin());

-- ---------- Masquer / marquer "traité" une alerte ----------
create table if not exists alert_dismissals (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  report_date date,
  type text,
  note text,
  dismissed_by uuid references profiles(id),
  dismissed_at timestamptz default now(),
  unique(station_id, report_date, type));

alter table alert_dismissals enable row level security;
drop policy if exists p_dismiss_all on alert_dismissals;
create policy p_dismiss_all on alert_dismissals for all using (is_admin()) with check (is_admin());

-- ---------- Notification du matin : 8h (Bénin = UTC+1 -> 07:00 UTC) ----------
do $$ begin perform cron.unschedule('notif-matin-9h'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('notif-matin-8h'); exception when others then null; end $$;
select cron.schedule('notif-matin-8h', '0 7 * * *', $$ select public.notify_missing('matin') $$);

-- ---------- Vue agrégée des ventes par mois et par pôle (pour le point financier) ----------
create or replace view v_ventes_mensuelles as
select station_id, to_char(report_date,'YYYY-MM') as mois,
  sum(coalesce(ess_litres,0)+coalesce(gas_litres,0)) as litres_carburant,
  sum(coalesce(ca_carburant,0)) as ca_carburant,
  sum(coalesce(marge_estimee,0)) as commission_carburant,
  sum(coalesce(gaz_espece,0)) as ventes_gaz,
  sum(coalesce(superette_espece,0)) as ventes_superette,
  sum(coalesce(lubrifiant_espece,0)) as ventes_lubrifiant,
  sum(coalesce(cash_declare,0)) as recettes_especes,
  sum(coalesce(ventes_bon,0)) as ventes_bon
from v_report_metrics
group by station_id, to_char(report_date,'YYYY-MM');

grant select on v_ventes_mensuelles to authenticated, anon;
