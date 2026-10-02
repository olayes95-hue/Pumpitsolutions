-- ============================================================
--  MIGRATION v56 — Fix : une commande lancée avec des bons le MÊME
--  JOUR que la dernière déclaration de total_bon_cumul n'était jamais
--  déduite de "Bons en cours".
--
--  v_latest_stock.bons_restant = dernier total_bon_cumul déclaré −
--  bons dépensés sur les commandes lancées DEPUIS cette déclaration
--  (le gérant déclare chaque matin ; ce qu'il a déjà déclaré est
--  supposé net des commandes antérieures — seules celles lancées
--  depuis doivent encore être déduites).
--
--  Le bug : la condition utilisait date_lancement > dernière déclaration
--  (strictement après). Une commande lancée le MÊME JOUR que la
--  dernière déclaration (ex. déclaration du matin, commande lancée
--  l'après-midi du même jour) ne passait donc jamais ce test → jamais
--  déduite. Fix : >= au lieu de > (constaté sur Beaurivage : commande
--  #18, lancée le jour même de la dernière déclaration, 7 250 000 F
--  de bons jamais soustraits).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v55). Idempotente.
-- ============================================================

create or replace view v_latest_stock as
select s.id as station_id, s.nom, s.seuil_essence, s.seuil_gasoil,
  (select report_date from daily_reports r where r.station_id=s.id order by report_date desc limit 1) as derniere_date,
  (select ess_stock from daily_reports r where r.station_id=s.id and ess_stock is not null order by report_date desc limit 1) as ess_stock,
  (select gas_stock from daily_reports r where r.station_id=s.id and gas_stock is not null order by report_date desc limit 1) as gas_stock,
  case when (select total_bon_cumul from daily_reports r where r.station_id=s.id and total_bon_cumul is not null order by report_date desc limit 1) is null
    then null
    else
      (select total_bon_cumul from daily_reports r where r.station_id=s.id and total_bon_cumul is not null order by report_date desc limit 1)
      - coalesce((
          select sum(case
              when o.categorie = 'carburant' then coalesce(o.bons_base,0)
              when o.categorie in ('gaz','lubrifiant') and o.mode_paiement = 'bons' then coalesce(o.montant_paiement,0)
              else 0 end)
          from fuel_orders o
          where o.station_id = s.id and o.date_lancement is not null and o.statut <> 'annulee'
            and o.date_lancement >= (select report_date from daily_reports r where r.station_id=s.id and r.total_bon_cumul is not null order by report_date desc limit 1)
        ), 0)
  end as bons_restant,
  (select gaz_stock_3 from daily_reports r where r.station_id=s.id and gaz_stock_3 is not null order by report_date desc limit 1) as gaz_stock_3,
  (select gaz_stock_6 from daily_reports r where r.station_id=s.id and gaz_stock_6 is not null order by report_date desc limit 1) as gaz_stock_6,
  (select gaz_stock_12 from daily_reports r where r.station_id=s.id and gaz_stock_12 is not null order by report_date desc limit 1) as gaz_stock_12,
  (select gaz_stock_38 from daily_reports r where r.station_id=s.id and gaz_stock_38 is not null order by report_date desc limit 1) as gaz_stock_38,
  (select lubrifiant_stock from daily_reports r where r.station_id=s.id and lubrifiant_stock is not null order by report_date desc limit 1) as lubrifiant_stock,
  coalesce((
    select sum(case
        when o.categorie = 'carburant' then coalesce(o.bons_base,0)
        when o.categorie in ('gaz','lubrifiant') and o.mode_paiement = 'bons' then coalesce(o.montant_paiement,0)
        else 0 end)
    from fuel_orders o
    where o.station_id = s.id and o.date_lancement is not null and o.statut <> 'annulee'
      and o.date_lancement >= coalesce((select report_date from daily_reports r where r.station_id=s.id and r.total_bon_cumul is not null order by report_date desc limit 1), '1900-01-01'::date)
  ), 0) as bons_utilises_depuis
from stations s;

grant select on v_latest_stock to authenticated, anon;
