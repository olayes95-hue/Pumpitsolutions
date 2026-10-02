-- ============================================================
--  MIGRATION v75 — URGENT rollback : la lecture élargie (v73/B2/B3)
--  provoque des timeouts (Postgres 57014, statement timeout) pour un
--  compte directeur — confirmé en conditions réelles sur 3 vues
--  différentes (v_report_metrics, v_alerts, v_pole_recon_jour), pas
--  juste une suspicion. Après trois incidents de suite sur cette même
--  fonctionnalité (lenteur, puis erreur de syntaxe, puis timeout),
--  on revient intégralement à la policy simple et éprouvée
--  (is_admin() or station_id = my_station()) sur toutes les tables
--  touchées par ces vues — à réinvestiguer plus tard avec de vraies
--  preuves (EXPLAIN), hors urgence, avant de redonner au directeur/
--  comptable l'accès multi-stations à ces lectures.
--
--  Conséquence temporaire assumée : Tableau de bord, Historique,
--  Alertes ne remontent plus de données pour un compte directeur tant
--  que ce n'est pas corrigé proprement (pas d'erreur, juste vide —
--  très nettement préférable à un timeout qui casse la page). Non
--  affecté : gérant/pompiste/vendeuse/admin (comportement identique à
--  avant tout le chantier RBAC) ; commandes (validate_orders, table
--  fuel_orders, plus simple, non impliquée dans les 3 vues en cause) ;
--  écriture finance/bank_lines/audit_log/products/suppliers/stations
--  (B4-B7, tables simples, non impliquées).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v74). Idempotente.
-- ============================================================

drop policy if exists p_reports_sel on daily_reports;
create policy p_reports_sel on daily_reports for select using (
  is_admin() or station_id = public.my_station()
);

drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (
  is_admin() or station_id = public.my_station()
);

drop policy if exists p_dep_sel on deposits;
create policy p_dep_sel on deposits for select using (
  is_admin() or station_id = public.my_station()
);

drop policy if exists p_deliv_sel on deliveries;
create policy p_deliv_sel on deliveries for select using (
  is_admin() or station_id = public.my_station()
);

drop policy if exists p_mvt_sel on stock_movements;
create policy p_mvt_sel on stock_movements for select using (
  is_admin() or station_id = public.my_station()
);

drop policy if exists p_charges_sel on charges;
create policy p_charges_sel on charges for select using (
  is_admin() or station_id = public.my_station()
);

drop policy if exists p_dismiss_sel on alert_dismissals;
create policy p_dismiss_sel on alert_dismissals for select using (
  is_admin() or station_id = public.my_station()
);
