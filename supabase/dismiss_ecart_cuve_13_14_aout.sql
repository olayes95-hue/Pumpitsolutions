-- ============================================================
--  Marque comme "traitées" les 2 fausses alertes "Écart de cuve"
--  (essence, 13-14/08/2026, Beaurivage) — causées par le bug de double
--  comptage de livraison corrigé en v53. Ces 2 jours étant déjà en
--  base AVANT v53, ils n'ont pas de relevé matin figé et resteront
--  signalés tant qu'on ne les nettoie pas manuellement.
--
--  Même mécanisme réversible que le nettoyage du 12/07 (alert_dismissals,
--  pas de suppression de données).
-- ============================================================

insert into alert_dismissals (station_id, report_date, type, dismissed_by)
select s.id, d, 'ECART_STOCK', null
from stations s
cross join (values ('2026-08-13'::date), ('2026-08-14'::date)) as t(d)
where s.nom = 'Beaurivage'
on conflict (station_id, report_date, type) do nothing;
