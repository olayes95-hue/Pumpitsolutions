-- ============================================================
--  RBAC (Directeur / Comptable / rôles dynamiques) — migrations
--  combinées v65 à v72, dans l'ordre. Exécuter ce fichier en une
--  seule fois dans Supabase > SQL Editor > Run. Idempotent
--  (peut être relancé sans risque).
-- ============================================================


-- ############################################################
-- ## migration_v65.sql
-- ############################################################

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

-- ############################################################
-- ## migration_v66.sql
-- ############################################################

-- ============================================================
--  MIGRATION v66 — RBAC, Phase B1 : corrige un vrai bug de sécurité
--  trouvé pendant l'analyse (indépendant de tout le reste du RBAC).
--
--  expenses/deliveries/fuel_orders INSERT (migration_v11.sql) utilisent
--  `my_role() is distinct from 'pompiste'` — une liste D'EXCLUSION, pas
--  d'autorisation, et SANS AUCUNE vérification de station. Dès que
--  directeur/comptable deviennent des valeurs de rôle valides (v65),
--  ils passeraient ce test automatiquement et pourraient écrire dans
--  n'importe quelle station via l'API, alors qu'aucun des deux n'est
--  censé toucher la Saisie du jour ou les commandes.
--
--  Fix : liste d'autorisation positive (manage_orders, déjà seedée sur
--  gerant/vendeuse en v65 — comportement inchangé pour eux) + vérification
--  de station, qui n'existait pas du tout avant.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v65). Idempotente.
-- ============================================================

drop policy if exists p_exp_ins on expenses;
create policy p_exp_ins on expenses for insert with check (
  is_admin() or (has_permission('manage_orders') and station_id = public.my_station())
);

drop policy if exists p_deliv_ins on deliveries;
create policy p_deliv_ins on deliveries for insert with check (
  is_admin() or (has_permission('manage_orders') and station_id = public.my_station())
);

drop policy if exists p_orders_ins on fuel_orders;
create policy p_orders_ins on fuel_orders for insert with check (
  is_admin() or (has_permission('manage_orders') and station_id = public.my_station())
);

-- ############################################################
-- ## migration_v67.sql
-- ############################################################

-- ============================================================
--  MIGRATION v67 — RBAC, Phase B2 : fuel_orders UPDATE (validate vs
--  manage) + lecture élargie fuel_orders/order_receptions.
--
--  Le directeur ne peut QUE valider/refuser une commande proposée
--  (statut 'proposee' -> 'validee'/'annulee') — jamais la créer, la
--  lancer ou la réceptionner. Imposé ici au niveau RLS via la valeur
--  de statut AVANT (using) et APRÈS (with check) la transition, pas
--  seulement caché côté écran : un appel API direct qui tenterait de
--  faire passer une commande 'lancee'/'partielle' à autre chose, ou de
--  modifier une commande déjà validée, échoue quel que soit le rôle
--  qui n'a que validate_orders.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v66). Idempotente.
-- ============================================================

drop policy if exists p_orders_upd on fuel_orders;
create policy p_orders_upd on fuel_orders for update
  using (
    is_admin()
    or (has_permission('manage_orders') and has_station_access(station_id))
    or (has_permission('validate_orders') and has_station_access(station_id) and statut = 'proposee')
  )
  with check (
    is_admin()
    or (has_permission('manage_orders') and has_station_access(station_id))
    or (has_permission('validate_orders') and has_station_access(station_id) and statut in ('validee', 'annulee'))
  );

drop policy if exists p_orders_sel on fuel_orders;
create policy p_orders_sel on fuel_orders for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_finance')
    or has_permission('validate_orders') or has_permission('manage_orders')
  ))
);

drop policy if exists p_recept_sel on order_receptions;
create policy p_recept_sel on order_receptions for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_finance') or has_permission('validate_orders') or has_permission('manage_orders')
  ))
);

-- ############################################################
-- ## migration_v68.sql
-- ############################################################

-- ============================================================
--  MIGRATION v68 — RBAC, Phase B3 : lecture élargie sur les tables qui
--  alimentent Tableau de bord / Historique / Alertes / Point financier
--  (directement, ou via les vues security_invoker qui les lisent).
--
--  Branche existante `station_id = my_station()` conservée telle
--  quelle sur chaque table — comportement inchangé pour gérant/
--  pompiste/vendeuse/admin. Seule une nouvelle branche OR est ajoutée,
--  vraie uniquement pour un profil qui a la permission de lecture ET
--  l'accès à cette station précise (has_station_access — my_station()
--  OU une ligne dans profile_stations).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v67). Idempotente.
-- ============================================================

drop policy if exists p_reports_sel on daily_reports;
create policy p_reports_sel on daily_reports for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_history') or has_permission('view_finance')
  ))
);

drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_history') or has_permission('view_finance')
  ))
);

drop policy if exists p_dep_sel on deposits;
create policy p_dep_sel on deposits for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_history') or has_permission('view_finance')
    or has_permission('view_bank_recon') or has_permission('view_ocr_check')
  ))
);

drop policy if exists p_deliv_sel on deliveries;
create policy p_deliv_sel on deliveries for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_history') or has_permission('view_finance')
  ))
);

drop policy if exists p_mvt_sel on stock_movements;
create policy p_mvt_sel on stock_movements for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (has_permission('view_dashboard') or has_permission('view_finance')))
);

drop policy if exists p_charges_sel on charges;
create policy p_charges_sel on charges for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (has_permission('view_dashboard') or has_permission('view_finance')))
);

drop policy if exists p_dismiss_sel on alert_dismissals;
create policy p_dismiss_sel on alert_dismissals for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (has_permission('view_dashboard') or has_permission('view_alerts')))
);

drop policy if exists p_attach_sel on attachments;
create policy p_attach_sel on attachments for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and has_permission('view_history'))
);

drop policy if exists p_ssales_sel on superette_sales;
create policy p_ssales_sel on superette_sales for select using (
  is_admin() or station_id = my_station()
  or (has_station_access(station_id) and has_permission('view_dashboard'))
);

-- ############################################################
-- ## migration_v69.sql
-- ############################################################

-- ============================================================
--  MIGRATION v69 — RBAC, Phase B4 : écriture finance (manage_finance).
--
--  charges, finance_periodes_verrouillees, finance_soldes_ouverture,
--  finance_bons_reconciliation, compte_bancaire_solde_initial,
--  compte_bancaire_mouvements passent de is_admin()-only à
--  is_admin() or (manage_finance + station propre/rattachée).
--
--  Décision actée : le comptable peut aussi verrouiller/déverrouiller
--  un mois (finance_periodes_verrouillees couverte par manage_finance,
--  pas réservée à l'admin) — le garde-fou mois_verrouille() sur
--  charges continue de s'appliquer identiquement à tout le monde,
--  admin compris.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v68). Idempotente.
-- ============================================================

drop policy if exists p_charges_all on charges;
create policy p_charges_all on charges for all
  using ((is_admin() or (has_permission('manage_finance') and has_station_access(station_id))) and not public.mois_verrouille(station_id, mois))
  with check ((is_admin() or (has_permission('manage_finance') and has_station_access(station_id))) and not public.mois_verrouille(station_id, mois));

drop policy if exists p_fpv_all on finance_periodes_verrouillees;
create policy p_fpv_all on finance_periodes_verrouillees for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

drop policy if exists p_fso_all on finance_soldes_ouverture;
create policy p_fso_all on finance_soldes_ouverture for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

drop policy if exists p_fbr_all on finance_bons_reconciliation;
create policy p_fbr_all on finance_bons_reconciliation for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

drop policy if exists p_cbsi_all on compte_bancaire_solde_initial;
create policy p_cbsi_all on compte_bancaire_solde_initial for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

drop policy if exists p_cbm_all on compte_bancaire_mouvements;
create policy p_cbm_all on compte_bancaire_mouvements for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

-- ############################################################
-- ## migration_v70.sql
-- ############################################################

-- ============================================================
--  MIGRATION v70 — RBAC, Phase B5 : bank_lines éclatée + scoping station.
--
--  Aujourd'hui `for all using (is_admin())` — aucune notion de station
--  du tout (un admin voit déjà toutes les stations, donc ça n'avait
--  jamais posé de problème). Éclatée en policies SELECT/INSERT/UPDATE/
--  DELETE séparées (une seule policy "for all" ne peut pas mélanger
--  des USING différents par opération), avec view_bank_recon en
--  lecture et manage_bank_recon en écriture, scopées par station.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v69). Idempotente.
-- ============================================================

drop policy if exists p_bank_all on bank_lines;

create policy p_bank_sel on bank_lines for select using (
  is_admin() or (has_permission('view_bank_recon') and has_station_access(station_id))
);

create policy p_bank_ins on bank_lines for insert with check (
  is_admin() or (has_permission('manage_bank_recon') and has_station_access(station_id))
);

create policy p_bank_upd on bank_lines for update
  using (is_admin() or (has_permission('manage_bank_recon') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_bank_recon') and has_station_access(station_id)));

create policy p_bank_del on bank_lines for delete using (
  is_admin() or (has_permission('manage_bank_recon') and has_station_access(station_id))
);

-- ############################################################
-- ## migration_v71.sql
-- ############################################################

-- ============================================================
--  MIGRATION v71 — RBAC, Phase B6 : audit_log SELECT élargi.
--
--  Aujourd'hui is_admin()-only, sans aucune notion de station (pas
--  utile jusqu'ici puisque seul l'admin, qui voit tout, y accédait).
--  Le comptable a besoin de tracer qui a modifié quoi sur les données
--  financières de ses stations.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v70). Idempotente.
-- ============================================================

drop policy if exists p_audit_sel on audit_log;
create policy p_audit_sel on audit_log for select using (
  is_admin() or (has_permission('view_audit_log') and has_station_access(station_id))
);

-- ############################################################
-- ## migration_v72.sql
-- ############################################################

-- ============================================================
--  MIGRATION v72 — RBAC, Phase B7 : écriture products/suppliers/
--  stations/profiles via les 4 permissions d'administration créées
--  en v65 (manage_products/manage_suppliers/manage_stations_config/
--  manage_team). Aucune de ces 4 permissions n'est attribuée à un
--  rôle pour l'instant (voir v65) — cette migration ne change donc
--  rien en pratique tant que l'admin n'aura pas coché de case dans le
--  futur écran Rôles ; elle prépare seulement le terrain.
--
--  Bonus de passage : suppliers était en `auth.role()='authenticated'`
--  (ouvert à tout utilisateur connecté), pas is_admin() — un oubli
--  historique sans conséquence pratique puisque la seule page qui
--  écrit dedans (Suppliers.jsx) est déjà routée admin-only côté
--  React ; ceci ferme l'écart entre RLS et route au niveau base.
--
--  profiles : le changement de RÔLE reste bloqué pour tout non-admin
--  par le trigger prevent_role_change (déjà en place, non modifié),
--  quelle que soit cette policy — manage_team ne permet donc que de
--  réassigner nom/station, jamais le rôle lui-même.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v71). Idempotente.
-- ============================================================

drop policy if exists p_products_all on products;
create policy p_products_all on products for all
  using (is_admin() or has_permission('manage_products'))
  with check (is_admin() or has_permission('manage_products'));

drop policy if exists p_suppliers_all on suppliers;
create policy p_suppliers_all on suppliers for all
  using (is_admin() or has_permission('manage_suppliers'))
  with check (is_admin() or has_permission('manage_suppliers'));

drop policy if exists p_stations_upd on stations;
create policy p_stations_upd on stations for update using (
  is_admin() or has_permission('manage_stations_config')
);
drop policy if exists p_stations_ins on stations;
create policy p_stations_ins on stations for insert with check (
  is_admin() or has_permission('manage_stations_config')
);

drop policy if exists p_profiles_upd on profiles;
create policy p_profiles_upd on profiles for update using (
  id = auth.uid() or is_admin() or has_permission('manage_team')
);
