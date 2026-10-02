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
