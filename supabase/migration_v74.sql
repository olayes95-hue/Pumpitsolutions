-- ============================================================
--  MIGRATION v74 — RBAC : le directeur voit le Journal de bord (activité
--  quotidienne du gérant), en plus de Tableau de bord/Historique/Alertes/
--  Point financier déjà accordés.
--
--  Nouvelle permission dédiée (view_journal) plutôt que réutiliser
--  view_history, pour rester cohérent avec le reste du catalogue
--  (une permission par page). Aucun changement RLS nécessaire :
--  Journal.jsx ne lit que des tables/vues déjà couvertes par les
--  permissions view_dashboard/view_history/view_finance/view_alerts
--  que le directeur a déjà (submissions, v_stock_forecast,
--  v_pole_recon_jour, expenses, v_pertes_mensuelles, v_alerts,
--  alert_dismissals, fuel_orders, settings, daily_reports,
--  v_latest_stock — vérifié table par table).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v73). Idempotente.
-- ============================================================

insert into permissions (key, label, category) values
  ('view_journal', 'Journal de bord', 'Pilotage')
on conflict (key) do nothing;

insert into role_permissions (role_key, permission_key) values
  ('directeur', 'view_journal')
on conflict do nothing;
