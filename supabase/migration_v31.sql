-- ============================================================
--  MIGRATION v31 — Ventes supérette PAR PRODUIT + produits
--  proposés par la vendeuse (validés ensuite par l'admin).
--
--  1) La vendeuse saisit ses ventes ligne par ligne : elle choisit
--     un produit du catalogue (quantité + prix de vente), ou en
--     AJOUTE un absent de la liste — celui-ci est créé « en attente »
--     et l'admin le valide / corrige ensuite.
--  2) Les lignes sont stockées dans superette_sales ; le total
--     alimente daily_reports.superette_espece (réconciliation inchangée).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v30 / FINALE v27→v30).
--  Idempotente et rejouable.
-- ============================================================

-- ── 1. Catalogue : statut de validation + provenance ────────
alter table products add column if not exists statut     text not null default 'valide';  -- valide / en_attente
alter table products add column if not exists created_by uuid references auth.users(id);
alter table products add column if not exists station_id bigint references stations(id);

-- La vendeuse / le gérant peut PROPOSER un produit, mais uniquement « en_attente ».
-- (L'admin garde p_products_all : insert/update/delete libres, dont la validation.)
drop policy if exists p_products_ins_pending on products;
create policy p_products_ins_pending on products
  for insert to authenticated
  with check (statut = 'en_attente');

-- ── 2. Ventes supérette détaillées (une ligne par produit) ──
create table if not exists superette_sales (
  id          bigint generated always as identity primary key,
  station_id  bigint not null references stations(id),
  report_date date   not null,
  product_id  bigint references products(id) on delete set null,
  nom         text   not null,                    -- libellé figé au moment de la vente
  quantite    numeric not null default 1,
  prix_vente  numeric not null default 0,
  montant     numeric not null default 0,         -- quantite * prix_vente
  created_by  uuid default auth.uid(),
  created_at  timestamptz default now());

create index if not exists idx_superette_sales_day on superette_sales(station_id, report_date);

alter table superette_sales enable row level security;
grant select, insert, update, delete on superette_sales to authenticated;

-- Lecture / écriture : admin partout, sinon uniquement sa station.
drop policy if exists p_ssales_sel on superette_sales;
create policy p_ssales_sel on superette_sales for select
  using (is_admin() or station_id = my_station());
drop policy if exists p_ssales_ins on superette_sales;
create policy p_ssales_ins on superette_sales for insert
  with check (is_admin() or station_id = my_station());
drop policy if exists p_ssales_upd on superette_sales;
create policy p_ssales_upd on superette_sales for update
  using (is_admin() or station_id = my_station())
  with check (is_admin() or station_id = my_station());
drop policy if exists p_ssales_del on superette_sales;
create policy p_ssales_del on superette_sales for delete
  using (is_admin() or station_id = my_station());

-- ── 3. Vue de synthèse (admin) : ventes supérette par produit ─
create or replace view v_superette_sales as
select s.station_id, s.report_date, s.product_id,
       coalesce(p.nom, s.nom) as nom,
       s.quantite, s.prix_vente, s.montant,
       p.statut as produit_statut
from superette_sales s
left join products p on p.id = s.product_id;

grant select on v_superette_sales to authenticated, anon;
