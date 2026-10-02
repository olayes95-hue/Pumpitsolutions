-- ============================================================
--  MIGRATION v25 — Performance (index) + agrégats mensuels enrichis
--  + date de recette obligatoire sur les versements.
--  À exécuter dans Supabase > SQL Editor > Run (après v24).
-- ============================================================

-- Index composites pour accélérer v_report_metrics / v_alerts
create index if not exists idx_exp_st_date on expenses(station_id, report_date);
create index if not exists idx_dep_st_date on deposits(station_id, report_date);
create index if not exists idx_dep_recette on deposits(station_id, deposit_date);
create index if not exists idx_del_st_date on deliveries(station_id, report_date);
create index if not exists idx_mvt_st_date on stock_movements(station_id, date_mouvement);
create index if not exists idx_dr_st_date on daily_reports(station_id, report_date);

-- v_report_metrics : le versement est rattaché au JOUR DE LA RECETTE concernée
-- (deposit_date) et non au jour de saisie. Un dépôt fait aujourd'hui pour la
-- recette d'hier réduit donc l'écart d'hier, pas celui d'aujourd'hui.
-- (Basé sur la définition v5 — seule la sous-requête total_verse change.)
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
    case when next_date = report_date + 1 and e_open>0 and e_open_next>=e_open then e_open_next - e_open end as ess_litres_calc,
    case when next_date = report_date + 1 and g_open>0 and g_open_next>=g_open then g_open_next - g_open end as gas_litres_calc
  from withlead)
select c.*,
  coalesce(c.ess_litres, c.ess_litres_calc) as ess_litres_retenu,
  coalesce(c.gas_litres, c.gas_litres_calc) as gas_litres_retenu,
  (coalesce(c.ess_litres,0) + coalesce(c.gas_litres,0))
    * (select marge_unitaire from settings where id=1) as marge_estimee,
  coalesce(c.ess_litres,0) * coalesce(c.ess_pu,0)
    + coalesce(c.gas_litres,0) * coalesce(c.gas_pu,0) as ca_carburant,
  (select coalesce(sum(montant),0) from expenses e where e.report_date=c.report_date and e.station_id=c.station_id) as total_depense,
  -- ⬇︎ rattachement au jour de la recette (deposit_date), fallback report_date pour l'historique
  (select coalesce(sum(montant),0) from deposits d
     where d.station_id=c.station_id and coalesce(d.deposit_date, d.report_date)=c.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons
from calc c;

-- v_ventes_mensuelles : on ajoute versé + dépenses (pour un tableau de bord agrégé rapide)
create or replace view v_ventes_mensuelles as
select station_id, to_char(report_date,'YYYY-MM') as mois,
  sum(coalesce(ess_litres,0)+coalesce(gas_litres,0)) as litres_carburant,
  sum(coalesce(ca_carburant,0)) as ca_carburant,
  sum(coalesce(marge_estimee,0)) as commission_carburant,
  sum(coalesce(gaz_espece,0)) as ventes_gaz,
  sum(coalesce(superette_espece,0)) as ventes_superette,
  sum(coalesce(lubrifiant_espece,0)) as ventes_lubrifiant,
  sum(coalesce(cash_declare,0)) as recettes_especes,
  sum(coalesce(ventes_bon,0)) as ventes_bon,
  sum(coalesce(total_verse,0)) as total_verse,
  sum(coalesce(total_depense,0)) as total_depense,
  sum(coalesce(total_livraisons,0)) as total_livraisons,
  count(*) as jours
from v_report_metrics
group by station_id, to_char(report_date,'YYYY-MM');

grant select on v_ventes_mensuelles to authenticated, anon;
