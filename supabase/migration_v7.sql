-- ============================================================
--  MIGRATION v7 — Commandes carburant (workflow + contrôle cuves)
--                 + Contrôles ANM (inopinés)
--  À exécuter dans Supabase > SQL Editor > Run (après v6).
-- ============================================================

-- ---------- Commandes de carburant ----------
create table if not exists fuel_orders (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  produit text not null,                     -- essence / gasoil
  quantite_commandee numeric,                -- litres commandés
  bons_base numeric,                         -- montant des bons servant de base (optionnel)
  statut text not null default 'proposee',   -- proposee / validee / lancee / recue / annulee
  cuve_avant numeric,                        -- niveau cuve avant dépotage (litres)
  cuve_apres numeric,                        -- niveau cuve après dépotage (litres)
  note text,
  proposed_by uuid references profiles(id), proposed_at timestamptz default now(),
  validated_by uuid references profiles(id), validated_at timestamptz,
  lancee_at timestamptz,
  recu_by uuid references profiles(id), recu_at timestamptz,
  created_at timestamptz default now());
create index if not exists idx_orders_station on fuel_orders(station_id, created_at desc);

alter table fuel_orders enable row level security;
drop policy if exists p_orders_sel on fuel_orders;
create policy p_orders_sel on fuel_orders for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_orders_ins on fuel_orders;
create policy p_orders_ins on fuel_orders for insert with check (auth.role()='authenticated');
drop policy if exists p_orders_upd on fuel_orders;
create policy p_orders_upd on fuel_orders for update using (is_admin() or station_id = public.my_station());
drop policy if exists p_orders_del on fuel_orders;
create policy p_orders_del on fuel_orders for delete using (is_admin());

-- ---------- Contrôles ANM (inopinés) ----------
create table if not exists inspections (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  date_controle date not null,
  organisme text default 'ANM',
  pompes text,                       -- pompes concernées (ex : "E1, E3")
  prelevement_litres numeric,        -- litres prélevés
  retour_cuve_litres numeric,        -- litres retournés en cuve
  conforme boolean,                  -- pompes jugées conformes ?
  observations text,
  fiche_photo_path text,             -- photo de la fiche laissée par le contrôleur
  created_by uuid references profiles(id),
  created_at timestamptz default now());
create index if not exists idx_insp_station on inspections(station_id, date_controle desc);

alter table inspections enable row level security;
drop policy if exists p_insp_sel on inspections;
create policy p_insp_sel on inspections for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_insp_ins on inspections;
create policy p_insp_ins on inspections for insert with check (auth.role()='authenticated');
drop policy if exists p_insp_del on inspections;
create policy p_insp_del on inspections for delete using (is_admin() or created_by = auth.uid());
