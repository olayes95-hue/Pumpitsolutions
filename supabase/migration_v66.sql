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
