-- DURCISSEMENT SÉCURITÉ (version corrigée) : empêche un utilisateur de l'app
-- de changer son propre rôle. Seul un admin (ou l'éditeur SQL) le peut.
-- IMPORTANT : la fonction est en security INVOKER (pas definer), sinon current_user
-- vaudrait le propriétaire et le verrou ne se déclencherait jamais.
-- Colle ce bloc dans Supabase > SQL Editor > Run.

create or replace function public.prevent_role_change()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if new.role is distinct from old.role
     and current_user = 'authenticated'   -- utilisateur de l'app (≠ 'postgres' de l'éditeur SQL)
     and not public.is_admin() then
    raise exception 'Seul un administrateur peut modifier le role d''un compte.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_prevent_role_change on public.profiles;
create trigger trg_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();
