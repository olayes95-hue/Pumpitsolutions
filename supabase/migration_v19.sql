-- ============================================================
--  MIGRATION v19 — Alerte "bons inexpliqués".
--  Si l'encours de bons baisse sans commande (bons) ni loyer
--  (payé en bons) couvrant le manque -> alerte.
--  À exécuter dans Supabase > SQL Editor > Run (après v18).
-- ============================================================

-- Baisses de l'encours de bons, avec les justifications (commandes + loyer)
create or replace view v_bons_baisses as
with c as (
  select station_id, report_date, total_bon_cumul,
    lag(total_bon_cumul) over (partition by station_id order by report_date) as prev_cumul,
    lag(report_date)     over (partition by station_id order by report_date) as prev_date
  from daily_reports where total_bon_cumul is not null
)
select c.station_id, c.report_date, c.prev_cumul, c.total_bon_cumul,
  (c.prev_cumul - c.total_bon_cumul) as baisse,
  coalesce((select sum(o.bons_base) from fuel_orders o
     where o.station_id = c.station_id and o.bons_base is not null
       and o.report_date between c.prev_date - 3 and c.report_date + 3), 0) as commandes_bons,
  coalesce((select sum(ch.montant) from charges ch
     where ch.station_id = c.station_id and ch.categorie = 'LOYER'
       and ch.mois = to_char(c.report_date, 'YYYY-MM')), 0) as loyer_mois
from c
where c.prev_cumul is not null and c.total_bon_cumul < c.prev_cumul;

grant select on v_bons_baisses to authenticated, anon;

-- Hausses de l'encours : elles doivent correspondre aux ventes à bon du jour
create or replace view v_bons_hausses as
with c as (
  select r.station_id, r.report_date, r.total_bon_cumul,
    coalesce(r.ess_bon,0)+coalesce(r.gas_bon,0) as ventes_bon,
    lag(r.total_bon_cumul) over (partition by r.station_id order by r.report_date) as prev_cumul
  from daily_reports r where r.total_bon_cumul is not null
)
select station_id, report_date, prev_cumul, total_bon_cumul, ventes_bon,
  (total_bon_cumul - prev_cumul) as hausse
from c
where prev_cumul is not null and total_bon_cumul > prev_cumul;

grant select on v_bons_hausses to authenticated, anon;

-- Recréer v_alerts avec la branche BONS_INEXPLIQUES
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
select station_id, report_date, 'PERTE_LIVRAISON','haute',
  produit||' : livré '||round(livre)||' L / commandé '||round(quantite_commandee)||' L → perte non acceptable '||round(perte_na_litres)||' L ('||round(perte_na_montant)||' F)'
from v_pertes_livraison where perte_na_litres > 0
union all
-- NOUVEAU : baisse de bons non justifiée (ni commande ni loyer)
select station_id, report_date, 'BONS_INEXPLIQUES','haute',
  'Encours bons : −'||round(baisse)||' F. Justifié (commandes '||round(commandes_bons)||' + loyer '||round(loyer_mois)||') → manque '||round(baisse - commandes_bons - loyer_mois)||' F sans commande ni loyer'
from v_bons_baisses where (baisse - commandes_bons - loyer_mois) > 100000
union all
-- NOUVEAU : hausse de bons > ventes à bon (bons fictifs ?)
select station_id, report_date, 'BONS_INEXPLIQUES','haute',
  'Encours bons : +'||round(hausse)||' F mais ventes à bon '||round(ventes_bon)||' F → hausse inexpliquée de '||round(hausse - ventes_bon)||' F'
from v_bons_hausses where (hausse - ventes_bon) > 100000
union all
select s.id as station_id, dd::date as report_date, 'POINT_MANQUANT','moyenne', 'Aucun point saisi ce jour-là'
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') dd
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = dd::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < dd::date);

grant select on v_alerts to authenticated, anon;
