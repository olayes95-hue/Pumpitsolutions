-- ============================================================
--  MIGRATION v55 — Fix : les alertes traitées par l'admin
--  réapparaissaient toujours pour le gérant (et tout rôle non-admin).
--
--  Cause : alert_dismissals n'avait qu'une seule policy, admin-only,
--  appliquée à TOUTE opération (select/insert/update/delete) :
--    create policy p_dismiss_all on alert_dismissals for all
--      using (is_admin()) with check (is_admin());
--  Un gérant ne pouvait donc même pas LIRE les dismissals existants —
--  son écran d'alertes (Journal de bord, Dashboard, page Alertes)
--  ignorait complètement ce que l'admin avait déjà marqué "traité".
--
--  Fix : la LECTURE devient ouverte à tout utilisateur de la station
--  (comme les autres tables d'alertes/réconciliation) ; l'ÉCRITURE
--  (marquer/rétablir) reste réservée à l'admin, décision confirmée —
--  le bouton "Marquer traité" est aussi masqué côté UI pour les
--  autres rôles (src/pages/Alerts.jsx).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v54). Idempotente.
-- ============================================================

drop policy if exists p_dismiss_all on alert_dismissals;

create policy p_dismiss_sel on alert_dismissals for select
  using (is_admin() or station_id = public.my_station());

create policy p_dismiss_ins on alert_dismissals for insert
  with check (is_admin());

create policy p_dismiss_upd on alert_dismissals for update
  using (is_admin()) with check (is_admin());

create policy p_dismiss_del on alert_dismissals for delete
  using (is_admin());
