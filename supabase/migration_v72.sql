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
