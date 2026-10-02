-- ============================================================
--  MIGRATION v16 — Pertes sur livraisons carburant.
--  Perte = commandé − livré (cuve après−avant). 5% acceptable.
--  Total mensuel des pertes NON acceptables (litres + FCFA).
--  À exécuter dans Supabase > SQL Editor > Run (après v15).
-- ============================================================

alter table settings add column if not exists taux_perte_acceptable numeric default 5; -- % toléré
update settings set marge_unitaire = 25 where id = 1;                                  -- marge = 25 F/L

-- Détail des pertes par livraison réceptionnée
create or replace view v_pertes_livraison as
with t as (select taux_perte_acceptable as tx from settings where id=1)
select o.id, o.station_id, o.report_date, o.produit,
  o.quantite_commandee,
  (o.cuve_apres - o.cuve_avant) as livre,
  greatest(o.quantite_commandee - (o.cuve_apres - o.cuve_avant), 0) as perte_litres,
  round(o.quantite_commandee * (select tx from t) / 100) as seuil_acceptable,
  greatest((o.quantite_commandee - (o.cuve_apres - o.cuve_avant)) - o.quantite_commandee * (select tx from t)/100, 0) as perte_na_litres,
  coalesce(o.prix_achat,0) as prix_achat,
  round(greatest((o.quantite_commandee - (o.cuve_apres - o.cuve_avant)) - o.quantite_commandee * (select tx from t)/100, 0) * coalesce(o.prix_achat,0)) as perte_na_montant
from fuel_orders o
where o.statut='recue' and o.cuve_apres is not null and o.cuve_avant is not null and o.quantite_commandee is not null;

-- Totaux mensuels des pertes NON acceptables (base retenue salaire)
create or replace view v_pertes_mensuelles as
select station_id, to_char(report_date,'YYYY-MM') as mois,
  sum(perte_litres) as perte_litres,
  sum(perte_na_litres) as perte_na_litres,
  sum(perte_na_montant) as perte_na_montant,
  count(*) filter (where perte_na_litres > 0) as nb_livraisons_hors_seuil
from v_pertes_livraison
group by station_id, to_char(report_date,'YYYY-MM');

grant select on v_pertes_livraison, v_pertes_mensuelles to authenticated, anon;

-- Alerte : livraison avec perte non acceptable (> 5%)
drop view if exists v_alerts;
create view v_alerts as
select station_id, report_date, 'VERSEMENT_MANQUANT'::text as type, 'haute'::text as gravite,
  'Cash à verser '||round((cash_declare-total_depense))||' F, aucun versement' as detail
from v_report_metrics where (cash_declare-total_depense) > 1000 and total_verse = 0
union all
select station_id, report_date, 'VERSEMENT_INCOMPLET','haute',
  'Versé '||round(total_verse)||' F < à verser '||round(cash_declare-total_depense)||' F'
from v_report_metrics where total_verse > 0 and total_verse < (cash_declare-total_depense) - 1000
union all
select station_id, report_date, 'ECART_CAISSE','moyenne', 'Écart '||round(cash_declare-total_depense-total_verse)||' F'
from v_report_metrics where abs(cash_declare-total_depense-total_verse) > 1000 and total_verse > 0
union all
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics where ess_litres_calc is not null and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Essence: '||round(coalesce(l.ess_stock,0))||' L (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.ess_stock is not null and l.ess_stock < l.seuil_essence
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Gasoil: '||round(coalesce(l.gas_stock,0))||' L (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil
union all
select l.station_id, l.derniere_date, 'STOCK_BAS_GAZ','moyenne',
  'Gaz bas : '||concat_ws(', ',
    case when l.gaz_stock_3  < s.seuil_gaz then '3kg='||round(l.gaz_stock_3) end,
    case when l.gaz_stock_6  < s.seuil_gaz then '6kg='||round(l.gaz_stock_6) end,
    case when l.gaz_stock_12 < s.seuil_gaz then '12kg='||round(l.gaz_stock_12) end,
    case when l.gaz_stock_38 < s.seuil_gaz then '38kg='||round(l.gaz_stock_38) end)
from v_latest_stock l join stations s on s.id=l.station_id
where l.gaz_stock_3 < s.seuil_gaz or l.gaz_stock_6 < s.seuil_gaz or l.gaz_stock_12 < s.seuil_gaz or l.gaz_stock_38 < s.seuil_gaz
union all
select l.station_id, l.derniere_date, 'STOCK_BAS_LUBRIFIANT','moyenne',
  'Lubrifiant bas : '||string_agg(kv.key||'='||kv.value, ', ')
from v_latest_stock l join stations s on s.id=l.station_id, lateral jsonb_each_text(l.lubrifiant_stock) kv
where l.lubrifiant_stock is not null and kv.value ~ '^[0-9]+$' and kv.value::numeric < s.seuil_lubrifiant
group by l.station_id, l.derniere_date
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon where ecart_ess is not null and abs(ecart_ess) > 300
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon where ecart_gas is not null and abs(ecart_gas) > 300
union all
-- NOUVEAU : perte non acceptable sur livraison (> 5%)
select station_id, report_date, 'PERTE_LIVRAISON','haute',
  produit||' : livré '||round(livre)||' L / commandé '||round(quantite_commandee)||' L → perte non acceptable '||round(perte_na_litres)||' L ('||round(perte_na_montant)||' F)'
from v_pertes_livraison where perte_na_litres > 0
union all
select s.id as station_id, dd::date as report_date, 'POINT_MANQUANT','moyenne', 'Aucun point saisi ce jour-là'
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') dd
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = dd::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < dd::date);

grant select on v_alerts to authenticated, anon;
