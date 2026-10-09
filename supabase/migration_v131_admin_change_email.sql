-- ============================================================
--  MIGRATION v131 — L'admin peut changer l'email d'un membre de son équipe.
--
--  Jusqu'ici, l'email vit uniquement dans auth.users — jamais affiché ni
--  modifiable depuis Stations & équipe (voir le commentaire déjà présent
--  dans Stations.jsx deleteUser() : "nécessiterait une clé service_role").
--  Changer l'email d'un AUTRE utilisateur nécessite l'API Admin de Supabase
--  Auth (clé service_role, jamais exposée au navigateur) — géré par la
--  nouvelle edge function `admin-update-email` (voir ce fichier).
--
--  Cette migration n'ajoute qu'une fonction de LECTURE (affichage de
--  l'email dans le tableau équipe) : `equipe_emails()`, SECURITY DEFINER,
--  réservée à is_admin(), scoping par organisation — même pattern que
--  bo_agents() (migration_v102) pour l'équipe PumpIT elle-même.
--  L'ÉCRITURE (changement effectif) passe par l'edge function, pas par le
--  SQL direct sur auth.users — Supabase déconseille d'écrire directement
--  dans auth.users (désynchronise auth.identities, cassant la connexion
--  email/mot de passe) ; l'API Admin gère ça correctement.
-- ============================================================

create or replace function public.equipe_emails()
returns table (id uuid, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
  select p.id, u.email::text
  from profiles p
  join auth.users u on u.id = p.id
  where p.organisation_id = public.current_org_id();
end; $$;
revoke execute on function public.equipe_emails() from anon;
