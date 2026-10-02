-- ============================================================
--  Retour arrière du multi-clients (v96 à v101)
-- ============================================================
--  Revenir à une base mono-client n'a de sens qu'avec UN SEUL client :
--  avec plusieurs, les données se mélangeraient. Le script refuse donc
--  de s'exécuter s'il reste plus d'un client.
--
--  S'il y en a plusieurs, supprimez d'abord les autres (irréversible) :
--      select public.delete_organisation(2, 'Nom exact du client');
--  puis lancez ce script. Pour garder leurs données, restaurez plutôt la
--  sauvegarde faite avant la v96.
--
--  Les colonnes organisation_id et les tables de la v97 (formules,
--  factures…) sont conservées : elles sont inoffensives et la v96 pourra
--  être rejouée telle quelle.
--
--  Si l'ancienne application doit resservir, rendez aussi le bucket public :
--      update storage.buckets set public = true where id = 'bordereaux';
-- ============================================================
begin;

do $$
begin
  if (select count(*) from public.organisations) > 1 then
    raise exception 'Plusieurs clients existent : retour arrière refusé.';
  end if;
end $$;

-- Réglages : clé primaire d'origine (avant de relâcher organisation_id)
alter table public.settings drop constraint if exists settings_pkey;
alter table public.settings add constraint settings_pkey primary key (id);

-- Règles et triggers de cloisonnement
do $$
declare t record;
begin
  for t in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname in ('tenant_isolation','platform_only_ins','platform_only_upd','platform_only_del')
  loop
    execute format('drop policy %I on public.%I', t.policyname, t.tablename);
  end loop;
  for t in select c.relname as tablename from pg_trigger g join pg_class c on c.oid = g.tgrelid
           where g.tgname = 'trg_set_organisation' and not g.tgisinternal
  loop
    execute format('drop trigger trg_set_organisation on public.%I', t.tablename);
    execute format('alter table public.%I alter column organisation_id drop default', t.tablename);
    execute format('alter table public.%I alter column organisation_id drop not null', t.tablename);
  end loop;
end $$;
drop trigger if exists trg_prevent_org_change on public.profiles;
-- v101 : l'offre par station n'a plus de sens sans clients. La colonne est gardée mais libérée,
-- pour que la v100 puis la v101 se rejouent.
drop trigger if exists trg_station_offre on public.stations;
alter table public.stations drop column if exists formule;

-- Unicités d'origine
alter table public.products drop constraint if exists products_org_categorie_nom_key;
alter table public.products add constraint products_categorie_nom_key unique (categorie, nom);
alter table public.lubrifiant_types drop constraint if exists lubrifiant_types_org_nom_key;
alter table public.lubrifiant_types add constraint lubrifiant_types_nom_key unique (nom);

-- Vues : retour au filtre d'origine sur les réglages
do $$
declare v record; def text;
begin
  for v in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
  loop
    def := pg_get_viewdef(v.oid);
    if position('settings.organisation_id = current_org_id()' in def) > 0 then
      execute format('create or replace view public.%I as %s', v.relname,
        replace(def, 'settings.organisation_id = current_org_id()', 'settings.id = 1'));
    end if;
    execute format('alter view public.%I set (security_invoker = on)', v.relname);
  end loop;
end $$;

-- Fonctions : versions d'origine
create or replace function public.jours_correction_gerant()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select jours_correction_gerant from settings where id = 1), 2);
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role, approved)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'gerant', false)
  on conflict (id) do nothing;
  return new;
end; $$;

drop function if exists public.create_organisation(text);
drop function if exists public.create_organisation(text, text);
drop function if exists public.switch_organisation(bigint);
drop function if exists public.assign_organisation(uuid, bigint);

-- Photos : règles d'origine (v64)
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "bordereaux_read" on storage.objects;
    create policy "bordereaux_read" on storage.objects for select to authenticated
      using (bucket_id = 'bordereaux' and (is_admin() or (storage.foldername(name))[1] = my_station()::text));
    drop policy if exists "bordereaux_insert" on storage.objects;
    create policy "bordereaux_insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'bordereaux' and (is_admin() or (storage.foldername(name))[1] = my_station()::text));
  end if;
end $$;

-- Fonctions de la v97 : supprimées en dernier (plus rien n'en dépend), pour que
-- v96 puis v97 se rejouent proprement.
drop function if exists public.can_read_photo(text);
drop function if exists public.my_organisation_id() cascade;
-- Fonctions de la v100 : leur absence permet de rejouer v96, v97, v99 puis v100.
drop function if exists public.agent_can(text) cascade;
drop function if exists public.is_agent() cascade;
drop function if exists public.organisation_accessible(public.organisations) cascade;
drop function if exists public.create_organisation(text, text, boolean);
drop function if exists public.bo_supervision();
drop function if exists public.bo_stations();

commit;
