-- ============================================================
--  MIGRATION v160 — ca_carburant : litres × prix quand le prix est connu,
--  bons + espèces SEULEMENT en repli quand il manque.
--
--  Correction de v159 : l'utilisateur précise que litres × prix de vente
--  reste le bon calcul (plus précis — reflète le prix réellement en
--  vigueur ce jour-là) et doit rester utilisé partout où ess_pu/gas_pu
--  est connu (août et avant, et tout nouveau jour désormais que
--  Submit.jsx est corrigé). Le repli bons+espèces ne doit s'appliquer
--  QUE là où le prix manque réellement (la fenêtre touchée par le bug,
--  essentiellement septembre à novembre) — pas en remplacement général.
--
--  Repli au niveau de chaque carburant séparément (essence/gasoil
--  peuvent ne pas être touchés le même jour).
--
--  Touche v_ventes_mensuelles (v159) ET v_report_metrics (Historique,
--  jamais corrigée jusqu'ici — même bug, vue différente). commission_
--  carburant n'est pas concerné (déjà indépendant de ess_pu/gas_pu).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v159).
-- ============================================================

begin;

create or replace view public.v_ventes_mensuelles as
with dr as (
  select d.station_id,
    to_char(d.report_date::timestamptz, 'YYYY-MM') as mois,
    sum(coalesce(d.ess_litres,0) + coalesce(d.gas_litres,0)) as litres_carburant,
    sum(
      case when coalesce(d.ess_pu,0) > 0 then coalesce(d.ess_litres,0) * d.ess_pu else coalesce(d.ess_bon,0) + coalesce(d.ess_espece,0) end
      + case when coalesce(d.gas_pu,0) > 0 then coalesce(d.gas_litres,0) * d.gas_pu else coalesce(d.gas_bon,0) + coalesce(d.gas_espece,0) end
    ) as ca_carburant,
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

-- v_report_metrics : seule la ligne ca_carburant change (repli conditionnel au lieu de
-- litres × prix pur), tout le reste de la vue (CTE base/withlead/calc) est identique.
create or replace view public.v_report_metrics as
with base as (
  select r.id, r.report_date, r.ess_litres, r.ess_pu, r.ess_bon, r.ess_espece,
    r.gas_litres, r.gas_pu, r.gas_bon, r.gas_espece, r.gaz_espece, r.superette_espece, r.lubrifiant_espece,
    r.e1, r.e2, r.e3, r.e4, r.g1, r.g2, r.g3, r.g4, r.total_bon_cumul, r.note, r.created_by, r.created_at,
    r.ess_stock, r.gas_stock, r.gaz_stock_3, r.gaz_stock_6, r.gaz_stock_12, r.gaz_stock_38,
    r.gaz_vendu_3, r.gaz_vendu_6, r.gaz_vendu_12, r.gaz_vendu_38, r.lubrifiant_stock, r.station_id,
    r.e1_m, r.e2_m, r.e3_m, r.e4_m, r.g1_m, r.g2_m, r.g3_m, r.g4_m,
    coalesce(r.ess_espece,0) + coalesce(r.gas_espece,0) + coalesce(r.gaz_espece,0) + coalesce(r.superette_espece,0) + coalesce(r.lubrifiant_espece,0) as cash_declare,
    coalesce(r.ess_bon,0) + coalesce(r.gas_bon,0) as ventes_bon,
    coalesce(r.e1_m,0)+coalesce(r.e2_m,0)+coalesce(r.e3_m,0)+coalesce(r.e4_m,0)+coalesce(r.e5_m,0)+coalesce(r.e6_m,0)+coalesce(r.e7_m,0)+coalesce(r.e8_m,0)+coalesce(r.e9_m,0)+coalesce(r.e10_m,0) as e_open,
    coalesce(r.g1_m,0)+coalesce(r.g2_m,0)+coalesce(r.g3_m,0)+coalesce(r.g4_m,0)+coalesce(r.g5_m,0)+coalesce(r.g6_m,0)+coalesce(r.g7_m,0)+coalesce(r.g8_m,0)+coalesce(r.g9_m,0)+coalesce(r.g10_m,0) as g_open
  from daily_reports r
), withlead as (
  select base.*,
    lead(base.e_open) over (partition by base.station_id order by base.report_date) as e_open_next,
    lead(base.g_open) over (partition by base.station_id order by base.report_date) as g_open_next,
    lead(base.report_date) over (partition by base.station_id order by base.report_date) as next_date
  from base
), calc as (
  select withlead.*,
    case when withlead.next_date = withlead.report_date + 1 and withlead.e_open > 0 and withlead.e_open_next >= withlead.e_open and (withlead.e_open_next - withlead.e_open) < 30000
      then withlead.e_open_next - withlead.e_open else null end as ess_litres_calc,
    case when withlead.next_date = withlead.report_date + 1 and withlead.g_open > 0 and withlead.g_open_next >= withlead.g_open and (withlead.g_open_next - withlead.g_open) < 30000
      then withlead.g_open_next - withlead.g_open else null end as gas_litres_calc
  from withlead
)
select c.id, c.report_date, c.ess_litres, c.ess_pu, c.ess_bon, c.ess_espece,
  c.gas_litres, c.gas_pu, c.gas_bon, c.gas_espece, c.gaz_espece, c.superette_espece, c.lubrifiant_espece,
  c.e1, c.e2, c.e3, c.e4, c.g1, c.g2, c.g3, c.g4, c.total_bon_cumul, c.note, c.created_by, c.created_at,
  c.ess_stock, c.gas_stock, c.gaz_stock_3, c.gaz_stock_6, c.gaz_stock_12, c.gaz_stock_38,
  c.gaz_vendu_3, c.gaz_vendu_6, c.gaz_vendu_12, c.gaz_vendu_38, c.lubrifiant_stock, c.station_id,
  c.e1_m, c.e2_m, c.e3_m, c.e4_m, c.g1_m, c.g2_m, c.g3_m, c.g4_m,
  c.cash_declare, c.ventes_bon, c.e_open, c.g_open, c.e_open_next, c.g_open_next, c.next_date,
  c.ess_litres_calc, c.gas_litres_calc,
  coalesce(c.ess_litres, c.ess_litres_calc) as ess_litres_retenu,
  coalesce(c.gas_litres, c.gas_litres_calc) as gas_litres_retenu,
  (coalesce(c.ess_litres,0) + coalesce(c.gas_litres,0)) * (select settings.marge_unitaire from settings where settings.organisation_id = current_org_id()) as marge_estimee,
  (case when coalesce(c.ess_pu,0) > 0 then coalesce(c.ess_litres,0) * c.ess_pu else coalesce(c.ess_bon,0) + coalesce(c.ess_espece,0) end
   + case when coalesce(c.gas_pu,0) > 0 then coalesce(c.gas_litres,0) * c.gas_pu else coalesce(c.gas_bon,0) + coalesce(c.gas_espece,0) end) as ca_carburant,
  (select coalesce(sum(e.montant),0) from expenses e where e.report_date = c.report_date and e.station_id = c.station_id and coalesce(e.non_cash,false) = false) as total_depense,
  (select coalesce(sum(d.montant),0) from deposits d where d.station_id = c.station_id and coalesce(d.periode_fin, d.deposit_date, d.report_date) = c.report_date) as total_verse,
  (select coalesce(sum(l.montant),0) from deliveries l where l.report_date = c.report_date and l.station_id = c.station_id) as total_livraisons,
  r2.e5, r2.e6, r2.e7, r2.e8, r2.e9, r2.e10, r2.g5, r2.g6, r2.g7, r2.g8, r2.g9, r2.g10,
  r2.e5_m, r2.e6_m, r2.e7_m, r2.e8_m, r2.e9_m, r2.e10_m, r2.g5_m, r2.g6_m, r2.g7_m, r2.g8_m, r2.g9_m, r2.g10_m,
  r2.ess_stock_matin, r2.gas_stock_matin
from calc c
join daily_reports r2 on r2.id = c.id;

alter view public.v_report_metrics set (security_invoker = on);

commit;
