-- ============================================================
--  MIGRATION v68 — RBAC, Phase B3 : lecture élargie sur les tables qui
--  alimentent Tableau de bord / Historique / Alertes / Point financier
--  (directement, ou via les vues security_invoker qui les lisent).
--
--  Branche existante `station_id = my_station()` conservée telle
--  quelle sur chaque table — comportement inchangé pour gérant/
--  pompiste/vendeuse/admin. Seule une nouvelle branche OR est ajoutée,
--  vraie uniquement pour un profil qui a la permission de lecture ET
--  l'accès à cette station précise (has_station_access — my_station()
--  OU une ligne dans profile_stations).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v67). Idempotente.
-- ============================================================

drop policy if exists p_reports_sel on daily_reports;
create policy p_reports_sel on daily_reports for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_history') or has_permission('view_finance')
  ))
);

drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_history') or has_permission('view_finance')
  ))
);

drop policy if exists p_dep_sel on deposits;
create policy p_dep_sel on deposits for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_history') or has_permission('view_finance')
    or has_permission('view_bank_recon') or has_permission('view_ocr_check')
  ))
);

drop policy if exists p_deliv_sel on deliveries;
create policy p_deliv_sel on deliveries for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_history') or has_permission('view_finance')
  ))
);

drop policy if exists p_mvt_sel on stock_movements;
create policy p_mvt_sel on stock_movements for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (has_permission('view_dashboard') or has_permission('view_finance')))
);

drop policy if exists p_charges_sel on charges;
create policy p_charges_sel on charges for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (has_permission('view_dashboard') or has_permission('view_finance')))
);

drop policy if exists p_dismiss_sel on alert_dismissals;
create policy p_dismiss_sel on alert_dismissals for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (has_permission('view_dashboard') or has_permission('view_alerts')))
);

drop policy if exists p_attach_sel on attachments;
create policy p_attach_sel on attachments for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and has_permission('view_history'))
);

drop policy if exists p_ssales_sel on superette_sales;
create policy p_ssales_sel on superette_sales for select using (
  is_admin() or station_id = my_station()
  or (has_station_access(station_id) and has_permission('view_dashboard'))
);
