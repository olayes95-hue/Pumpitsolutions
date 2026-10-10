-- ============================================================
--  MIGRATION v138 —
--  1) Le rôle "gérant" s'affiche désormais "Chef de piste" (libellé
--     uniquement — la clé interne `gerant` ne change pas, ni aucune des
--     ~100 vérifications `role === 'gerant'` dans le code : seul ce que
--     voient les utilisateurs change). Le trigger trg_prevent_system_role_mutation
--     (migration_v65) ne bloque que les changements de `key`/`is_system`
--     pour un rôle système — modifier `label` reste autorisé.
--  2) Nouvelle permission view_team (lecture seule de l'onglet Équipe,
--     sans les actions de validation/désactivation/modification) —
--     accordée par défaut au directeur, qui n'avait jusqu'ici aucune
--     visibilité sur les comptes de son équipe (manage_team donne aussi
--     les droits d'édition, pas souhaité par défaut pour ce rôle).
--
--  3) Fix découvert au passage : p_profiles_sel/p_profstations_sel ne
--     laissaient lire les profils/rattachements qu'à soi-même ou à
--     is_admin() — manage_team n'a donc JAMAIS permis à un non-admin de
--     voir l'équipe (Stations.jsx lui renvoyait une liste vide), et
--     view_team aurait eu le même problème. Étendu aux deux permissions.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v137).
-- ============================================================

begin;

update public.roles set label = 'Chef de piste' where key = 'gerant';

insert into public.permissions (key, label, category)
select 'view_team', 'Équipe (lecture)', 'Administration'
where not exists (select 1 from public.permissions where key = 'view_team');

insert into public.role_permissions (role_key, permission_key)
select 'directeur', 'view_team'
where exists (select 1 from public.roles where key = 'directeur')
  and not exists (select 1 from public.role_permissions where role_key = 'directeur' and permission_key = 'view_team');

drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select using (
  id = auth.uid() or is_admin()
  or ((select public.my_permissions()) && array['manage_team', 'view_team'])
);

drop policy if exists p_profstations_sel on public.profile_stations;
create policy p_profstations_sel on public.profile_stations for select using (
  profile_id = auth.uid() or is_admin()
  or ((select public.my_permissions()) && array['manage_team', 'view_team'])
);

commit;
