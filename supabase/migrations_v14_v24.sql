-- MIGRATIONS REGROUPÉES v14 → v24 — Supabase > SQL Editor > Run. Idempotent.
-- Pré-requis : schema + v2..v13 déjà appliquées.

-- ############### migration_v14.sql ###############

-- ============================================================
--  MIGRATION v14 — Charges mensuelles + point financier,
--  gestion des alertes (masquer/traité), notif matin à 8h.
--  À exécuter dans Supabase > SQL Editor > Run (après v13).
-- ============================================================

-- ---------- Charges mensuelles (saisies par l'admin) ----------
create table if not exists charges (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  mois text not null,                 -- 'YYYY-MM'
  categorie text not null,            -- LOYER / SALAIRES / PRELEVEMENT_GERANT / IMPOTS / HONORAIRES /
                                      -- PRESTATIONS / SBEE / SONEB / TELEPHONE / CARBURANT_DEPLACEMENT /
                                      -- PERTE_VENTE_CARBURANT / AUTRE
  montant numeric not null,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now());
create index if not exists idx_charges on charges(station_id, mois);

alter table charges enable row level security;
drop policy if exists p_charges_sel on charges;
create policy p_charges_sel on charges for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_charges_all on charges;
create policy p_charges_all on charges for all using (is_admin()) with check (is_admin());

-- ---------- Masquer / marquer "traité" une alerte ----------
create table if not exists alert_dismissals (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  report_date date,
  type text,
  note text,
  dismissed_by uuid references profiles(id),
  dismissed_at timestamptz default now(),
  unique(station_id, report_date, type));

alter table alert_dismissals enable row level security;
drop policy if exists p_dismiss_all on alert_dismissals;
create policy p_dismiss_all on alert_dismissals for all using (is_admin()) with check (is_admin());

-- ---------- Notification du matin : 8h (Bénin = UTC+1 -> 07:00 UTC) ----------
do $$ begin perform cron.unschedule('notif-matin-9h'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('notif-matin-8h'); exception when others then null; end $$;
select cron.schedule('notif-matin-8h', '0 7 * * *', $$ select public.notify_missing('matin') $$);

-- ---------- Vue agrégée des ventes par mois et par pôle (pour le point financier) ----------
create or replace view v_ventes_mensuelles as
select station_id, to_char(report_date,'YYYY-MM') as mois,
  sum(coalesce(ess_litres,0)+coalesce(gas_litres,0)) as litres_carburant,
  sum(coalesce(ca_carburant,0)) as ca_carburant,
  sum(coalesce(marge_estimee,0)) as commission_carburant,
  sum(coalesce(gaz_espece,0)) as ventes_gaz,
  sum(coalesce(superette_espece,0)) as ventes_superette,
  sum(coalesce(lubrifiant_espece,0)) as ventes_lubrifiant,
  sum(coalesce(cash_declare,0)) as recettes_especes,
  sum(coalesce(ventes_bon,0)) as ventes_bon
from v_report_metrics
group by station_id, to_char(report_date,'YYYY-MM');

grant select on v_ventes_mensuelles to authenticated, anon;

-- ############### migration_v15.sql ###############

-- ============================================================
--  MIGRATION v15 — Commissions automatiques sur tous les pôles
--  (taux de commission gaz/lubrifiant et supérette paramétrables).
--  À exécuter dans Supabase > SQL Editor > Run (après v14).
-- ============================================================

alter table settings add column if not exists taux_gaz numeric default 8;        -- % commission gaz+lubrifiant
alter table settings add column if not exists taux_superette numeric default 8;  -- % commission supérette

-- ############### migration_v16.sql ###############

-- ============================================================
--  MIGRATION v16 — Pertes sur livraisons carburant.
--  Perte = commandé − livré (cuve après−avant). 5% acceptable.
--  Total mensuel des pertes NON acceptables (litres + FCFA).
--  À exécuter dans Supabase > SQL Editor > Run (après v15).
-- ============================================================

alter table settings add column if not exists taux_perte_acceptable numeric default 5; -- % toléré
update settings set marge_unitaire = 25 where id = 1;                                  -- marge = 25 F/L

-- Détail des pertes par livraison réceptionnée
create or replace view v_pertes_livraison as
with t as (select taux_perte_acceptable as tx from settings where id=1)
select o.id, o.station_id, o.report_date, o.produit,
  o.quantite_commandee,
  (o.cuve_apres - o.cuve_avant) as livre,
  greatest(o.quantite_commandee - (o.cuve_apres - o.cuve_avant), 0) as perte_litres,
  round(o.quantite_commandee * (select tx from t) / 100) as seuil_acceptable,
  greatest((o.quantite_commandee - (o.cuve_apres - o.cuve_avant)) - o.quantite_commandee * (select tx from t)/100, 0) as perte_na_litres,
  coalesce(o.prix_achat,0) as prix_achat,
  round(greatest((o.quantite_commandee - (o.cuve_apres - o.cuve_avant)) - o.quantite_commandee * (select tx from t)/100, 0) * coalesce(o.prix_achat,0)) as perte_na_montant
from fuel_orders o
where o.statut='recue' and o.cuve_apres is not null and o.cuve_avant is not null and o.quantite_commandee is not null;

-- Totaux mensuels des pertes NON acceptables (base retenue salaire)
create or replace view v_pertes_mensuelles as
select station_id, to_char(report_date,'YYYY-MM') as mois,
  sum(perte_litres) as perte_litres,
  sum(perte_na_litres) as perte_na_litres,
  sum(perte_na_montant) as perte_na_montant,
  count(*) filter (where perte_na_litres > 0) as nb_livraisons_hors_seuil
from v_pertes_livraison
group by station_id, to_char(report_date,'YYYY-MM');

grant select on v_pertes_livraison, v_pertes_mensuelles to authenticated, anon;

-- Alerte : livraison avec perte non acceptable (> 5%)
drop view if exists v_alerts;
create view v_alerts as
select station_id, report_date, 'VERSEMENT_MANQUANT'::text as type, 'haute'::text as gravite,
  'Cash à verser '||round((cash_declare-total_depense))||' F, aucun versement' as detail
from v_report_metrics where (cash_declare-total_depense) > 1000 and total_verse = 0
union all
select station_id, report_date, 'VERSEMENT_INCOMPLET','haute',
  'Versé '||round(total_verse)||' F < à verser '||round(cash_declare-total_depense)||' F'
from v_report_metrics where total_verse > 0 and total_verse < (cash_declare-total_depense) - 1000
union all
select station_id, report_date, 'ECART_CAISSE','moyenne', 'Écart '||round(cash_declare-total_depense-total_verse)||' F'
from v_report_metrics where abs(cash_declare-total_depense-total_verse) > 1000 and total_verse > 0
union all
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics where ess_litres_calc is not null and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
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
select l.station_id, l.derniere_date, 'STOCK_BAS_GAZ','moyenne',
  'Gaz bas : '||concat_ws(', ',
    case when l.gaz_stock_3  < s.seuil_gaz then '3kg='||round(l.gaz_stock_3) end,
    case when l.gaz_stock_6  < s.seuil_gaz then '6kg='||round(l.gaz_stock_6) end,
    case when l.gaz_stock_12 < s.seuil_gaz then '12kg='||round(l.gaz_stock_12) end,
    case when l.gaz_stock_38 < s.seuil_gaz then '38kg='||round(l.gaz_stock_38) end)
from v_latest_stock l join stations s on s.id=l.station_id
where l.gaz_stock_3 < s.seuil_gaz or l.gaz_stock_6 < s.seuil_gaz or l.gaz_stock_12 < s.seuil_gaz or l.gaz_stock_38 < s.seuil_gaz
union all
select l.station_id, l.derniere_date, 'STOCK_BAS_LUBRIFIANT','moyenne',
  'Lubrifiant bas : '||string_agg(kv.key||'='||kv.value, ', ')
from v_latest_stock l join stations s on s.id=l.station_id, lateral jsonb_each_text(l.lubrifiant_stock) kv
where l.lubrifiant_stock is not null and kv.value ~ '^[0-9]+$' and kv.value::numeric < s.seuil_lubrifiant
group by l.station_id, l.derniere_date
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon where ecart_ess is not null and abs(ecart_ess) > 300
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon where ecart_gas is not null and abs(ecart_gas) > 300
union all
-- NOUVEAU : perte non acceptable sur livraison (> 5%)
select station_id, report_date, 'PERTE_LIVRAISON','haute',
  produit||' : livré '||round(livre)||' L / commandé '||round(quantite_commandee)||' L → perte non acceptable '||round(perte_na_litres)||' L ('||round(perte_na_montant)||' F)'
from v_pertes_livraison where perte_na_litres > 0
union all
select s.id as station_id, dd::date as report_date, 'POINT_MANQUANT','moyenne', 'Aucun point saisi ce jour-là'
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') dd
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = dd::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < dd::date);

grant select on v_alerts to authenticated, anon;

-- ############### migration_v17.sql ###############

-- ============================================================
--  MIGRATION v17 — Photo justificatif obligatoire sur les dépenses.
--  À exécuter dans Supabase > SQL Editor > Run (après v16).
-- ============================================================

alter table expenses add column if not exists photo_path text;  -- justificatif (photo)

-- ############### migration_v18.sql ###############

-- ============================================================
--  MIGRATION v18 — Références lubrifiant gérables par l'admin.
--  À exécuter dans Supabase > SQL Editor > Run (après v17).
-- ============================================================

create table if not exists lubrifiant_types (
  id bigint generated always as identity primary key,
  nom text not null unique,
  actif boolean default true,
  ordre int default 100,
  created_at timestamptz default now());

alter table lubrifiant_types enable row level security;
drop policy if exists p_lub_sel on lubrifiant_types;
create policy p_lub_sel on lubrifiant_types for select using (auth.role()='authenticated');
drop policy if exists p_lub_all on lubrifiant_types;
create policy p_lub_all on lubrifiant_types for all using (is_admin()) with check (is_admin());
grant select on lubrifiant_types to authenticated, anon;

-- références existantes + 20W50 (1L)
insert into lubrifiant_types (nom, ordre) values
 ('5W30 1L',10),('5W30 5L',20),('20W50 1L',25),('20W50 5L',30),('15W40 5L',40),
 ('80W90 1L',50),('50 SAE 5L',60),('Dexron 1L',70),('Dot4 1L',80),('10W40 5L',90),
 ('5W40 5L',100),('Graisse',110),('Liquide refroid.',120),('Nettoyant injecteur',130),('Nettoyant essence',140)
on conflict (nom) do nothing;

-- ############### migration_v19.sql ###############

-- ============================================================
--  MIGRATION v19 — Alerte "bons inexpliqués".
--  Si l'encours de bons baisse sans commande (bons) ni loyer
--  (payé en bons) couvrant le manque -> alerte.
--  À exécuter dans Supabase > SQL Editor > Run (après v18).
-- ============================================================

-- Baisses de l'encours de bons, avec les justifications (commandes + loyer)
create or replace view v_bons_baisses as
with c as (
  select station_id, report_date, total_bon_cumul,
    lag(total_bon_cumul) over (partition by station_id order by report_date) as prev_cumul,
    lag(report_date)     over (partition by station_id order by report_date) as prev_date
  from daily_reports where total_bon_cumul is not null
)
select c.station_id, c.report_date, c.prev_cumul, c.total_bon_cumul,
  (c.prev_cumul - c.total_bon_cumul) as baisse,
  coalesce((select sum(o.bons_base) from fuel_orders o
     where o.station_id = c.station_id and o.bons_base is not null
       and o.report_date between c.prev_date - 3 and c.report_date + 3), 0) as commandes_bons,
  coalesce((select sum(ch.montant) from charges ch
     where ch.station_id = c.station_id and ch.categorie = 'LOYER'
       and ch.mois = to_char(c.report_date, 'YYYY-MM')), 0) as loyer_mois
from c
where c.prev_cumul is not null and c.total_bon_cumul < c.prev_cumul;

grant select on v_bons_baisses to authenticated, anon;

-- Hausses de l'encours : elles doivent correspondre aux ventes à bon du jour
create or replace view v_bons_hausses as
with c as (
  select r.station_id, r.report_date, r.total_bon_cumul,
    coalesce(r.ess_bon,0)+coalesce(r.gas_bon,0) as ventes_bon,
    lag(r.total_bon_cumul) over (partition by r.station_id order by r.report_date) as prev_cumul
  from daily_reports r where r.total_bon_cumul is not null
)
select station_id, report_date, prev_cumul, total_bon_cumul, ventes_bon,
  (total_bon_cumul - prev_cumul) as hausse
from c
where prev_cumul is not null and total_bon_cumul > prev_cumul;

grant select on v_bons_hausses to authenticated, anon;

-- Recréer v_alerts avec la branche BONS_INEXPLIQUES
drop view if exists v_alerts;
create view v_alerts as
select station_id, report_date, 'VERSEMENT_MANQUANT'::text as type, 'haute'::text as gravite,
  'Cash à verser '||round((cash_declare-total_depense))||' F, aucun versement' as detail
from v_report_metrics where (cash_declare-total_depense) > 1000 and total_verse = 0
union all
select station_id, report_date, 'VERSEMENT_INCOMPLET','haute',
  'Versé '||round(total_verse)||' F < à verser '||round(cash_declare-total_depense)||' F'
from v_report_metrics where total_verse > 0 and total_verse < (cash_declare-total_depense) - 1000
union all
select station_id, report_date, 'ECART_CAISSE','moyenne', 'Écart '||round(cash_declare-total_depense-total_verse)||' F'
from v_report_metrics where abs(cash_declare-total_depense-total_verse) > 1000 and total_verse > 0
union all
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics where ess_litres_calc is not null and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
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
select l.station_id, l.derniere_date, 'STOCK_BAS_GAZ','moyenne',
  'Gaz bas : '||concat_ws(', ',
    case when l.gaz_stock_3  < s.seuil_gaz then '3kg='||round(l.gaz_stock_3) end,
    case when l.gaz_stock_6  < s.seuil_gaz then '6kg='||round(l.gaz_stock_6) end,
    case when l.gaz_stock_12 < s.seuil_gaz then '12kg='||round(l.gaz_stock_12) end,
    case when l.gaz_stock_38 < s.seuil_gaz then '38kg='||round(l.gaz_stock_38) end)
from v_latest_stock l join stations s on s.id=l.station_id
where l.gaz_stock_3 < s.seuil_gaz or l.gaz_stock_6 < s.seuil_gaz or l.gaz_stock_12 < s.seuil_gaz or l.gaz_stock_38 < s.seuil_gaz
union all
select l.station_id, l.derniere_date, 'STOCK_BAS_LUBRIFIANT','moyenne',
  'Lubrifiant bas : '||string_agg(kv.key||'='||kv.value, ', ')
from v_latest_stock l join stations s on s.id=l.station_id, lateral jsonb_each_text(l.lubrifiant_stock) kv
where l.lubrifiant_stock is not null and kv.value ~ '^[0-9]+$' and kv.value::numeric < s.seuil_lubrifiant
group by l.station_id, l.derniere_date
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon where ecart_ess is not null and abs(ecart_ess) > 300
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon where ecart_gas is not null and abs(ecart_gas) > 300
union all
select station_id, report_date, 'PERTE_LIVRAISON','haute',
  produit||' : livré '||round(livre)||' L / commandé '||round(quantite_commandee)||' L → perte non acceptable '||round(perte_na_litres)||' L ('||round(perte_na_montant)||' F)'
from v_pertes_livraison where perte_na_litres > 0
union all
-- NOUVEAU : baisse de bons non justifiée (ni commande ni loyer)
select station_id, report_date, 'BONS_INEXPLIQUES','haute',
  'Encours bons : −'||round(baisse)||' F. Justifié (commandes '||round(commandes_bons)||' + loyer '||round(loyer_mois)||') → manque '||round(baisse - commandes_bons - loyer_mois)||' F sans commande ni loyer'
from v_bons_baisses where (baisse - commandes_bons - loyer_mois) > 100000
union all
-- NOUVEAU : hausse de bons > ventes à bon (bons fictifs ?)
select station_id, report_date, 'BONS_INEXPLIQUES','haute',
  'Encours bons : +'||round(hausse)||' F mais ventes à bon '||round(ventes_bon)||' F → hausse inexpliquée de '||round(hausse - ventes_bon)||' F'
from v_bons_hausses where (hausse - ventes_bon) > 100000
union all
select s.id as station_id, dd::date as report_date, 'POINT_MANQUANT','moyenne', 'Aucun point saisi ce jour-là'
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') dd
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = dd::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < dd::date);

grant select on v_alerts to authenticated, anon;

-- ############### migration_v20.sql ###############

-- ============================================================
--  MIGRATION v20 — Commandes : complément chèque + dates saisissables.
--  À exécuter dans Supabase > SQL Editor > Run (après v19).
-- ============================================================

alter table fuel_orders add column if not exists cheque_montant numeric;   -- complément payé par chèque
alter table fuel_orders add column if not exists cheque_ref text;          -- n° / réf du chèque
alter table fuel_orders add column if not exists date_proposition date;    -- date de la proposition
alter table fuel_orders add column if not exists date_lancement date;      -- date de lancement
-- (la date de réception reste report_date)

-- ############### migration_v21.sql ###############

-- ============================================================
--  MIGRATION v21 — Catalogue produits (gaz, lubrifiant, supérette)
--  avec prix d'achat / prix de vente / seuil paramétrables.
--  (Le carburant garde ses prix dans settings.)
--  À exécuter dans Supabase > SQL Editor > Run (après v20).
-- ============================================================

create table if not exists products (
  id bigint generated always as identity primary key,
  categorie text not null,            -- gaz / lubrifiant / superette / autre
  nom text not null,
  unite text default 'unité',         -- bouteille / bidon / carton / unité / valeur
  prix_achat numeric,
  prix_vente numeric,
  seuil numeric default 0,            -- seuil d'alerte stock bas
  actif boolean default true,
  ordre int default 100,
  created_at timestamptz default now(),
  unique(categorie, nom));

alter table products enable row level security;
drop policy if exists p_products_sel on products;
create policy p_products_sel on products for select using (auth.role()='authenticated');
drop policy if exists p_products_all on products;
create policy p_products_all on products for all using (is_admin()) with check (is_admin());
grant select on products to authenticated, anon;

-- Gaz par type
insert into products (categorie, nom, unite, ordre) values
 ('gaz','3 kg','bouteille',10),('gaz','6 kg','bouteille',20),
 ('gaz','12 kg','bouteille',30),('gaz','38 kg','bouteille',40)
on conflict (categorie, nom) do nothing;

-- Lubrifiants : repris des références existantes
insert into products (categorie, nom, unite, ordre, actif)
select 'lubrifiant', nom, 'bidon', ordre, actif from lubrifiant_types
on conflict (categorie, nom) do nothing;

-- ############### migration_v22.sql ###############

-- ============================================================
--  MIGRATION v22 — Commandes multi-produits (gaz, lubrifiant, supérette)
--  + mode de paiement (bons / chèque / espèces) + lignes supérette.
--  À exécuter dans Supabase > SQL Editor > Run (après v21).
-- ============================================================

alter table fuel_orders add column if not exists categorie text default 'carburant'; -- carburant/gaz/lubrifiant/superette
alter table fuel_orders add column if not exists mode_paiement text;                  -- bons / cheque / especes
alter table fuel_orders add column if not exists montant_paiement numeric;            -- montant chèque/espèces (hors carburant)
alter table fuel_orders add column if not exists lignes jsonb;                        -- supérette : [{"article":"Eau 1,5L","qte":10}]

update fuel_orders set categorie = 'carburant' where categorie is null;

-- ############### migration_v23.sql ###############

-- ============================================================
--  MIGRATION v23 — Journal de mouvements de stock + supérette en valeur
--  + valorisation du stock.
--  À exécuter dans Supabase > SQL Editor > Run (après v22).
-- ============================================================

alter table settings add column if not exists superette_stock_initial numeric default 0; -- valeur de départ supérette

create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  categorie text not null,            -- gaz / lubrifiant / superette / carburant
  produit text,                       -- nom du produit (null pour supérette globale)
  type text not null,                 -- entree / sortie / ajustement
  quantite numeric,                   -- gaz/lubrifiant (unités)
  valeur numeric,                     -- supérette (FCFA)
  source text,                        -- reception / vente / achat / perte / inventaire
  ref text, note text,
  date_mouvement date default current_date,
  created_by uuid references profiles(id),
  created_at timestamptz default now());
create index if not exists idx_mvt on stock_movements(station_id, categorie, produit);

alter table stock_movements enable row level security;
drop policy if exists p_mvt_sel on stock_movements;
create policy p_mvt_sel on stock_movements for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_mvt_ins on stock_movements;
create policy p_mvt_ins on stock_movements for insert with check (auth.role()='authenticated' and (is_admin() or station_id = public.my_station()));
drop policy if exists p_mvt_del on stock_movements;
create policy p_mvt_del on stock_movements for delete using (is_admin());

-- Stock quantité par produit (gaz / lubrifiant)
create or replace view v_stock_produits as
select station_id, categorie, produit,
  sum(case when type='sortie' then -coalesce(quantite,0) else coalesce(quantite,0) end) as stock
from stock_movements
where categorie in ('gaz','lubrifiant') and quantite is not null
group by station_id, categorie, produit;

-- Valorisation du stock (par catégorie et station)
create or replace view v_stock_valeur as
-- gaz + lubrifiant : quantité × prix d'achat du catalogue
select sp.station_id, sp.categorie, sum(sp.stock * coalesce(pr.prix_achat,0)) as valeur
from v_stock_produits sp
left join products pr on pr.categorie=sp.categorie and pr.nom=sp.produit
group by sp.station_id, sp.categorie
union all
-- supérette : valeur initiale + entrées − sorties (en valeur)
select s.id as station_id, 'superette' as categorie,
  (select coalesce(superette_stock_initial,0) from settings where id=1)
   + coalesce((select sum(case when type='sortie' then -coalesce(valeur,0) else coalesce(valeur,0) end)
       from stock_movements m where m.station_id=s.id and m.categorie='superette'),0) as valeur
from stations s;

grant select on v_stock_produits, v_stock_valeur to authenticated, anon;

-- ############### migration_v24.sql ###############

-- ============================================================
--  MIGRATION v24 — Rôle "vendeuse" + alerte écart d'inventaire.
--  À exécuter dans Supabase > SQL Editor > Run (après v23).
-- ============================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('gerant','admin','pompiste','vendeuse'));

-- Recréer v_alerts avec la branche ECART_INVENTAIRE
drop view if exists v_alerts;
create view v_alerts as
select station_id, report_date, 'VERSEMENT_MANQUANT'::text as type, 'haute'::text as gravite,
  'Cash à verser '||round((cash_declare-total_depense))||' F, aucun versement' as detail
from v_report_metrics where (cash_declare-total_depense) > 1000 and total_verse = 0
union all
select station_id, report_date, 'VERSEMENT_INCOMPLET','haute',
  'Versé '||round(total_verse)||' F < à verser '||round(cash_declare-total_depense)||' F'
from v_report_metrics where total_verse > 0 and total_verse < (cash_declare-total_depense) - 1000
union all
select station_id, report_date, 'ECART_CAISSE','moyenne', 'Écart '||round(cash_declare-total_depense-total_verse)||' F'
from v_report_metrics where abs(cash_declare-total_depense-total_verse) > 1000 and total_verse > 0
union all
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_litres_calc)||' L vs déclaré '||round(ess_litres)||' L'
from v_report_metrics where ess_litres_calc is not null and ess_litres is not null and abs(ess_litres_calc - ess_litres) > 100
union all
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
select l.station_id, l.derniere_date, 'STOCK_BAS_GAZ','moyenne',
  'Gaz bas : '||concat_ws(', ',
    case when l.gaz_stock_3  < s.seuil_gaz then '3kg='||round(l.gaz_stock_3) end,
    case when l.gaz_stock_6  < s.seuil_gaz then '6kg='||round(l.gaz_stock_6) end,
    case when l.gaz_stock_12 < s.seuil_gaz then '12kg='||round(l.gaz_stock_12) end,
    case when l.gaz_stock_38 < s.seuil_gaz then '38kg='||round(l.gaz_stock_38) end)
from v_latest_stock l join stations s on s.id=l.station_id
where l.gaz_stock_3 < s.seuil_gaz or l.gaz_stock_6 < s.seuil_gaz or l.gaz_stock_12 < s.seuil_gaz or l.gaz_stock_38 < s.seuil_gaz
union all
select l.station_id, l.derniere_date, 'STOCK_BAS_LUBRIFIANT','moyenne',
  'Lubrifiant bas : '||string_agg(kv.key||'='||kv.value, ', ')
from v_latest_stock l join stations s on s.id=l.station_id, lateral jsonb_each_text(l.lubrifiant_stock) kv
where l.lubrifiant_stock is not null and kv.value ~ '^[0-9]+$' and kv.value::numeric < s.seuil_lubrifiant
group by l.station_id, l.derniere_date
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_next)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon where ecart_ess is not null and abs(ecart_ess) > 300
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_next)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon where ecart_gas is not null and abs(ecart_gas) > 300
union all
select station_id, report_date, 'PERTE_LIVRAISON','haute',
  produit||' : livré '||round(livre)||' L / commandé '||round(quantite_commandee)||' L → perte non acceptable '||round(perte_na_litres)||' L ('||round(perte_na_montant)||' F)'
from v_pertes_livraison where perte_na_litres > 0
union all
select station_id, report_date, 'BONS_INEXPLIQUES','haute',
  'Encours bons : −'||round(baisse)||' F. Justifié (commandes '||round(commandes_bons)||' + loyer '||round(loyer_mois)||') → manque '||round(baisse - commandes_bons - loyer_mois)||' F sans commande ni loyer'
from v_bons_baisses where (baisse - commandes_bons - loyer_mois) > 100000
union all
select station_id, report_date, 'BONS_INEXPLIQUES','haute',
  'Encours bons : +'||round(hausse)||' F mais ventes à bon '||round(ventes_bon)||' F → hausse inexpliquée de '||round(hausse - ventes_bon)||' F'
from v_bons_hausses where (hausse - ventes_bon) > 100000
union all
-- NOUVEAU : écart d'inventaire important (ajustement au comptage)
select station_id, date_mouvement as report_date, 'ECART_INVENTAIRE','haute',
  'Inventaire '||categorie||coalesce(' '||produit,'')||' : écart '||coalesce(round(quantite)::text||' u', round(valeur)::text||' F')||coalesce(' — '||note,'')
from stock_movements
where source='inventaire' and (abs(coalesce(quantite,0)) > 3 or abs(coalesce(valeur,0)) > 50000)
union all
select s.id as station_id, dd::date as report_date, 'POINT_MANQUANT','moyenne', 'Aucun point saisi ce jour-là'
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') dd
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = dd::date)
  and exists (select 1 from daily_reports r2 where r2.station_id=s.id and r2.report_date < dd::date);

grant select on v_alerts to authenticated, anon;
