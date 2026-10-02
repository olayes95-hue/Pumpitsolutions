-- ============================================================
--  MIGRATION v47 — Fenêtre de correction des saisies par le gérant,
--  configurable par l'admin (remplace les seuils fixes 2j/7j codés
--  en dur par la migration v11 « anti-fraude »).
--
--  jours_correction_gerant : nombre de jours en arrière pendant
--  lesquels un non-admin (gérant/pompiste/vendeuse) peut créer OU
--  corriger un point journalier (daily_reports). Au-delà, seul
--  l'admin peut intervenir. Un seul nombre pour les deux policies
--  (insert ET update) : avec upsert(), Postgres valide TOUJOURS la
--  policy INSERT même quand la ligne existe déjà et sera mise à jour
--  via ON CONFLICT — un seuil insert plus étroit que le seuil update
--  ferait donc échouer la correction d'une ligne pourtant autorisée.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v46). Idempotente.
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
