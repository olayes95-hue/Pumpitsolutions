-- Validation obligatoire des nouveaux comptes : jusqu'ici, n'importe qui pouvait s'inscrire
-- (src/pages/Login.jsx, mode "signup") et le trigger handle_new_user() lui donnait directement
-- le rôle 'gerant' — accès opérationnel complet dès l'inscription, sans intervention admin, et
-- sans station attribuée (l'app se retrouvait juste cassée/vide plutôt que bloquée proprement).

alter table profiles add column if not exists approved boolean not null default false;

-- Comptes déjà existants (équipe réelle en place) : validés d'office, pour ne bloquer
-- personne qui travaille déjà avec l'application aujourd'hui. Seuls les FUTURS comptes
-- (et ceux qu'un admin décide de dé-valider) repasseront par cette porte.
update profiles set approved = true where approved = false;

-- Nouvelle inscription : jamais approuvée automatiquement, quel que soit le rôle par défaut.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role, approved)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'gerant', false)
  on conflict (id) do nothing;
  return new;
end; $$;

-- Garde-fou : la policy UPDATE de profiles autorise déjà id = auth.uid() (pour que chacun
-- puisse éditer son propre profil) — sans ce trigger, un compte non validé pourrait
-- s'auto-valider lui-même en modifiant sa propre ligne. Seul un admin peut changer ce champ,
-- même sur SA PROPRE ligne (même logique que prevent_role_change pour le rôle).
create or replace function public.prevent_approval_self_grant()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.approved is distinct from old.approved and not public.is_admin() then
    raise exception 'Seul un administrateur peut valider ou invalider un compte.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_prevent_approval_self_grant on profiles;
create trigger trg_prevent_approval_self_grant before update on profiles
  for each row execute function public.prevent_approval_self_grant();

-- Suppression de compte (retire l'accès à l'application — ne supprime PAS le compte
-- email/mot de passe côté Supabase Auth, ça demanderait une clé service_role) : admin
-- uniquement. Aucune policy DELETE n'existait jusqu'ici sur profiles.
drop policy if exists p_profiles_del on profiles;
create policy p_profiles_del on profiles for delete using (is_admin());
