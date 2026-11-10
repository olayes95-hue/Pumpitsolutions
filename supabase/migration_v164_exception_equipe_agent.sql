-- ============================================================
--  MIGRATION v164 — Exception explicite : un agent plateforme peut aussi
--  être un vrai employé de station (cas de Loique chez YTRYFA).
--
--  v163 (fuite inter-org) + le commit suivant (.is('plateforme_role',
--  null) sur les 4 requêtes d'équipe côté client) cachent maintenant TOUT
--  profil plateforme_role des équipes clients — correct pour un agent qui
--  touche un tenant de façon incidente (test, support), mais trop large
--  pour Loique, qui est RÉELLEMENT employé (gérant) chez YTRYFA en plus
--  d'être commercial PumpIT. Plutôt que coder son identifiant en dur dans
--  une requête, un drapeau explicite et documenté sur le profil : "oui,
--  celui-ci doit apparaître dans l'équipe de sa propre organisation
--  malgré son rôle plateforme" — décision délibérée, pas un oubli.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v163).
-- ============================================================

begin;

alter table public.profiles add column if not exists membre_equipe_malgre_agent boolean not null default false;
comment on column public.profiles.membre_equipe_malgre_agent is
  'Exception explicite : true = ce profil apparaît dans l''équipe de SA PROPRE organisation même s''il a un plateforme_role (agent à la fois employé réel d''une station et agent PumpIT). Ne contourne pas l''isolation inter-organisations (v163) — seulement la visibilité dans son organisation légitime.';

-- Le cas particulier lui-même (quel profil en bénéficie) est activé séparément, hors de ce
-- fichier versionné : une adresse email réelle n'a pas sa place dans l'historique git.

commit;
