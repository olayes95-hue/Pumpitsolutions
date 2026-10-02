-- ============================================================
--  MIGRATION v71 — RBAC, Phase B6 : audit_log SELECT élargi.
--
--  Aujourd'hui is_admin()-only, sans aucune notion de station (pas
--  utile jusqu'ici puisque seul l'admin, qui voit tout, y accédait).
--  Le comptable a besoin de tracer qui a modifié quoi sur les données
--  financières de ses stations.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v70). Idempotente.
-- ============================================================

drop policy if exists p_audit_sel on audit_log;
create policy p_audit_sel on audit_log for select using (
  is_admin() or (has_permission('view_audit_log') and has_station_access(station_id))
);
