-- ============================================================
--  v97 : ABONNEMENTS, SUSPENSION, FACTURES, PHOTOS, ANCIENNE APPLICATION
-- ============================================================
--  À exécuter APRÈS la v96 (multi-clients). Transactionnel, rejouable.
--
--  1. Formules (Essentiel, Pro, Complet) et abonnement de chaque client.
--  2. Suspension : un client suspendu ne lit et n'écrit plus rien.
--     Un compte non validé non plus (avant : il pouvait lire certaines
--     tables par l'API). Tout passe par current_org_id().
--  3. Factures : émission, encaissement, numérotation continue.
--  4. Ancienne application : ses inscriptions (sans code) sont rattachées
--     au client qui l'accepte explicitement, au lieu de rester orphelines.
--  5. Photos : droit de lecture aligné sur les données (prépare le passage
--     du bucket en privé, fait par la v98).
--  6. Suppression complète d'un client (delete_organisation).
-- ============================================================

begin;

do $$ begin
  if to_regclass('public.organisations') is null then
    raise exception 'Exécutez d''abord migration_v96_multiclient.sql.';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. Formules et abonnement
-- ------------------------------------------------------------
create table if not exists public.formules (
  key text primary key,
  label text not null,
  prix_mensuel numeric not null check (prix_mensuel >= 0),
  ordre int not null default 0
);
insert into public.formules(key, label, prix_mensuel, ordre) values
  ('essentiel', 'Essentiel', 25000, 1),
  ('pro',       'Pro',       40000, 2),
  ('complet',   'Complet',   70000, 3)
on conflict (key) do nothing;

do $$
declare premiere_fois boolean;
begin
  select not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'organisations' and column_name = 'formule')
    into premiere_fois;

  alter table public.organisations add column if not exists formule text not null default 'pro' references public.formules(key);
  alter table public.organisations add column if not exists statut text not null default 'actif';
  alter table public.organisations add column if not exists abonnement_jusqu_au date;
  alter table public.organisations add column if not exists accepte_inscription_sans_code boolean not null default false;
  alter table public.organisations add column if not exists adresse text;
  alter table public.organisations add column if not exists telephone text;
  alter table public.organisations add column if not exists ifu text;

  if premiere_fois then
    -- Le client initial (vos stations) garde toutes les fonctions, et reste le
    -- point de chute des inscriptions faites depuis l'ancienne application.
    update public.organisations set formule = 'complet', accepte_inscription_sans_code = true where id = 1;
  end if;
end $$;

alter table public.organisations drop constraint if exists organisations_statut_check;
alter table public.organisations add constraint organisations_statut_check check (statut in ('actif', 'suspendu'));
-- Un seul client au plus peut recevoir les inscriptions sans code.
create unique index if not exists uq_org_inscription_sans_code
  on public.organisations (accepte_inscription_sans_code) where accepte_inscription_sans_code;

-- ------------------------------------------------------------
-- 2. Identité : organisation « brute » et organisation « active »
-- ------------------------------------------------------------
-- Organisation du compte, sans condition. Sert à afficher l'état de
-- l'abonnement, y compris à un client suspendu.
create or replace function public.my_organisation_id()
returns bigint language sql stable security definer set search_path = public as $$
  select organisation_id from public.profiles where id = auth.uid();
$$;

-- Organisation utilisable pour lire et écrire des données. Toutes les règles
-- tenant_isolation s'appuient sur cette fonction : elle renvoie NULL (donc
-- aucun accès) si le compte n'est pas validé ou si le client est suspendu.
-- L'administrateur de la plateforme n'est jamais bloqué.
create or replace function public.current_org_id()
returns bigint language sql stable security definer set search_path = public as $$
  select p.organisation_id
  from public.profiles p join public.organisations o on o.id = p.organisation_id
  where p.id = auth.uid()
    and (p.is_platform_admin or (p.approved and o.statut = 'actif'));
$$;

drop policy if exists p_org_sel on public.organisations;
create policy p_org_sel on public.organisations for select to authenticated
  using (id = (select public.my_organisation_id()) or (select public.is_platform_admin()));

alter table public.formules enable row level security;
grant select, insert, update, delete on public.formules to authenticated;
drop policy if exists p_formules_sel on public.formules;
create policy p_formules_sel on public.formules for select to authenticated using (true);
drop policy if exists p_formules_write on public.formules;
create policy p_formules_write on public.formules for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- ------------------------------------------------------------
-- 3. Inscription : code d'invitation, ou ancienne application
-- ------------------------------------------------------------
--  - La nouvelle application envoie toujours `org_code`. Code inconnu :
--    le compte reste sans organisation (liste d'attente de la plateforme).
--  - L'ancienne application n'envoie pas ce champ : le compte est rattaché
--    au client qui accepte les inscriptions sans code, s'il y en a un.
--  Dans tous les cas le compte reste « en attente » et ne voit rien tant
--  qu'un administrateur ne l'a pas validé.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org bigint; meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if meta ? 'org_code' then
    select id into v_org from public.organisations
    where code_invitation = upper(trim(coalesce(meta ->> 'org_code', '')));
  else
    select id into v_org from public.organisations where accepte_inscription_sans_code limit 1;
  end if;
  insert into public.profiles(id, full_name, role, approved, organisation_id)
  values (new.id, coalesce(meta ->> 'full_name', new.email), 'gerant', false, v_org)
  on conflict (id) do nothing;
  return new;
end; $$;
revoke execute on function public.handle_new_user() from anon, authenticated;

-- Création d'un client, avec sa formule.
drop function if exists public.create_organisation(text);
create or replace function public.create_organisation(p_nom text, p_formule text default 'pro')
returns public.organisations language plpgsql security definer set search_path = public as $$
declare v_org public.organisations;
begin
  if not public.is_platform_admin() then raise exception 'Réservé à l''administrateur de la plateforme.'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Le nom du client est obligatoire.'; end if;
  if not exists (select 1 from formules where key = p_formule) then raise exception 'Formule inconnue : %', p_formule; end if;
  insert into organisations(nom, formule) values (trim(p_nom), p_formule) returning * into v_org;
  insert into settings
  select (jsonb_populate_record(null::settings, to_jsonb(s) || jsonb_build_object('organisation_id', v_org.id))).*
  from settings s where s.organisation_id = public.current_org_id();
  if not found then
    insert into settings(id, organisation_id) values (1, v_org.id);
  end if;
  return v_org;
end; $$;
revoke execute on function public.create_organisation(text, text) from anon;

-- ------------------------------------------------------------
-- 4. Factures
-- ------------------------------------------------------------
create table if not exists public.plateforme_reglages (
  id int primary key default 1 check (id = 1),
  raison_sociale text not null default 'PumpIT Solutions',
  adresse text, telephone text, email text, rccm text, ifu text,
  coordonnees_bancaires text,
  taux_tva numeric not null default 0 check (taux_tva >= 0 and taux_tva < 100),
  prefixe_facture text not null default 'PI'
);
insert into public.plateforme_reglages(id) values (1) on conflict (id) do nothing;

create sequence if not exists public.facture_numero_seq;

create table if not exists public.factures (
  id bigint generated by default as identity primary key,
  numero text not null unique,
  organisation_id bigint not null references public.organisations(id),
  date_emission date not null default current_date,
  periode_debut date not null,
  periode_fin date not null,
  formule text not null,
  designation text not null,
  quantite numeric not null check (quantite > 0),
  prix_unitaire numeric not null,
  montant_ht numeric not null,
  taux_tva numeric not null default 0,
  montant_tva numeric not null default 0,
  montant_ttc numeric not null,
  statut text not null default 'emise' check (statut in ('emise', 'payee', 'annulee')),
  paye_le date, mode_paiement text, reference_paiement text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (periode_fin >= periode_debut)
);
create index if not exists idx_factures_org on public.factures(organisation_id, periode_debut desc);

alter table public.plateforme_reglages enable row level security;
alter table public.factures enable row level security;
grant select, insert, update, delete on public.plateforme_reglages, public.factures to authenticated;
revoke all on public.plateforme_reglages, public.factures, public.formules from anon;

-- L'émetteur figure sur les factures : lisible par tout compte connecté.
drop policy if exists p_plateforme_sel on public.plateforme_reglages;
create policy p_plateforme_sel on public.plateforme_reglages for select to authenticated using (true);
drop policy if exists p_plateforme_write on public.plateforme_reglages;
create policy p_plateforme_write on public.plateforme_reglages for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- Un client lit ses propres factures (son administrateur seulement), même
-- suspendu. La plateforme lit et écrit tout.
drop policy if exists p_factures_sel on public.factures;
create policy p_factures_sel on public.factures for select to authenticated
  using ((select public.is_platform_admin())
      or (organisation_id = (select public.my_organisation_id()) and (select public.is_admin())));
drop policy if exists p_factures_write on public.factures;
create policy p_factures_write on public.factures for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- Émet une facture d'abonnement de p_mois mois à partir de p_debut,
-- au prix de la formule du client.
create or replace function public.emettre_facture(p_org bigint, p_debut date, p_mois int default 1)
returns public.factures language plpgsql security definer set search_path = public as $$
declare o organisations; f formules; r plateforme_reglages; v factures; ht numeric; tva numeric;
begin
  if not public.is_platform_admin() then raise exception 'Réservé à l''administrateur de la plateforme.'; end if;
  if p_mois is null or p_mois < 1 or p_mois > 24 then raise exception 'Nombre de mois invalide (1 à 24).'; end if;
  if p_debut is null then raise exception 'La date de début est obligatoire.'; end if;
  select * into o from organisations where id = p_org;
  if not found then raise exception 'Client inconnu.'; end if;
  select * into f from formules where key = o.formule;
  select * into r from plateforme_reglages where id = 1;
  ht := f.prix_mensuel * p_mois;
  tva := round(ht * coalesce(r.taux_tva, 0) / 100);
  insert into factures(numero, organisation_id, periode_debut, periode_fin, formule, designation,
                       quantite, prix_unitaire, montant_ht, taux_tva, montant_tva, montant_ttc)
  values (
    coalesce(r.prefixe_facture, 'PI') || '-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('facture_numero_seq')::text, 5, '0'),
    p_org, p_debut, (p_debut + make_interval(months => p_mois) - interval '1 day')::date, f.key,
    'Abonnement PumpIT ' || f.label || ' (mensuel)',
    p_mois, f.prix_mensuel, ht, coalesce(r.taux_tva, 0), tva, ht + tva)
  returning * into v;
  return v;
end; $$;
revoke execute on function public.emettre_facture(bigint, date, int) from anon;

-- Encaisse une facture : l'abonnement est prolongé jusqu'à la fin de la
-- période facturée et le client, s'il était suspendu, est réactivé.
create or replace function public.encaisser_facture(p_facture bigint, p_date date default current_date,
                                                    p_mode text default null, p_reference text default null)
returns public.factures language plpgsql security definer set search_path = public as $$
declare v factures;
begin
  if not public.is_platform_admin() then raise exception 'Réservé à l''administrateur de la plateforme.'; end if;
  update factures set statut = 'payee', paye_le = coalesce(p_date, current_date),
         mode_paiement = nullif(trim(p_mode), ''), reference_paiement = nullif(trim(p_reference), '')
  where id = p_facture and statut = 'emise' returning * into v;
  if not found then raise exception 'Facture introuvable, déjà payée ou annulée.'; end if;
  update organisations
     set abonnement_jusqu_au = greatest(coalesce(abonnement_jusqu_au, v.periode_fin), v.periode_fin),
         statut = 'actif'
   where id = v.organisation_id;
  return v;
end; $$;
revoke execute on function public.encaisser_facture(bigint, date, text, text) from anon;

-- Une facture émise ne se supprime pas (numérotation continue) : elle s'annule.
create or replace function public.annuler_facture(p_facture bigint)
returns public.factures language plpgsql security definer set search_path = public as $$
declare v factures;
begin
  if not public.is_platform_admin() then raise exception 'Réservé à l''administrateur de la plateforme.'; end if;
  update factures set statut = 'annulee' where id = p_facture and statut = 'emise' returning * into v;
  if not found then raise exception 'Seule une facture émise et non payée peut être annulée.'; end if;
  return v;
end; $$;
revoke execute on function public.annuler_facture(bigint) from anon;

-- ------------------------------------------------------------
-- 5. Photos : qui peut lire un fichier ?
-- ------------------------------------------------------------
--  Deux cas, l'un ou l'autre suffit :
--   a) le fichier est dans le dossier d'une station à laquelle le compte a
--      accès (admin du client, sa station, ou ses stations rattachées) ;
--   b) le fichier est référencé par une ligne que le compte a le droit de
--      voir (versement, dépense, pièce jointe…). Couvre les anciens
--      chemins qui ne commencent pas par le numéro de station.
--  La fonction s'exécute avec les droits de l'appelant : le cloisonnement
--  par client et par station s'applique donc à chaque sous-requête.
--  Elle est générée d'après les colonnes « …photo_path » réellement
--  présentes dans la base.
do $$
declare c record; corps text;
begin
  corps := $q$exists (select 1 from public.stations s
                where s.id::text = split_part(p_name, '/', 1)
                  and (public.is_admin() or s.id = public.my_station() or public.has_station_access(s.id)))$q$;
  for c in
    select a.table_name, a.column_name from information_schema.columns a
    join pg_class k on k.relname = a.table_name and k.relnamespace = 'public'::regnamespace and k.relkind = 'r'
    where a.table_schema = 'public' and a.column_name like '%photo_path' and a.data_type = 'text'
    order by 1, 2
  loop
    corps := corps || format(E'\n    or exists (select 1 from public.%I t where t.%I = p_name)', c.table_name, c.column_name);
  end loop;
  execute 'create or replace function public.can_read_photo(p_name text) returns boolean '
       || 'language sql stable security invoker set search_path = public as $f$ select ' || corps || ' $f$';
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "bordereaux_read" on storage.objects;
    create policy "bordereaux_read" on storage.objects for select to authenticated
      using (bucket_id = 'bordereaux' and public.can_read_photo(name));
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Suppression complète d'un client
-- ------------------------------------------------------------
--  Irréversible. Supprime les données, les comptes et le client.
--  Exemple :  select public.delete_organisation(2, 'Nom exact du client');
--  Les fichiers photo ne sont pas supprimés par SQL (Supabase l'interdit) :
--  la fonction renvoie les dossiers à effacer dans Storage.
create or replace function public.delete_organisation(p_org bigint, p_confirmation text)
returns text language plpgsql security definer set search_path = public as $$
declare v_nom text; v_dossiers text; t record; restant int; passe int := 0; v_users uuid[];
begin
  if auth.uid() is not null and not public.is_platform_admin() then
    raise exception 'Réservé à l''administrateur de la plateforme.';
  end if;
  select nom into v_nom from organisations where id = p_org;
  if not found then raise exception 'Client inconnu.'; end if;
  if p_confirmation is distinct from v_nom then
    raise exception 'Confirmation incorrecte : saisissez exactement le nom du client.';
  end if;
  if (select count(*) from organisations) <= 1 then raise exception 'Impossible de supprimer le dernier client.'; end if;
  if exists (select 1 from profiles where organisation_id = p_org and is_platform_admin) then
    raise exception 'Un administrateur de la plateforme travaille dans ce client : ouvrez d''abord un autre client.';
  end if;

  select string_agg(id::text, ', ' order by id) into v_dossiers from stations where organisation_id = p_org;
  select array_agg(id) into v_users from profiles where organisation_id = p_org;

  -- Les profils pointent vers les stations : on détache avant de supprimer.
  alter table public.profiles disable trigger user;
  update profiles set station_id = null where organisation_id = p_org and station_id is not null;
  alter table public.profiles enable trigger user;

  -- Les tables se référencent entre elles : on repasse tant qu'une suppression
  -- est refusée par une clé étrangère.
  loop
    restant := 0; passe := passe + 1;
    for t in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'organisation_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('organisations', 'profiles')
    loop
      begin
        execute format('alter table public.%I disable trigger user', t.relname);
        execute format('delete from public.%I where organisation_id = $1', t.relname) using p_org;
        execute format('alter table public.%I enable trigger user', t.relname);
      exception when foreign_key_violation then
        restant := restant + 1;
      end;
    end loop;
    exit when restant = 0;
    if passe >= 20 then raise exception 'Suppression bloquée par des dépendances entre tables.'; end if;
  end loop;

  alter table public.profiles disable trigger user;
  delete from profiles where organisation_id = p_org;
  alter table public.profiles enable trigger user;
  if v_users is not null then delete from auth.users where id = any(v_users); end if;
  delete from organisations where id = p_org;

  return format('Client « %s » supprimé. Dossiers photo à effacer dans Storage > bordereaux : %s',
                v_nom, coalesce(v_dossiers, 'aucun'));
end; $$;
revoke execute on function public.delete_organisation(bigint, text) from anon;

commit;
