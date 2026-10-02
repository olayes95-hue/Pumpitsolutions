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
