-- ============================================================
--  MIGRATION v37 — Fiabiliser l'anti-coulage cuve & l'écart compteur.
--
--  Problème : quand les index compteurs du matin sont saisis de façon
--  incohérente (petit nombre un jour, totaliseur complet un autre), le
--  « litres vendus » calculé explose (ex. 966 518 L/jour) → cuve attendue
--  NÉGATIVE → fausse alerte « fuite/vol » démesurée.
--
--  Correctif (approuvé par l'utilisateur) :
--   1) v_report_metrics : on plafonne ess/gas_litres_calc — un écart d'index
--      matin ≥ 30 000 L n'est PAS crédible → ignoré (NULL), ne se propage plus.
--   2) v_alerts : ECART_STOCK « fuite/vol » n'est émis que si le résultat est
--      PLAUSIBLE (cuve attendue ≥ 0, litres ≤ 30 000, |écart| ≤ 20 000). Sinon,
--      nouvelle alerte DONNEES_INCOHERENTES « compteur/cuve à vérifier ».
--
--  À exécuter dans Supabase > SQL Editor > Run (après v36). Idempotente.
-- ============================================================

-- ── 1. v_report_metrics : plafonner le litres-compteur (garde v36 : non_cash) ──
create or replace view v_report_metrics as
with base as (
  select r.*,
    coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
      +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0) as cash_declare,
    coalesce(ess_bon,0)+coalesce(gas_bon,0) as ventes_bon,
    coalesce(e1_m,0)+coalesce(e2_m,0)+coalesce(e3_m,0)+coalesce(e4_m,0) as e_open,
    coalesce(g1_m,0)+coalesce(g2_m,0)+coalesce(g3_m,0)+coalesce(g4_m,0) as g_open
  from daily_reports r),
withlead as (
  select *,
    lead(e_open) over (partition by station_id order by report_date) as e_open_next,
    lead(g_open) over (partition by station_id order by report_date) as g_open_next,
    lead(report_date) over (partition by station_id order by report_date) as next_date
  from base),
calc as (
  select *,
    case when next_date = report_date + 1 and e_open>0 and e_open_next>=e_open and (e_open_next - e_open) < 30000 then e_open_next - e_open end as ess_litres_calc,
    case when next_date = report_date + 1 and g_open>0 and g_open_next>=g_open and (g_open_next - g_open) < 30000 then g_open_next - g_open end as gas_litres_calc
  from withlead)
select c.*,
  coalesce(c.ess_litres, c.ess_litres_calc) as ess_litres_retenu,
  coalesce(c.gas_litres, c.gas_litres_calc) as gas_litres_retenu,
  (coalesce(c.ess_litres,0) + coalesce(c.gas_litres,0))
    * (select marge_unitaire from settings where id=1) as marge_estimee,
  coalesce(c.ess_litres,0) * coalesce(c.ess_pu,0)
    + coalesce(c.gas_litres,0) * coalesce(c.gas_pu,0) as ca_carburant,
  (select coalesce(sum(montant),0) from expenses e
     where e.report_date=c.report_date and e.station_id=c.station_id and coalesce(e.non_cash,false)=false) as total_depense,
  (select coalesce(sum(montant),0) from deposits d
     where d.station_id=c.station_id and coalesce(d.periode_fin, d.deposit_date, d.report_date)=c.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons
from calc c;

grant select on v_report_metrics to authenticated, anon;

-- ── 2. v_alerts : garde-fou anti-coulage + alerte « données à vérifier » ──
create or replace view v_alerts as
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
-- d) écart compteur RÉEL (index a avancé, plafonné en amont)
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics
where ess_litres_calc is not null and ess_litres_calc > 0 and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Gasoil: compteurs '||round(gas_litres_calc)||' L vs déclaré '||round(gas_litres)||' L'
from v_report_metrics
where gas_litres_calc is not null and gas_litres_calc > 0 and gas_litres is not null and abs(gas_litres_calc - gas_litres) > 100
union all
-- d') relevé du matin du lendemain manquant/non mis à jour
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur essence du matin du '||to_char(report_date+1,'DD/MM')||' manquant ou non mis à jour (index identique à la veille) — impossible de vérifier les '||round(ess_litres)||' L déclarés le '||to_char(report_date,'DD/MM')
from v_report_metrics
where next_date = report_date + 1 and ess_litres is not null and ess_litres > 100 and coalesce(e_open_next,0) <= coalesce(e_open,0)
union all
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur gasoil du matin du '||to_char(report_date+1,'DD/MM')||' manquant ou non mis à jour (index identique à la veille) — impossible de vérifier les '||round(gas_litres)||' L déclarés le '||to_char(report_date,'DD/MM')
from v_report_metrics
where next_date = report_date + 1 and gas_litres is not null and gas_litres > 100 and coalesce(g_open_next,0) <= coalesce(g_open,0)
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
-- f) ANTI-COULAGE carburant : seulement si le résultat est PLAUSIBLE
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_ess is not null and abs(ecart_ess) > 300
  and ess_attendu >= 0 and ess_next >= 0 and coalesce(ess_litres_retenu,0) <= 30000 and abs(ecart_ess) <= 20000
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_gas is not null and abs(ecart_gas) > 300
  and gas_attendu >= 0 and gas_next >= 0 and coalesce(gas_litres_retenu,0) <= 30000 and abs(ecart_gas) <= 20000
union all
-- f') DONNÉES INCOHÉRENTES : résultat physiquement impossible → vérifier les index (pas une fuite)
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Essence: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — litres calculés '||round(coalesce(ess_litres_retenu,0))||' L, cuve attendue '||round(ess_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_ess is not null and (ess_attendu < 0 or coalesce(ess_litres_retenu,0) > 30000 or abs(ecart_ess) > 20000)
union all
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Gasoil: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — litres calculés '||round(coalesce(gas_litres_retenu,0))||' L, cuve attendue '||round(gas_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_gas is not null and (gas_attendu < 0 or coalesce(gas_litres_retenu,0) > 30000 or abs(ecart_gas) > 20000)
union all
-- g) point du jour manquant
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;
