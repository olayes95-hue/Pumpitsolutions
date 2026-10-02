-- ==========================================================
--  MIGRATION CONSOLIDÉE v27 → v30 — À EXÉCUTER EN UNE FOIS.
--  Idempotente et rejouable (tous les drop/if exists sont sûrs).
--  Ouvre CE fichier (pas une ancienne copie) et Run dans Supabase.
-- ==========================================================

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


-- ============================================================
--  MIGRATION v28 — Réceptions PARTIELLES d'une commande.
--  Une commande peut être reçue en plusieurs fois. À chaque réception, le gérant
--  saisit les LITRES effectivement reçus. La commande passe :
--    lancee → partielle (tant que reste > marge) → recue (quand cumul ≈ commandé).
--  Marge acceptable = settings.taux_perte_acceptable (%).
--  À exécuter dans Supabase > SQL Editor > Run (après v27).
-- ============================================================

-- 1) Table des réceptions (1 ligne par livraison partielle)
create table if not exists order_receptions (
  id bigint generated always as identity primary key,
  order_id bigint references fuel_orders(id) on delete cascade,
  station_id bigint references stations(id),
  report_date date default current_date,
  quantite_recue numeric not null,     -- litres (ou unités) reçus CETTE fois
  cuve_avant numeric, cuve_apres numeric,  -- carburant : niveau de cuve avant/après cette réception
  prix_achat numeric, montant numeric,
  photo_path text, note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_recept_order on order_receptions(order_id);

alter table order_receptions enable row level security;
drop policy if exists p_recept_sel on order_receptions;
create policy p_recept_sel on order_receptions for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_recept_ins on order_receptions;
create policy p_recept_ins on order_receptions for insert with check (auth.role()='authenticated' and (is_admin() or station_id = public.my_station()));
drop policy if exists p_recept_del on order_receptions;
create policy p_recept_del on order_receptions for delete using (is_admin());

-- 2) Cumul reçu par commande + reste + complétude (dans la marge acceptable)
create or replace view v_order_reception as
with t as (select coalesce(taux_perte_acceptable,5) as tx from settings where id=1)
select o.id as order_id, o.station_id, o.produit, o.categorie, o.quantite_commandee,
  coalesce((select sum(r.quantite_recue) from order_receptions r where r.order_id=o.id),0) as quantite_recue_total,
  greatest(o.quantite_commandee - coalesce((select sum(r.quantite_recue) from order_receptions r where r.order_id=o.id),0), 0) as reste,
  (select count(*) from order_receptions r where r.order_id=o.id) as nb_receptions,
  -- complet si le cumul atteint le commandé à la marge près
  (coalesce((select sum(r.quantite_recue) from order_receptions r where r.order_id=o.id),0)
     >= o.quantite_commandee - o.quantite_commandee * (select tx from t)/100) as complet
from fuel_orders o;

grant select on v_order_reception to authenticated, anon;


-- ============================================================
--  MIGRATION v29 — Analyse PRÉDICTIVE des commandes carburant.
--  Objectif : ne jamais tomber en rupture (rupture = ventes perdues = CA perdu).
--  On croise la consommation moyenne/jour, le stock en cuve, le DÉLAI DE LIVRAISON
--  et une marge de sécurité pour dire QUAND commander.
--  À exécuter dans Supabase > SQL Editor > Run (après v28).
-- ============================================================

-- 1) Paramètres de réappro (modifiables dans Stations & équipe)
alter table settings add column if not exists delai_livraison_jours numeric default 3;  -- délai fournisseur (j)
alter table settings add column if not exists jours_securite numeric default 2;          -- stock tampon (j)

-- 2) Vue prédictive : par produit carburant, date de commande conseillée + rupture estimée
drop view if exists v_reorder cascade;
create view v_reorder as
with p as (
  select coalesce(delai_livraison_jours,3) as lead, coalesce(jours_securite,2) as secu,
         coalesce(marge_unitaire,25) as marge from settings where id=1
)
select x.* ,
  -- litres seuil = de quoi tenir (délai + sécurité) le temps qu'une commande arrive
  round(x.conso_jour * (x.lead + x.secu)) as seuil_commande_litres,
  -- dans combien de jours faut-il PASSER la commande
  case when x.conso_jour > 0 then greatest(round(x.jours_restant - x.lead - x.secu), 0) end as jours_avant_commande,
  -- date conseillée pour commander
  case when x.conso_jour > 0
    then (current_date + greatest(round(x.jours_restant - x.lead - x.secu), 0) * interval '1 day')::date end as date_commande_conseillee,
  -- date estimée de rupture si on ne commande pas
  case when x.jours_restant is not null then (current_date + round(x.jours_restant) * interval '1 day')::date end as date_rupture_estimee,
  -- faut-il commander MAINTENANT ? (l'autonomie ne couvre plus le délai + sécurité)
  (x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant <= x.lead + x.secu) as commander_maintenant,
  -- manque à gagner estimé si on commande trop tard (jours de rupture avant l'arrivée × conso × marge)
  case when x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant < x.lead
    then round((x.lead - x.jours_restant) * x.conso_jour * (select marge from p)) else 0 end as manque_a_gagner_estime
from (
  select f.station_id, f.nom, 'essence'::text as produit,
         f.ess_stock as stock, f.conso_ess_jour as conso_jour, f.jours_essence as jours_restant,
         (select lead from p) as lead, (select secu from p) as secu
  from v_stock_forecast f
  union all
  select f.station_id, f.nom, 'gasoil',
         f.gas_stock, f.conso_gas_jour, f.jours_gasoil,
         (select lead from p), (select secu from p)
  from v_stock_forecast f
) x;

grant select on v_reorder to authenticated, anon;
-- La recommandation « commander maintenant » est affichée dans une carte dédiée
-- du tableau de bord (🔮 Prévision de commande), pas besoin de toucher v_alerts.

-- 4) ARCHIVAGE — liste des photos archivables selon la politique de rétention.
--    Rétention : preuves comptables (bordereaux, dépenses, réceptions) = 24 mois ;
--    photos de compteurs (preuve de relevé, moins critiques après vérif) = 6 mois.
--    Cette vue ne SUPPRIME rien : elle sert à l'admin (ou à un job) pour purger ensuite.
create or replace view v_attachments_archivables as
select a.id, a.station_id, a.report_date, a.categorie, a.photo_path,
  case when a.categorie = 'compteur' then interval '6 months' else interval '24 months' end as retention
from attachments a
where a.report_date < current_date - (case when a.categorie = 'compteur' then interval '6 months' else interval '24 months' end);

grant select on v_attachments_archivables to authenticated, anon;

-- Fonction de purge (à lancer manuellement ou via pg_cron par un admin) :
--   - supprime les LIGNES attachments archivables.
--   ⚠️ La suppression des FICHIERS du bucket Storage se fait séparément (API Storage /
--   Edge Function), car SQL ne supprime pas les objets de Storage. Voir ARCHIVAGE.md.
create or replace function purge_attachments_archivables() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_admin() then raise exception 'admin uniquement'; end if;
  delete from attachments a using v_attachments_archivables v where a.id = v.id;
  get diagnostics n = row_count;
  return n;
end $$;


-- ============================================================
--  MIGRATION v30 — Calcul AUTOMATIQUE du délai de livraison.
--  Délai = date de LANCEMENT de la commande → date de la 1re RÉCEPTION.
--  La prévision (v_reorder) utilise désormais le délai MOYEN RÉEL par produit
--  (calculé sur l'historique des commandes), avec repli sur le réglage manuel.
--  À exécuter dans Supabase > SQL Editor > Run (après v29).
-- ============================================================

-- 1) Délai par commande reçue (au moins partiellement)
create or replace view v_order_lead as
select o.id as order_id, o.station_id, o.produit, o.categorie,
  o.date_lancement,
  coalesce((select min(r.report_date) from order_receptions r where r.order_id=o.id), o.report_date) as date_reception,
  ( coalesce((select min(r.report_date) from order_receptions r where r.order_id=o.id), o.report_date)
    - o.date_lancement ) as delai_jours
from fuel_orders o
where o.date_lancement is not null
  and o.statut in ('recue','partielle')
  and coalesce((select min(r.report_date) from order_receptions r where r.order_id=o.id), o.report_date) is not null;

grant select on v_order_lead to authenticated, anon;

-- 2) Délai MOYEN par station + produit (carburant), sur délais cohérents (0–30 j)
create or replace view v_delai_moyen as
select station_id, produit,
  round(avg(delai_jours)::numeric, 1) as delai_moyen_jours,
  count(*) as nb_commandes,
  min(delai_jours) as delai_min, max(delai_jours) as delai_max
from v_order_lead
where categorie = 'carburant' and delai_jours between 0 and 30
group by station_id, produit;

grant select on v_delai_moyen to authenticated, anon;

-- 3) v_reorder : utilise le délai moyen CALCULÉ (repli : réglage delai_livraison_jours, sinon 3 j)
--    On DROP d'abord car les colonnes changent (ajout de lead / nb_delai) et
--    CREATE OR REPLACE VIEW interdit de réordonner/renommer les colonnes.
drop view if exists v_reorder cascade;
create view v_reorder as
with p as (
  select coalesce(delai_livraison_jours,3) as lead_def, coalesce(jours_securite,2) as secu,
         coalesce(marge_unitaire,25) as marge from settings where id=1
)
select x.*,
  round(x.conso_jour * (x.lead + x.secu)) as seuil_commande_litres,
  case when x.conso_jour > 0 then greatest(round(x.jours_restant - x.lead - x.secu), 0) end as jours_avant_commande,
  case when x.conso_jour > 0
    then (current_date + greatest(round(x.jours_restant - x.lead - x.secu), 0) * interval '1 day')::date end as date_commande_conseillee,
  case when x.jours_restant is not null then (current_date + round(x.jours_restant) * interval '1 day')::date end as date_rupture_estimee,
  (x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant <= x.lead + x.secu) as commander_maintenant,
  case when x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant < x.lead
    then round((x.lead - x.jours_restant) * x.conso_jour * (select marge from p)) else 0 end as manque_a_gagner_estime
from (
  select f.station_id, f.nom, 'essence'::text as produit,
    f.ess_stock as stock, f.conso_ess_jour as conso_jour, f.jours_essence as jours_restant,
    coalesce((select delai_moyen_jours from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='essence'),
             (select lead_def from p)) as lead,
    (select secu from p) as secu,
    coalesce((select nb_commandes from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='essence'),0) as nb_delai
  from v_stock_forecast f
  union all
  select f.station_id, f.nom, 'gasoil',
    f.gas_stock, f.conso_gas_jour, f.jours_gasoil,
    coalesce((select delai_moyen_jours from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='gasoil'),
             (select lead_def from p)),
    (select secu from p),
    coalesce((select nb_commandes from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='gasoil'),0)
  from v_stock_forecast f
) x;

grant select on v_reorder to authenticated, anon;
