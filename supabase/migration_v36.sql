-- ============================================================
--  MIGRATION v36 — « Carburant / déplacement » du propriétaire = charge
--  NON-CASH (aucun paiement en espèces).
--
--  Le propriétaire prélève de l'essence pour son déplacement : c'est une
--  CHARGE mensuelle (déjà remontée au Point financier sous « Carburant /
--  déplacement (auto) »), mais AUCUN cash ne sort de la caisse. Or elle était
--  comptée comme une dépense espèce → elle réduisait à tort le « cash à verser »
--  et faussait la réconciliation des versements.
--
--  Correctif : colonne expenses.non_cash ; les dépenses non-cash sont
--  EXCLUES des sommes de dépenses ESPÈCES (v_report_metrics.total_depense,
--  v_recette_groupe_jour carburant, v_ventes_mensuelles.total_depense), mais
--  restent visibles comme charge dans le Point financier (inchangé).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v35). Idempotente.
-- ============================================================

alter table expenses add column if not exists non_cash boolean not null default false;

-- Reprise : les dépenses catégorie CARBURANT = prélèvement carburant du proprio (non-cash).
update expenses set non_cash = true where upper(coalesce(categorie,'')) = 'CARBURANT' and non_cash = false;

-- ── v_report_metrics : total_depense = dépenses ESPÈCES uniquement ───
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
  (select coalesce(sum(montant),0) from expenses e
     where e.report_date=c.report_date and e.station_id=c.station_id and coalesce(e.non_cash,false)=false) as total_depense,
  (select coalesce(sum(montant),0) from deposits d
     where d.station_id=c.station_id and coalesce(d.periode_fin, d.deposit_date, d.report_date)=c.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons
from calc c;

grant select on v_report_metrics to authenticated, anon;

-- ── v_recette_groupe_jour : dépense carburant = ESPÈCES uniquement ──
create or replace view v_recette_groupe_jour as
select d.station_id, d.report_date, 'carburant'::text as pole_groupe,
       coalesce(d.ess_espece,0)+coalesce(d.gas_espece,0) as espece,
       coalesce((select sum(e.montant) from expenses e
         where e.station_id=d.station_id and e.report_date=d.report_date and coalesce(e.non_cash,false)=false),0) as depense
from daily_reports d
union all
select station_id, report_date, 'gaz_lub',
       coalesce(gaz_espece,0)+coalesce(lubrifiant_espece,0), 0 from daily_reports
union all
select station_id, report_date, 'superette',
       coalesce(superette_espece,0), 0 from daily_reports;

grant select on v_recette_groupe_jour to authenticated, anon;

-- ── v_ventes_mensuelles : total_depense mensuel = ESPÈCES uniquement ─
create or replace view v_ventes_mensuelles as
with dr as (
  select station_id, to_char(report_date,'YYYY-MM') as mois,
    sum(coalesce(ess_litres,0)+coalesce(gas_litres,0)) as litres_carburant,
    sum(coalesce(ess_litres,0)*coalesce(ess_pu,0)+coalesce(gas_litres,0)*coalesce(gas_pu,0)) as ca_carburant,
    sum((coalesce(ess_litres,0)+coalesce(gas_litres,0)) * (select marge_unitaire from settings where id=1)) as commission_carburant,
    sum(coalesce(gaz_espece,0)) as ventes_gaz,
    sum(coalesce(superette_espece,0)) as ventes_superette,
    sum(coalesce(lubrifiant_espece,0)) as ventes_lubrifiant,
    sum(coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
        +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0)) as recettes_especes,
    sum(coalesce(ess_bon,0)+coalesce(gas_bon,0)) as ventes_bon,
    count(*) as jours
  from daily_reports group by station_id, to_char(report_date,'YYYY-MM')
),
dep as (
  select station_id, to_char(coalesce(periode_fin, deposit_date, report_date),'YYYY-MM') as mois,
    sum(montant) as total_verse
  from deposits group by 1,2
),
exp as (
  select station_id, to_char(report_date,'YYYY-MM') as mois, sum(montant) as total_depense
  from expenses where coalesce(non_cash,false)=false group by 1,2
),
del as (
  select station_id, to_char(report_date,'YYYY-MM') as mois, sum(montant) as total_livraisons
  from deliveries group by 1,2
)
select dr.station_id, dr.mois, dr.litres_carburant, dr.ca_carburant, dr.commission_carburant,
  dr.ventes_gaz, dr.ventes_superette, dr.ventes_lubrifiant, dr.recettes_especes, dr.ventes_bon,
  coalesce(dep.total_verse,0)     as total_verse,
  coalesce(exp.total_depense,0)   as total_depense,
  coalesce(del.total_livraisons,0) as total_livraisons,
  dr.jours
from dr
left join dep on dep.station_id=dr.station_id and dep.mois=dr.mois
left join exp on exp.station_id=dr.station_id and exp.mois=dr.mois
left join del on del.station_id=dr.station_id and del.mois=dr.mois;

grant select on v_ventes_mensuelles to authenticated, anon;
