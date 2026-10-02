-- Nettoie les 2 alertes gasoil du 16-17/08 (Beaurivage) : livraison #13 (300→2296 L,
-- 16/08 14h03) dont la réception a précédé le relevé du matin de ce jour-là, faisant
-- capturer le niveau post-livraison comme "matin" et compter la livraison deux fois.

insert into alert_dismissals (station_id, report_date, type, dismissed_by)
select s.id, d, 'ECART_STOCK', null
from stations s
cross join (values ('2026-08-16'::date), ('2026-08-17'::date)) as t(d)
where s.nom = 'Beaurivage'
on conflict (station_id, report_date, type) do nothing;
