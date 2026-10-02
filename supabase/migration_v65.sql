-- ============================================================
--  MIGRATION v65 — RBAC, Phase A : fondation (purement additive).
--
--  Remplace le CHECK constraint figé sur profiles.role par une vraie
--  table de référence, gérable depuis l'écran "Rôles" (à venir en
--  Phase D). Ajoute le catalogue de permissions (fixe, non créable
--  depuis l'UI), la matrice rôle→permissions (éditable par l'admin
--  uniquement), et le rattachement multi-stations pour les rôles qui
--  en ont besoin (directeur/comptable).
--
--  GARDE-FOUS (voir plan complet) :
--   - is_admin() n'est PAS modifiée, ne lit jamais role_permissions.
--   - 'manage_roles' n'existe PAS dans le catalogue de permissions —
--     structurellement impossible à accorder via la matrice.
--   - Les 4 rôles historiques (admin/gerant/pompiste/vendeuse) sont
--     is_system=true, gelés par trigger (clé + statut système
--     non modifiables, suppression interdite).
--   - profiles_role_fkey (RESTRICT par défaut) empêche de supprimer
--     un rôle encore assigné à un compte.
--   - roles/permissions/role_permissions/profile_stations : écriture
--     strictement is_admin(), jamais via une permission de la matrice.
--
--  Rien ne consomme encore ces tables (aucune policy existante n'est
--  modifiée dans cette migration) — zéro changement de comportement.
--  À exécuter dans Supabase > SQL Editor > Run (après v64). Idempotente.
-- ============================================================

create table if not exists roles (
  key text primary key,
  label text not null,
  is_system boolean not null default false,
  created_at timestamptz default now());

alter table roles enable row level security;
drop policy if exists p_roles_sel on roles;
create policy p_roles_sel on roles for select using (auth.role() = 'authenticated');
drop policy if exists p_roles_write on roles;
create policy p_roles_write on roles for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on roles to authenticated;

create table if not exists permissions (
  key text primary key,
  label text not null,
  category text,
  created_at timestamptz default now());

alter table permissions enable row level security;
drop policy if exists p_permissions_sel on permissions;
create policy p_permissions_sel on permissions for select using (auth.role() = 'authenticated');
grant select on permissions to authenticated;
-- Volontairement : aucune policy insert/update/delete, aucun grant au-delà de select.
-- Un admin ne peut pas inventer une permission depuis l'UI ; seule une migration le peut,
-- et une nouvelle clé ne fait rien tant que le code ne la vérifie nulle part.

create table if not exists role_permissions (
  role_key text not null references roles(key) on delete cascade,
  permission_key text not null references permissions(key) on delete restrict,
  created_at timestamptz default now(),
  primary key (role_key, permission_key));

alter table role_permissions enable row level security;
drop policy if exists p_role_perms_sel on role_permissions;
create policy p_role_perms_sel on role_permissions for select using (auth.role() = 'authenticated');
drop policy if exists p_role_perms_write on role_permissions;
create policy p_role_perms_write on role_permissions for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on role_permissions to authenticated;

create table if not exists profile_stations (
  profile_id uuid not null references profiles(id) on delete cascade,
  station_id bigint not null references stations(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (profile_id, station_id));

alter table profile_stations enable row level security;
drop policy if exists p_profstations_sel on profile_stations;
create policy p_profstations_sel on profile_stations for select using (profile_id = auth.uid() or is_admin());
drop policy if exists p_profstations_write on profile_stations;
create policy p_profstations_write on profile_stations for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on profile_stations to authenticated;

-- Fonctions RLS — is_admin() en court-circuit dans les deux : chaque site d'appel
-- écrit juste has_permission('x'), jamais is_admin() or has_permission('x').
create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    join public.role_permissions rp on rp.role_key = p.role
    where p.id = auth.uid() and rp.permission_key = p_key
  );
$$;

create or replace function public.has_station_access(p_station_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select p_station_id is not null and (
    public.is_admin()
    or p_station_id = public.my_station()
    or exists (select 1 from public.profile_stations ps
               where ps.profile_id = auth.uid() and ps.station_id = p_station_id)
  );
$$;

-- Gel des rôles système : clé et statut système non modifiables, suppression interdite,
-- pour admin/gerant/pompiste/vendeuse (le front a des role === 'x' codés en dur dessus).
-- SQL editor / service_role restent exemptés (même style que prevent_role_change).
create or replace function public.prevent_system_role_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system and current_user = 'authenticated' then
      raise exception 'Rôle système : suppression interdite (%).', old.key;
    end if;
    return old;
  end if;
  if old.is_system and current_user = 'authenticated'
     and (new.key is distinct from old.key or new.is_system is distinct from old.is_system) then
    raise exception 'Rôle système : cette clé ne peut pas être modifiée (%).', old.key;
  end if;
  return new;
end; $$;
drop trigger if exists trg_prevent_system_role_mutation on roles;
create trigger trg_prevent_system_role_mutation before update or delete on roles
  for each row execute function public.prevent_system_role_mutation();

-- Seed : les 4 rôles historiques (système) + les 2 nouveaux.
insert into roles (key, label, is_system) values
  ('admin', 'Administrateur', true),
  ('gerant', 'Gérant', true),
  ('pompiste', 'Pompiste', true),
  ('vendeuse', 'Vendeuse', true),
  ('directeur', 'Directeur', false),
  ('comptable', 'Comptable', false)
on conflict (key) do nothing;

insert into permissions (key, label, category) values
  ('view_dashboard', 'Tableau de bord', 'Pilotage'),
  ('view_history', 'Historique', 'Pilotage'),
  ('view_alerts', 'Alertes (lecture)', 'Pilotage'),
  ('manage_alerts', 'Alertes (traiter)', 'Pilotage'),
  ('view_finance', 'Point financier (lecture)', 'Finance'),
  ('manage_finance', 'Point financier (écriture + clôture mensuelle)', 'Finance'),
  ('view_bank_recon', 'Rapprochement (lecture)', 'Finance'),
  ('manage_bank_recon', 'Rapprochement (écriture)', 'Finance'),
  ('view_ocr_check', 'Vérif bordereaux', 'Finance'),
  ('view_audit_log', 'Journal d''audit', 'Administration'),
  ('validate_orders', 'Valider/refuser commandes', 'Commandes'),
  ('manage_orders', 'Gérer commandes (proposer/lancer/réceptionner)', 'Commandes'),
  ('manage_products', 'Produits & prix', 'Administration'),
  ('manage_suppliers', 'Fournisseurs', 'Administration'),
  ('manage_stations_config', 'Fiches stations', 'Administration'),
  ('manage_team', 'Équipe (assigner rôle + stations)', 'Administration')
on conflict (key) do nothing;

-- gerant/vendeuse : codifie le comportement actuel (Orders.jsx ouvre déjà
-- proposer/lancer/réceptionner à tout non-pompiste) — ne change rien.
-- admin : aucune ligne, son accès passe toujours par le court-circuit is_admin().
-- manage_products/manage_suppliers/manage_stations_config/manage_team : non
-- attribuées au départ, disponibles pour un futur rôle créé depuis l'écran Rôles.
insert into role_permissions (role_key, permission_key) values
  ('gerant', 'manage_orders'),
  ('vendeuse', 'manage_orders'),
  ('directeur', 'view_dashboard'), ('directeur', 'view_history'), ('directeur', 'view_alerts'),
  ('directeur', 'view_finance'), ('directeur', 'validate_orders'),
  ('comptable', 'view_finance'), ('comptable', 'manage_finance'),
  ('comptable', 'view_bank_recon'), ('comptable', 'manage_bank_recon'),
  ('comptable', 'view_ocr_check'), ('comptable', 'view_audit_log'), ('comptable', 'view_history')
on conflict do nothing;

-- Bascule CHECK figé -> FK vers roles(key). RESTRICT par défaut : un rôle encore
-- assigné à un compte ne peut pas être supprimé.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_fkey foreign key (role) references roles(key);
