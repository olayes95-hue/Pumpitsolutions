-- ============================================================
--  MIGRATION v38 — Réconciliation compteur & cuve dans le BON SENS (backward).
--
--  Modèle réel (confirmé par l'utilisateur) :
--    • Les relevés (index compteur + niveau de cuve) sont les valeurs RÉELLES
--      à 8h du jour J.
--    • Les ventes déclarées du jour J couvrent la période 8h(J-1) → 8h(J).
--
--  Donc ventes(J) doivent = mouvement compteur backward = index_matin(J) −
--  index_matin(J-1) ; et cuve(J) = cuve(J-1) − ventes(J) + livraisons(J).
--
--  L'ancienne formule calculait EN AVANT (matin(J+1) − matin(J)), soit la
--  période du LENDEMAIN → décalage d'un jour → faux écarts compteur et cuves
--  attendues négatives. On repasse tout en backward.
--
--  On NE touche PAS v_report_metrics (on recalcule le mouvement dans
--  v_stock_recon). On recrée v_stock_recon (colonnes changées) + v_alerts.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v37). Idempotente.
-- ============================================================

drop view if exists v_stock_recon cascade;   -- (dépendance : v_alerts, recréé plus bas)

-- ── v_stock_recon : mouvement compteur & cuve attendue, en BACKWARD ──
create view v_stock_recon as
with b as (
  select station_id, report_date, ess_stock, gas_stock, ess_litres, gas_litres, e_open, g_open,
    lag(ess_stock)   over w as ess_prev,
    lag(gas_stock)   over w as gas_prev,
    lag(e_open)      over w as e_open_prev,
    lag(g_open)      over w as g_open_prev,
    lag(report_date) over w as prev_date
  from v_report_metrics
  window w as (partition by station_id order by report_date)
),
mv as (
  select b.*,
    -- mouvement compteur de la PÉRIODE des ventes du jour (8h veille → 8h jour)
    case when b.prev_date = b.report_date - 1 and b.e_open>0 and b.e_open_prev>0
           and b.e_open >= b.e_open_prev and (b.e_open - b.e_open_prev) < 30000
         then b.e_open - b.e_open_prev end as ess_mouvement,
    case when b.prev_date = b.report_date - 1 and b.g_open>0 and b.g_open_prev>0
           and b.g_open >= b.g_open_prev and (b.g_open - b.g_open_prev) < 30000
         then b.g_open - b.g_open_prev end as gas_mouvement,
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.report_date and o.produit='essence' and o.statut='recue') as deliv_ess,
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.report_date and o.produit='gasoil' and o.statut='recue') as deliv_gas
  from b
)
select mv.*,
  coalesce(ess_litres, ess_mouvement) as ess_retenu,
  coalesce(gas_litres, gas_mouvement) as gas_retenu,
  -- cuve attendue = cuve de la VEILLE − ventes du jour + livraisons du jour
  (ess_prev - coalesce(ess_litres, ess_mouvement, 0) + deliv_ess) as ess_attendu,
  (gas_prev - coalesce(gas_litres, gas_mouvement, 0) + deliv_gas) as gas_attendu,
  case when prev_date = report_date - 1 and ess_stock is not null and ess_prev is not null
       then ess_stock - (ess_prev - coalesce(ess_litres, ess_mouvement, 0) + deliv_ess) end as ecart_ess,
  case when prev_date = report_date - 1 and gas_stock is not null and gas_prev is not null
       then gas_stock - (gas_prev - coalesce(gas_litres, gas_mouvement, 0) + deliv_gas) end as ecart_gas
from mv;

grant select on v_stock_recon to authenticated, anon;

-- ── v_alerts : compteur & cuve pilotés par le nouveau v_stock_recon (backward) ──
create view v_alerts as
-- a) écart de versement sur une période clôturée
select station_id, periode_fin as report_date, 'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  case when pole_groupe='carburant'
    then 'carburant : (espèce '||round(recette_periode)||' − dépenses '||round(depense_periode)||') ≠ versé '||round(verse)||' → écart '||round(ecart)||' F'
    else pole_groupe||' : recette '||round(recette_periode)||' ≠ versé '||round(verse)||' → écart '||round(ecart)||' F' end as detail
from v_verse_recon where ecart > 1000
union all
-- b) recette non couverte > 3 jours
select r.station_id, r.report_date, 'VERSEMENT_MANQUANT', 'haute',
  'Recette '||r.pole_groupe||' '||round(r.espece)||' F non versée (aucune période ne la couvre, > 3 j)'
from v_recette_groupe_jour r
where r.espece > 1000 and r.report_date < current_date - 3
  and not exists (select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin)
union all
-- c) dépense non justifiée
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
-- d) écart compteur RÉEL (mouvement backward vs déclaré)
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_mouvement)||' L vs déclaré '||round(ess_litres)||' L'
from v_stock_recon
where ess_mouvement is not null and ess_litres is not null and abs(ess_mouvement - ess_litres) > 100
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Gasoil: compteurs '||round(gas_mouvement)||' L vs déclaré '||round(gas_litres)||' L'
from v_stock_recon
where gas_mouvement is not null and gas_litres is not null and abs(gas_mouvement - gas_litres) > 100
union all
-- d') relevé compteur du matin non mis à jour (index identique à la veille)
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur essence du '||to_char(report_date,'DD/MM')||' non mis à jour (index identique à la veille) — impossible de vérifier les '||round(ess_litres)||' L déclarés'
from v_stock_recon
where prev_date = report_date - 1 and ess_litres is not null and ess_litres > 100 and coalesce(e_open,0) <= coalesce(e_open_prev,0)
union all
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur gasoil du '||to_char(report_date,'DD/MM')||' non mis à jour (index identique à la veille) — impossible de vérifier les '||round(gas_litres)||' L déclarés'
from v_stock_recon
where prev_date = report_date - 1 and gas_litres is not null and gas_litres > 100 and coalesce(g_open,0) <= coalesce(g_open_prev,0)
union all
-- e) stock carburant bas
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
-- f) ANTI-COULAGE carburant (backward) : seulement si le résultat est PLAUSIBLE
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_stock)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_ess is not null and abs(ecart_ess) > 300
  and ess_attendu >= 0 and ess_stock >= 0 and coalesce(ess_retenu,0) <= 30000 and abs(ecart_ess) <= 20000
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_stock)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_gas is not null and abs(ecart_gas) > 300
  and gas_attendu >= 0 and gas_stock >= 0 and coalesce(gas_retenu,0) <= 30000 and abs(ecart_gas) <= 20000
union all
-- f') DONNÉES INCOHÉRENTES : résultat physiquement impossible → vérifier (pas une fuite)
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Essence: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — ventes '||round(coalesce(ess_retenu,0))||' L, cuve attendue '||round(ess_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_ess is not null and (ess_attendu < 0 or coalesce(ess_retenu,0) > 30000 or abs(ecart_ess) > 20000)
union all
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Gasoil: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — ventes '||round(coalesce(gas_retenu,0))||' L, cuve attendue '||round(gas_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_gas is not null and (gas_attendu < 0 or coalesce(gas_retenu,0) > 30000 or abs(ecart_gas) > 20000)
union all
-- g) point du jour manquant
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;
