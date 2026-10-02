-- ============================================================
--  Nettoie en masse les alertes "Écart de cuve (fuite/vol ?)" et
--  "Données incohérentes" antérieures au déploiement du fix v53
--  (relevé matin figé, en ligne depuis le 15/08/2026).
--
--  Ces jours n'ont pas de ess_stock_matin/gas_stock_matin (le fix ne
--  s'applique que pour l'avenir) — le calcul y reste vulnérable au
--  double comptage de livraison déjà diagnostiqué sur le 13-14/08 :
--  écarts qui alternent +/- d'un relevé à l'autre, pas des vols réels.
--
--  Réversible (alert_dismissals), ne supprime aucune donnée source.
-- ============================================================

insert into alert_dismissals (station_id, report_date, type, dismissed_by)
select v.station_id, v.report_date, v.type, null
from v_alerts v
join stations s on s.id = v.station_id
where s.nom = 'Beaurivage'
  and v.type in ('ECART_STOCK', 'DONNEES_INCOHERENTES')
  and v.report_date < '2026-08-15'
on conflict (station_id, report_date, type) do nothing;
