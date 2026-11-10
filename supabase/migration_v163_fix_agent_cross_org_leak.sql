-- ============================================================
--  MIGRATION v163 — Corrige une fuite inter-organisations sur profiles.
--
--  Bug trouvé en investiguant un signalement utilisateur ("Loique apparaît
--  dans l'équipe d'une station à laquelle je ne l'ai jamais rattaché, et
--  le désactiver coupe son accès ailleurs") : la policy tenant_isolation
--  sur `profiles` a une clause pour que le back-office PumpIT (Agents.jsx)
--  puisse gérer la fiche RH d'un agent plateforme (salaire, commission...)
--  quel que soit son organisation_id "incident" :
--
--    (plateforme_role IS NOT NULL AND agent_can('agents'))
--
--  Cette clause n'est bornée par AUCUNE organisation — un compte qui a la
--  permission plateforme "agents" ET qui navigue dans Stations.jsx (vue
--  CLIENT normale, pas le back-office) d'une organisation X verra fuiter
--  TOUT profil plateforme_role (agent) de N'IMPORTE QUELLE AUTRE
--  organisation, car cette clause ne compare jamais organisation_id à
--  current_org_id(). Loique (organisation_id=1, plateforme_role=
--  'commercial') apparaissait ainsi dans l'équipe de l'organisation 2
--  ("Station Gérard"), à laquelle il n'a jamais été rattaché.
--
--  Vérifié : Agents.jsx liste via bo_agents() (SECURITY DEFINER, ignore
--  RLS) — seule la sauvegarde de la fiche RH passe par un vrai UPDATE
--  profiles direct, donc la clause reste nécessaire, juste mal bornée.
--
--  Fix : la clause ne s'applique que si le viewer n'est PAS dans un
--  contexte d'organisation précis (session back-office pure,
--  current_org_id() IS NULL) OU si la ligne appartient à SA PROPRE
--  organisation courante — jamais à une organisation tierce.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v162).
-- ============================================================

begin;

drop policy if exists tenant_isolation on public.profiles;
create policy tenant_isolation on public.profiles as restrictive
  using (
    (id = auth.uid())
    or (organisation_id = current_org_id() and (plateforme_role is null or is_agent()))
    or (organisation_id is null and plateforme_role is null and agent_can('clients'))
    or (plateforme_role is not null and agent_can('agents') and (current_org_id() is null or organisation_id = current_org_id()))
  )
  with check (
    (id = auth.uid())
    or (organisation_id = current_org_id() and plateforme_role is null)
    or agent_can('clients')
    or (agent_can('agents') and (current_org_id() is null or organisation_id = current_org_id()))
  );

commit;
