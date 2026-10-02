-- ============================================================
--  MIGRATION v27
--   1) Performance : v_ventes_mensuelles réécrite en agrégation DIRECTE
--      (plus de sous-requêtes corrélées ligne par ligne → tableau de bord rapide).
--   2) Versements par PÉRIODE (début → fin) au lieu d'un seul jour, + suppression
--      du n° de bordereau côté saisie.
--   3) Réconciliation cumulative : on somme les recettes espèces du pôle sur la
--      période du versement ; si ça correspond, écart = 0 sur ces jours ;
--      sinon l'écart est porté sur le DERNIER jour de la période et une alerte est levée.
--   4) Carburant : on compare l'ESPÈCE REÇU (hors bons) au montant versé.
--  À exécuter dans Supabase > SQL Editor > Run (après v26).
-- ============================================================

-- ── 1. Colonnes période sur les versements ──────────────────
alter table deposits add column if not exists periode_debut date;
alter table deposits add column if not exists periode_fin   date;

-- reprise de l'existant : un versement mono-jour devient une période d'un jour
update deposits
set periode_debut = coalesce(periode_debut, deposit_date, report_date),
    periode_fin   = coalesce(periode_fin,   deposit_date, report_date)
where periode_fin is null or periode_debut is null;

create index if not exists idx_dep_periode on deposits(station_id, pole, periode_fin);

-- ── 2. v_report_metrics : versé rattaché au DERNIER jour de la période ───────
--     (basé sur la définition v5 ; seule la sous-requête total_verse change)
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
  (select coalesce(sum(montant),0) from deposits d
     where d.station_id=c.station_id and coalesce(d.periode_fin, d.deposit_date, d.report_date)=c.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons
from calc c;

-- ── 3. v_ventes_mensuelles : AGRÉGATION DIRECTE (rapide) ─────
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
  from expenses group by 1,2
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

-- ── Re-run safe ──────────────────────────────────────────────
-- Ces vues changent de colonnes (pole → pole_groupe) par rapport à une version
-- antérieure de v27. CREATE OR REPLACE interdit de renommer une colonne : on les
-- SUPPRIME d'abord (cascade nettoie les dépendantes et anciennes vues liées).
drop view if exists v_alerts cascade;
drop view if exists v_pole_recon_jour cascade;
drop view if exists v_carburant_recon_jour cascade;
drop view if exists v_verse_recon cascade;
drop view if exists v_verse_groupe cascade;
drop view if exists v_recette_pole_jour cascade;
drop view if exists v_recette_groupe_jour cascade;

-- ── 4. Recette espèce par jour et par GROUPE de pôle ──
--     Gaz et lubrifiant sont réconciliés ENSEMBLE (versements cumulables).
--     'depense' : uniquement pour le carburant (les dépenses sortent de sa caisse).
create or replace view v_recette_groupe_jour as
select d.station_id, d.report_date, 'carburant'::text as pole_groupe,
       coalesce(d.ess_espece,0)+coalesce(d.gas_espece,0) as espece,
       coalesce((select sum(e.montant) from expenses e
         where e.station_id=d.station_id and e.report_date=d.report_date),0) as depense
from daily_reports d
union all
select station_id, report_date, 'gaz_lub',
       coalesce(gaz_espece,0)+coalesce(lubrifiant_espece,0), 0 from daily_reports
union all
select station_id, report_date, 'superette',
       coalesce(superette_espece,0), 0 from daily_reports;

grant select on v_recette_groupe_jour to authenticated, anon;

-- ── 5. Versements regroupés par (groupe de pôle, période) ────
--     pole 'gaz','lubrifiant','gaz_lubrifiant' → même groupe 'gaz_lub'.
create or replace view v_verse_groupe as
select station_id,
  case when pole='carburant' then 'carburant'
       when pole in ('gaz','lubrifiant','gaz_lubrifiant') then 'gaz_lub'
       else 'superette' end as pole_groupe,
  periode_debut, periode_fin,
  sum(montant) as verse, count(*) as nb_bordereaux
from deposits
where periode_fin is not null
group by 1, 2, 3, 4;

grant select on v_verse_groupe to authenticated, anon;

-- ── 6. Réconciliation par période : (recette cumulée − dépenses) vs versé ─
create or replace view v_verse_recon as
select g.station_id, g.pole_groupe, g.periode_debut, g.periode_fin, g.verse, g.nb_bordereaux,
  coalesce((select sum(r.espece) from v_recette_groupe_jour r
    where r.station_id=g.station_id and r.pole_groupe=g.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin),0) as recette_periode,
  coalesce((select sum(r.depense) from v_recette_groupe_jour r
    where r.station_id=g.station_id and r.pole_groupe=g.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin),0) as depense_periode,
  ( coalesce((select sum(r.espece) from v_recette_groupe_jour r
      where r.station_id=g.station_id and r.pole_groupe=g.pole_groupe
        and r.report_date between g.periode_debut and g.periode_fin),0)
    - coalesce((select sum(r.depense) from v_recette_groupe_jour r
        where r.station_id=g.station_id and r.pole_groupe=g.pole_groupe
          and r.report_date between g.periode_debut and g.periode_fin),0)
    - g.verse ) as ecart
from v_verse_groupe g;

grant select on v_verse_recon to authenticated, anon;

-- ── 7. Réconciliation JOUR par JOUR, par groupe (pour l'Historique) ──
--     espèce reçu · versé (si une période finit ce jour) · écart porté sur la
--     dernière ligne · "couvert" = jour inclus dans une période versée.
create or replace view v_pole_recon_jour as
select r.station_id, r.report_date, r.pole_groupe,
  r.espece, r.depense,
  coalesce((select sum(vr.verse) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date),0) as verse,
  coalesce((select sum(vr.ecart) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date),0) as ecart,
  (select count(*) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date) as nb_cloture,
  exists(select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin) as couvert
from v_recette_groupe_jour r;

grant select on v_pole_recon_jour to authenticated, anon;

-- ── 8. Alertes : on remplace les alertes versement "par jour" par la logique
--      "par période", et on ajoute la non-couverture (recette non versée > 3 j).
create or replace view v_alerts as
-- a) écart de versement sur une période clôturée (carburant net de dépenses)
select station_id, periode_fin as report_date, 'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  case when pole_groupe='carburant'
    then 'carburant : (espèce '||round(recette_periode)||' − dépenses '||round(depense_periode)||') ≠ versé '||round(verse)||' → écart '||round(ecart)||' F'
    else pole_groupe||' : recette '||round(recette_periode)||' ≠ versé '||round(verse)||' → écart '||round(ecart)||' F' end as detail
from v_verse_recon where ecart > 1000  -- seulement un MANQUE ; un surplus (écart négatif) n'est pas une alerte
union all
-- b) recette d'un groupe non couverte par un versement depuis plus de 3 jours
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
-- d) écart compteur (litres déclarés vs calculés)
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics where ess_litres_calc is not null and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
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
-- f) point du jour manquant
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < d::date);

grant select on v_alerts to authenticated, anon;
