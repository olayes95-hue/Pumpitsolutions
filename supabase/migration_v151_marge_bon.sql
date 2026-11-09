-- ============================================================
--  MIGRATION v151 — Marge réelle sur les ventes à bon, réglable PAR
--  STATION (comme les seuils/capacités) : la commission carburant
--  supposait jusqu'ici UNE SEULE marge (settings.marge_unitaire)
--  appliquée à tous les litres vendus, bon et espèces confondus. En
--  réalité, sur les litres vendus à bon, une partie de la marge repart
--  à la maison mère — la station ne garde qu'un montant réduit par
--  litre (ex. 17 F/L au lieu de 25 F/L en espèces).
--
--  stations.marge_bon NULL (par défaut) = non réglée pour cette
--  station → se comporte EXACTEMENT comme avant (fallback sur
--  settings.marge_unitaire, aucun changement silencieux de résultat
--  tant que l'admin n'a pas renseigné cette marge pour la station).
--
--  Litres vendus à bon dérivés du montant déclaré (ess_bon/gas_bon,
--  en F) divisé par le prix du litre (ess_pu/gas_pu) — pas une nouvelle
--  saisie. Litres espèces = litres déclarés (ess_litres+gas_litres,
--  déjà la référence utilisée partout ailleurs) moins litres bon.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v150).
-- ============================================================

begin;

alter table public.stations add column if not exists marge_bon numeric;

-- v_ventes_mensuelles (dernière version en prod, migration_v150) : commission_carburant
-- recalculée en deux tranches (bon à marge_bon, espèces à marge_unitaire) au lieu d'un
-- unique litres_carburant × marge_unitaire. litres_carburant/ca_carburant restent inchangés
-- (bruts, pas de notion de marge) — seule commission_carburant change de formule.
drop view if exists public.v_ventes_mensuelles;
create view public.v_ventes_mensuelles as
with dr as (
  select d.station_id, to_char(d.report_date, 'YYYY-MM') as mois,
    sum(coalesce(d.ess_litres,0) + coalesce(d.gas_litres,0)) as litres_carburant,
    sum(coalesce(d.ess_litres,0)*coalesce(d.ess_pu,0) + coalesce(d.gas_litres,0)*coalesce(d.gas_pu,0)) as ca_carburant,
    sum(
      -- litres vendus à bon (dérivés du montant bon ÷ prix du litre), à la marge réduite
      -- de la station (ou marge_unitaire si la station n'a pas réglé marge_bon)
      (case when coalesce(d.ess_pu,0) > 0 then coalesce(d.ess_bon,0) / d.ess_pu else 0 end
        + case when coalesce(d.gas_pu,0) > 0 then coalesce(d.gas_bon,0) / d.gas_pu else 0 end)
      * coalesce(st.marge_bon, (select s.marge_unitaire from settings s where s.organisation_id = current_org_id()))
      +
      -- reste des litres déclarés (= litres espèces), à la marge pleine
      greatest(
        (coalesce(d.ess_litres,0) + coalesce(d.gas_litres,0))
        - (case when coalesce(d.ess_pu,0) > 0 then coalesce(d.ess_bon,0) / d.ess_pu else 0 end
           + case when coalesce(d.gas_pu,0) > 0 then coalesce(d.gas_bon,0) / d.gas_pu else 0 end),
        0)
      * (select s.marge_unitaire from settings s where s.organisation_id = current_org_id())
    ) as commission_carburant,
    sum(coalesce(d.gaz_espece,0)) as ventes_gaz,
    sum(coalesce(d.gaz_promo_espece,0)) as ventes_gaz_promo,
    sum(coalesce(d.superette_espece,0)) as ventes_superette,
    sum(coalesce(d.lubrifiant_espece,0)) as ventes_lubrifiant,
    sum(coalesce(d.ess_espece,0) + coalesce(d.gas_espece,0) + coalesce(d.gaz_espece,0) + coalesce(d.gaz_promo_espece,0) + coalesce(d.superette_espece,0) + coalesce(d.lubrifiant_espece,0)) as recettes_especes,
    sum(coalesce(d.mobile_money,0)) as recettes_mobile_money,
    sum(coalesce(d.ess_bon,0) + coalesce(d.gas_bon,0)) as ventes_bon,
    count(*) as jours
  from daily_reports d
  left join stations st on st.id = d.station_id
  group by d.station_id, to_char(d.report_date, 'YYYY-MM')
), dep as (
  select station_id, to_char(coalesce(periode_fin, deposit_date, report_date), 'YYYY-MM') as mois,
    sum(montant) as total_verse
  from deposits
  group by station_id, to_char(coalesce(periode_fin, deposit_date, report_date), 'YYYY-MM')
), exp as (
  select station_id, to_char(report_date, 'YYYY-MM') as mois, sum(montant) as total_depense
  from expenses where coalesce(non_cash, false) = false
  group by station_id, to_char(report_date, 'YYYY-MM')
), del as (
  select station_id, to_char(report_date, 'YYYY-MM') as mois, sum(montant) as total_livraisons
  from deliveries
  group by station_id, to_char(report_date, 'YYYY-MM')
)
select dr.station_id, dr.mois, dr.litres_carburant, dr.ca_carburant, dr.commission_carburant,
  dr.ventes_gaz, dr.ventes_gaz_promo, dr.ventes_superette, dr.ventes_lubrifiant, dr.recettes_especes, dr.recettes_mobile_money,
  dr.ventes_bon, coalesce(dep.total_verse,0) as total_verse, coalesce(exp.total_depense,0) as total_depense,
  coalesce(del.total_livraisons,0) as total_livraisons, dr.jours
from dr
left join dep on dep.station_id = dr.station_id and dep.mois = dr.mois
left join exp on exp.station_id = dr.station_id and exp.mois = dr.mois
left join del on del.station_id = dr.station_id and del.mois = dr.mois;

alter view public.v_ventes_mensuelles set (security_invoker = on);
grant select on public.v_ventes_mensuelles to authenticated, anon;

commit;
