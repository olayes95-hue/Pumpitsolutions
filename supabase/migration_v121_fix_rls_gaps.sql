-- ============================================================
--  MIGRATION v121 — Corrige deux failles RLS trouvées par l'audit checklist Go-Live.
-- ============================================================

-- ------------------------------------------------------------
-- 1. assistance_messages : la policy SELECT ne vérifiait que l'EXISTENCE de la
--    demande parente (`exists(select 1 from assistance_demandes where id = demande_id)`),
--    qui est vraie pour n'importe quel demande_id valide — n'importe quel utilisateur
--    authentifié, de N'IMPORTE QUEL client, pouvait donc lire les messages (contenu,
--    pièces jointes, téléphone de rappel) de n'importe quel autre client en itérant les
--    id. Corrigé en reprenant exactement la règle de visibilité de assistance_demandes
--    (p_assistance_demandes_sel, migration_v99) : un message n'est visible que si sa
--    demande parente l'est (plateforme : tout ; client : ses propres demandes, ou toutes
--    celles de son organisation s'il est admin).
-- ------------------------------------------------------------
drop policy if exists p_assistance_messages_sel on public.assistance_messages;
create policy p_assistance_messages_sel on public.assistance_messages for select to authenticated
  using (exists (
    select 1 from public.assistance_demandes d
    where d.id = demande_id
      and ((select public.is_platform_admin())
           or (d.organisation_id = (select public.my_organisation_id())
               and (d.created_by = auth.uid() or (select public.is_admin()))))
  ));

-- ------------------------------------------------------------
-- 2. roles / role_permissions : tables GLOBALES (partagées par tous les clients, hors
--    du cloisonnement par organisation_id — v96 les exclut délibérément). Leurs policies
--    d'écriture utilisaient is_admin(), qui est vrai pour l'admin de N'IMPORTE QUEL
--    client : l'admin d'un client pouvait donc modifier le catalogue rôles/permissions
--    de TOUS les clients de la plateforme (ex. ajouter une permission à "vendeuse"
--    partout). Restreint à is_platform_admin() — seule la plateforme gère ce catalogue
--    partagé ; chaque client reste libre d'activer/désactiver les permissions pour SES
--    rôles via role_permissions, mais ne peut plus toucher au catalogue global.
-- ------------------------------------------------------------
drop policy if exists p_roles_write on public.roles;
create policy p_roles_write on public.roles for all
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

drop policy if exists p_role_perms_write on public.role_permissions;
create policy p_role_perms_write on public.role_permissions for all
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
