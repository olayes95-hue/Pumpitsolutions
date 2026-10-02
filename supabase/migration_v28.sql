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
