-- CORRECTIF : l'inscription renvoyait une erreur 500 car le trigger de création
-- de profil ne trouvait pas la table (search_path des fonctions security definer).
-- Colle ce bloc dans Supabase > SQL Editor > Run.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'gerant')
  on conflict (id) do nothing;
  return new;
end; $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
