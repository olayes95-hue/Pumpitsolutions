-- ============================================================
--  MIGRATION v132 — Combine, par (station, jour) tous pôles confondus :
--  VERSEMENT_INCOMPLET + VERSEMENT_MANQUANT d'une part, essence + gasoil
--  pour STOCK_BAS d'autre part — avec le détail par pôle/carburant dans
--  un seul message au lieu d'une ligne séparée par pôle.
--
--  Avant : une ligne d'alerte PAR PÔLE/CARBURANT touché — un jour à
--  problème sur plusieurs pôles (ou les deux carburants à la fois)
--  produisait plusieurs lignes dans Alertes pour le même jour/station,
--  au lieu d'une vue d'ensemble.
--
--  Après : une seule ligne par (station, jour) pour chacun des deux
--  groupes — type unique VERSEMENT_INCOMPLET (VERSEMENT_MANQUANT fusionné
--  dedans, même famille de problème : de l'argent dû n'est pas, ou pas
--  entièrement, versé) et type unique STOCK_BAS (essence+gasoil fusionnés)
--  — detail = le détail de chaque pôle/carburant concerné, séparés par " · ".
--
--  Seules ces branches de v_alerts changent — les autres restent À
--  L'IDENTIQUE de migration_v125/v130.
-- ============================================================

create or replace view v_alerts as
select station_id, report_date, 'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  string_agg(detail, ' · ' order by ord, pole_label) as detail
from (
  select station_id, periode_fin as report_date, 1 as ord,
    case pole_groupe when 'carburant' then 'Carburant' when 'gaz_lub' then 'Gaz+Lub' when 'superette' then 'Supérette' else pole_groupe end as pole_label,
    (case pole_groupe when 'carburant' then 'Carburant' when 'gaz_lub' then 'Gaz+Lub' when 'superette' then 'Supérette' else pole_groupe end) ||
    (case when pole_groupe='carburant'
      then ' : (espèce '||round(recette_periode)||' − dépenses '||round(depense_periode)||') ≠ versé '||round(verse)||' → écart '||round(ecart)||' F'
      else ' : recette '||round(recette_periode)||' ≠ versé '||round(verse)||' → écart '||round(ecart)||' F' end) as detail
  from v_verse_recon where ecart > 1000
  union all
  select r.station_id, r.report_date, 2 as ord,
    case r.pole_groupe when 'carburant' then 'Carburant' when 'gaz_lub' then 'Gaz+Lub' when 'superette' then 'Supérette' else r.pole_groupe end as pole_label,
    (case r.pole_groupe when 'carburant' then 'Carburant' when 'gaz_lub' then 'Gaz+Lub' when 'superette' then 'Supérette' else r.pole_groupe end) ||
    ' : recette '||round(r.espece)||' F non versée (aucune période ne la couvre, > 3 j)' as detail
  from v_recette_groupe_jour r
  where r.espece > 1000 and r.report_date < current_date - 3
    and not exists (select 1 from v_verse_groupe g
      where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
        and r.report_date between g.periode_debut and g.periode_fin)
) x
group by station_id, report_date
union all
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
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
select station_id, report_date, 'STOCK_BAS', 'haute',
  string_agg(detail, ' · ' order by ord) as detail
from (
  select f.station_id, l.derniere_date as report_date, 1 as ord,
    'Essence: '||round(coalesce(l.ess_stock,0))||' L (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L' as detail
  from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
  where l.ess_stock is not null and l.ess_stock < l.seuil_essence
  union all
  select f.station_id, l.derniere_date, 2,
    'Gasoil: '||round(coalesce(l.gas_stock,0))||' L (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
  from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
  where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil
) x
group by station_id, report_date
union all
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
-- g) point du jour manquant — "renseigné" = au moins un relevé compteur réel (pas juste une
-- ligne daily_reports quelconque, qui peut être un stub créé par une réception de commande).
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (
    select 1 from daily_reports r
    where r.station_id = s.id and r.report_date = d::date
      and (r.e1_m is not null or r.g1_m is not null or r.e1 is not null or r.g1 is not null
        or r.e2_m is not null or r.g2_m is not null or r.e2 is not null or r.g2 is not null
        or r.e3_m is not null or r.g3_m is not null or r.e3 is not null or r.g3 is not null
        or r.e4_m is not null or r.g4_m is not null or r.e4 is not null or r.g4 is not null
        or r.e5_m is not null or r.g5_m is not null or r.e5 is not null or r.g5 is not null
        or r.e6_m is not null or r.g6_m is not null or r.e6 is not null or r.g6 is not null
        or r.e7_m is not null or r.g7_m is not null or r.e7 is not null or r.g7 is not null
        or r.e8_m is not null or r.g8_m is not null or r.e8 is not null or r.g8 is not null
        or r.e9_m is not null or r.g9_m is not null or r.e9 is not null or r.g9 is not null
        or r.e10_m is not null or r.g10_m is not null or r.e10 is not null or r.g10 is not null)
  )
  and exists (
    select 1 from profiles p
    where p.approved and p.role in ('gerant','pompiste','vendeuse') and p.created_at < d
      and (p.station_id = s.id or exists (
        select 1 from profile_stations ps where ps.profile_id = p.id and ps.station_id = s.id))
  );

alter view public.v_alerts set (security_invoker = on);
grant select on v_alerts to authenticated, anon;
