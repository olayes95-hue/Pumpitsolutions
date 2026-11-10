-- ============================================================
--  MIGRATION v159 — ca_carburant : bons + espèces déclarés, pas litres × prix.
--
--  Bug trouvé (v156/Submit.jsx déjà corrigé) : ess_pu/gas_pu étaient
--  enregistrés vides depuis fin août sur une partie des saisies, donc
--  ca_carburant (= litres × prix unitaire) ressortait à 0 pour ces
--  mois-là alors que les ventes étaient réelles.
--
--  Rattrapage demandé par l'utilisateur : plutôt que de deviner un
--  historique de prix (aucun suivi d'audit sur settings.essence_pv/
--  gasoil_pv pour dater un éventuel changement — risque de se tromper),
--  ca_carburant devient directement la somme des bons + espèces déclarés
--  (ess_bon+ess_espece+gas_bon+gas_espece) — exactement ce que le gérant
--  a déclaré avoir vendu, sans dépendre de ess_pu/gas_pu du tout. Plus
--  fidèle de toute façon : c'est de l'argent réellement déclaré, pas une
--  estimation théorique (litres × prix) qui peut diverger (arrondis,
--  changement de prix en cours de mois...).
--
--  commission_carburant (marge) n'est pas touchée : déjà basée sur
--  litres × marge_unitaire, indépendante de ess_pu/gas_pu.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v158).
-- ============================================================

begin;

create or replace view public.v_ventes_mensuelles as
with dr as (
  select d.station_id,
    to_char(d.report_date::timestamptz, 'YYYY-MM') as mois,
    sum(coalesce(d.ess_litres,0) + coalesce(d.gas_litres,0)) as litres_carburant,
    sum(coalesce(d.ess_bon,0) + coalesce(d.ess_espece,0) + coalesce(d.gas_bon,0) + coalesce(d.gas_espece,0)) as ca_carburant,
    sum(
      (case when coalesce(d.ess_pu,0) > 0 then coalesce(d.ess_bon,0) / d.ess_pu else 0 end
       + case when coalesce(d.gas_pu,0) > 0 then coalesce(d.gas_bon,0) / d.gas_pu else 0 end)
        * coalesce(st.marge_bon, (select s.marge_unitaire from settings s where s.organisation_id = current_org_id()))
      + greatest(coalesce(d.ess_litres,0) + coalesce(d.gas_litres,0)
          - (case when coalesce(d.ess_pu,0) > 0 then coalesce(d.ess_bon,0) / d.ess_pu else 0 end
             + case when coalesce(d.gas_pu,0) > 0 then coalesce(d.gas_bon,0) / d.gas_pu else 0 end), 0)
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
  group by d.station_id, to_char(d.report_date::timestamptz, 'YYYY-MM')
), dep as (
  select deposits.station_id,
    to_char(coalesce(deposits.periode_fin, deposits.deposit_date, deposits.report_date)::timestamptz, 'YYYY-MM') as mois,
    sum(deposits.montant) as total_verse
  from deposits
  group by deposits.station_id, to_char(coalesce(deposits.periode_fin, deposits.deposit_date, deposits.report_date)::timestamptz, 'YYYY-MM')
), exp as (
  select expenses.station_id,
    to_char(expenses.report_date::timestamptz, 'YYYY-MM') as mois,
    sum(expenses.montant) as total_depense
  from expenses
  where coalesce(expenses.non_cash, false) = false
  group by expenses.station_id, to_char(expenses.report_date::timestamptz, 'YYYY-MM')
), del as (
  select deliveries.station_id,
    to_char(deliveries.report_date::timestamptz, 'YYYY-MM') as mois,
    sum(deliveries.montant) as total_livraisons
  from deliveries
  group by deliveries.station_id, to_char(deliveries.report_date::timestamptz, 'YYYY-MM')
)
select dr.station_id, dr.mois, dr.litres_carburant, dr.ca_carburant, dr.commission_carburant,
  dr.ventes_gaz, dr.ventes_gaz_promo, dr.ventes_superette, dr.ventes_lubrifiant,
  dr.recettes_especes, dr.recettes_mobile_money, dr.ventes_bon,
  coalesce(dep.total_verse,0) as total_verse,
  coalesce(exp.total_depense,0) as total_depense,
  coalesce(del.total_livraisons,0) as total_livraisons,
  dr.jours
from dr
left join dep on dep.station_id = dr.station_id and dep.mois = dr.mois
left join exp on exp.station_id = dr.station_id and exp.mois = dr.mois
left join del on del.station_id = dr.station_id and del.mois = dr.mois;

alter view public.v_ventes_mensuelles set (security_invoker = on);

commit;
