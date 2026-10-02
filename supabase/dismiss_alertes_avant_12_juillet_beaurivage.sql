-- ============================================================
--  Marque comme "traitées" toutes les alertes de Beaurivage
--  antérieures au 12 juillet 2026.
--
--  v_alerts est une vue calculée (pas une table) : on ne peut pas faire
--  DELETE FROM dessus. L'équivalent pratique et RÉVERSIBLE est d'insérer
--  ces alertes dans alert_dismissals (la même table que le bouton
--  "Marquer traité" utilise) — elles disparaissent de la liste active
--  sans supprimer aucune donnée source.
--
--  Pour annuler : DELETE FROM alert_dismissals WHERE dismissed_at > '...'
--  (ou cibler par station_id/report_date/type).
-- ============================================================

insert into alert_dismissals (station_id, report_date, type, dismissed_by)
select v.station_id, v.report_date, v.type, null
from v_alerts v
join stations s on s.id = v.station_id
where s.nom = 'Beaurivage'
  and v.report_date < '2026-07-12'
on conflict (station_id, report_date, type) do nothing;
