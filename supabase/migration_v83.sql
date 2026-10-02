-- Fix : alert_dismissals n'avait pas été réélargie multi-stations en même temps que
-- daily_reports/expenses/deposits/deliveries (migration_v77) — sa policy SELECT était
-- restée à la forme simple du rollback d'urgence (is_admin() OR station_id = my_station()),
-- toujours vraie pour l'admin/gérant mais toujours FAUSSE pour le directeur (station_id
-- null sur son profil, accès via profile_stations). Résultat : la requête qui liste les
-- alertes déjà traitées renvoyait vide pour un directeur, donc TOUTES les alertes
-- réapparaissaient comme actives pour lui, y compris celles déjà réglées par un gérant/admin.
-- Même motif InitPlan-friendly que v77 pour rester rapide.

drop policy if exists p_dismiss_sel on alert_dismissals;
create policy p_dismiss_sel on alert_dismissals for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_alerts'))
  )
);
