-- ============================================================
--  v102 : BACK-OFFICE COMPLET
--         agents PumpIT, offres paramétrables, période d'essai,
--         comptabilité et statistiques
-- ============================================================
--  À exécuter après la v99. Transactionnel, rejouable tant que la v103 n'est pas appliquée.
--
--  1. Agents PumpIT : plusieurs personnes gèrent la plateforme, chacune
--     avec un rôle (super administrateur, support, comptable, commercial).
--     Chaque rôle porte une liste de permissions. `is_platform_admin()`
--     désigne désormais le super administrateur.
--  2. Offres : création, modification, désactivation, suppression. Les
--     fonctions incluses dans chaque offre se règlent dans le back-office.
--  3. Période d'essai : durée par défaut, offre appliquée pendant l'essai,
--     blocage automatique ou simple signalement à la fin.
--  4. Statistiques : état de chaque station, activité par jour.
-- ============================================================

begin;

-- Garde-fou : une fois la v103 appliquée, ce script ne doit plus être rejoué
-- (il écraserait la facturation par station et les statistiques).
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'stations' and column_name = 'formule') then
    raise exception 'La v103 est déjà appliquée : ne rejouez pas ce script. Seule la v103 se rejoue.';
  end if;
end $$;

do $$ begin
  if to_regprocedure('public.assistance_role(bigint)') is null then
    raise exception 'Exécutez d''abord migration_v99_backoffice_assistance.sql.';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. Agents PumpIT
-- ------------------------------------------------------------
--  Permissions :
--    supervision   voir la supervision et les statistiques
--    clients       créer et modifier les clients, suspendre, gérer les essais
--    offres        gérer les offres et leurs fonctions
--    facturation   factures, encaissements, comptabilité
--    assistance    répondre aux demandes
--    ouvrir_client entrer dans l'application d'un client (accès à ses données)
--    reglages      réglages de la plateforme
--    agents        gérer l'équipe PumpIT
create table if not exists public.plateforme_roles (
  key text primary key,
  label text not null,
  description text,
  permissions text[] not null default '{}',
  ordre int not null default 0
);
insert into public.plateforme_roles(key, label, description, permissions, ordre) values
  ('super_admin', 'Super administrateur', 'Tous les droits, dont la gestion de l''équipe.',
     array['supervision','clients','offres','facturation','assistance','ouvrir_client','reglages','agents'], 1),
  ('support', 'Support', 'Répond aux demandes et peut entrer chez un client pour l''aider.',
     array['supervision','assistance','ouvrir_client'], 2),
  ('comptable', 'Comptable', 'Factures, encaissements et comptabilité. Ne voit pas les données des clients.',
     array['supervision','facturation'], 3),
  ('commercial', 'Commercial', 'Crée les clients, gère les essais et les offres souscrites.',
     array['supervision','clients'], 4)
on conflict (key) do nothing;

alter table public.profiles add column if not exists plateforme_role text references public.plateforme_roles(key);
alter table public.profiles disable trigger user;
update public.profiles set plateforme_role = 'super_admin' where is_platform_admin and plateforme_role is null;
alter table public.profiles enable trigger user;

create or replace function public.is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and plateforme_role is not null);
$$;

create or replace function public.agent_can(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.plateforme_roles r on r.key = p.plateforme_role
    where p.id = auth.uid() and p_permission = any(r.permissions));
$$;

-- Le super administrateur. Conservé sous ce nom : les scripts précédents s'y réfèrent.
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and plateforme_role = 'super_admin');
$$;

create or replace function public.mes_permissions_plateforme()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select r.permissions from public.profiles p join public.plateforme_roles r on r.key = p.plateforme_role
                   where p.id = auth.uid()), '{}'::text[]);
$$;
revoke execute on function public.is_agent(), public.agent_can(text), public.mes_permissions_plateforme() from anon;

alter table public.plateforme_roles enable row level security;
revoke all on public.plateforme_roles from anon;
grant select, insert, update, delete on public.plateforme_roles to authenticated;
drop policy if exists p_plateforme_roles_sel on public.plateforme_roles;
create policy p_plateforme_roles_sel on public.plateforme_roles for select to authenticated using ((select public.is_agent()));
drop policy if exists p_plateforme_roles_write on public.plateforme_roles;
create policy p_plateforme_roles_write on public.plateforme_roles for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- ------------------------------------------------------------
-- 2. Offres : fonctions paramétrables
-- ------------------------------------------------------------
create table if not exists public.fonctions_catalogue (
  key text primary key,
  label text not null,
  description text,
  ordre int not null default 0
);
insert into public.fonctions_catalogue(key, label, description, ordre) values
  ('alertes_completes', 'Alertes anti-fraude complètes', 'Écart compteur, coulage, perte à la livraison, bons inexpliqués, écart d''inventaire.', 1),
  ('prevision', 'Prévision de commande', 'Quantités à commander et date de rupture estimée.', 2),
  ('finance', 'Point financier et rapprochement', 'Charges, résultat mensuel, rapprochement bancaire.', 3),
  ('bordereaux', 'Vérification des bordereaux', 'Lecture automatique des photos de bordereaux et contrôle du montant.', 4),
  ('export', 'Export des données', 'Téléchargement de l''historique au format CSV.', 5),
  ('audit', 'Journal d''audit', 'Historique de toutes les modifications.', 6)
on conflict (key) do nothing;

do $$
declare premiere_fois boolean;
begin
  select not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'formules' and column_name = 'fonctions')
    into premiere_fois;
  alter table public.formules add column if not exists description text;
  alter table public.formules add column if not exists actif boolean not null default true;
  alter table public.formules add column if not exists fonctions text[] not null default '{}';
  if premiere_fois then
    -- Répartition d'origine (plan commercial) : chaque offre contient la précédente.
    update public.formules set fonctions = array['alertes_completes','prevision'] where key = 'pro';
    update public.formules set fonctions = array['alertes_completes','prevision','finance','bordereaux','export','audit'] where key = 'complet';
  end if;
end $$;

alter table public.fonctions_catalogue enable row level security;
revoke all on public.fonctions_catalogue from anon;
grant select, insert, update, delete on public.fonctions_catalogue to authenticated;
drop policy if exists p_fonctions_sel on public.fonctions_catalogue;
create policy p_fonctions_sel on public.fonctions_catalogue for select to authenticated using (true);
drop policy if exists p_fonctions_write on public.fonctions_catalogue;
create policy p_fonctions_write on public.fonctions_catalogue for all to authenticated
  using ((select public.agent_can('offres'))) with check ((select public.agent_can('offres')));

drop policy if exists p_formules_write on public.formules;
create policy p_formules_write on public.formules for all to authenticated
  using ((select public.agent_can('offres'))) with check ((select public.agent_can('offres')));

-- ------------------------------------------------------------
-- 3. Période d'essai
-- ------------------------------------------------------------
alter table public.plateforme_reglages add column if not exists essai_jours int not null default 30 check (essai_jours between 0 and 365);
alter table public.plateforme_reglages add column if not exists essai_formule text references public.formules(key);
alter table public.plateforme_reglages add column if not exists suspendre_fin_essai boolean not null default true;
alter table public.organisations add column if not exists essai_jusqu_au date;

-- Un client a-t-il accès à ses données ?
--   - non s'il est suspendu ;
--   - non si son essai est terminé, qu'aucun abonnement réglé ne couvre aujourd'hui
--     et que le réglage « bloquer à la fin de l'essai » est actif.
-- Encaisser une facture met fin à l'essai (voir encaisser_facture) : un client
-- devenu payant n'est plus jamais bloqué automatiquement, seulement signalé en retard.
create or replace function public.organisation_accessible(o public.organisations)
returns boolean language sql stable security definer set search_path = public as $$
  select o.statut = 'actif'
     and (o.essai_jusqu_au is null
          or o.essai_jusqu_au >= current_date
          or coalesce(o.abonnement_jusqu_au >= current_date, false)
          or not coalesce((select suspendre_fin_essai from public.plateforme_reglages where id = 1), true));
$$;

create or replace function public.current_org_id()
returns bigint language sql stable security definer set search_path = public as $$
  select p.organisation_id
  from public.profiles p join public.organisations o on o.id = p.organisation_id
  where p.id = auth.uid()
    and (p.plateforme_role is not null or (p.approved and public.organisation_accessible(o)));
$$;

-- ------------------------------------------------------------
-- 4. Règles d'accès revues pour les agents
-- ------------------------------------------------------------
-- Profils : un agent PumpIT n'apparaît pas dans l'équipe d'un client, même
-- lorsqu'il est « entré » chez lui. Un client ne peut donc ni le voir ni le modifier.
drop policy if exists tenant_isolation on public.profiles;
create policy tenant_isolation on public.profiles as restrictive for all
  using (
    id = auth.uid()
    or (organisation_id = (select public.current_org_id()) and (plateforme_role is null or (select public.is_agent())))
    or (organisation_id is null and plateforme_role is null and (select public.agent_can('clients')))
    or (plateforme_role is not null and (select public.agent_can('agents')))
  )
  with check (
    id = auth.uid()
    or (organisation_id = (select public.current_org_id()) and plateforme_role is null)
    or (select public.agent_can('clients'))
    or (select public.agent_can('agents'))
  );

-- Ni l'organisation, ni le rôle d'agent ne se modifient directement depuis
-- l'application : seules les fonctions ci-dessous le font.
create or replace function public.prevent_org_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    if new.is_platform_admin is distinct from old.is_platform_admin
       or new.plateforme_role is distinct from old.plateforme_role then
      raise exception 'Le rôle d''agent PumpIT se gère dans le back-office, rubrique Équipe.';
    end if;
    if new.organisation_id is distinct from old.organisation_id then
      raise exception 'L''organisation d''un compte ne se modifie pas directement.';
    end if;
  end if;
  return new;
end; $$;

drop policy if exists p_org_sel on public.organisations;
create policy p_org_sel on public.organisations for select to authenticated
  using (id = (select public.my_organisation_id()) or (select public.is_agent()));
drop policy if exists p_org_write on public.organisations;
create policy p_org_write on public.organisations for all to authenticated
  using ((select public.agent_can('clients'))) with check ((select public.agent_can('clients')));

drop policy if exists p_plateforme_write on public.plateforme_reglages;
create policy p_plateforme_write on public.plateforme_reglages for all to authenticated
  using ((select public.agent_can('reglages'))) with check ((select public.agent_can('reglages')));

drop policy if exists p_factures_sel on public.factures;
create policy p_factures_sel on public.factures for select to authenticated
  using ((select public.agent_can('facturation'))
      or (organisation_id = (select public.my_organisation_id()) and (select public.is_admin())));
drop policy if exists p_factures_write on public.factures;
create policy p_factures_write on public.factures for all to authenticated
  using ((select public.agent_can('facturation'))) with check ((select public.agent_can('facturation')));

drop policy if exists p_assistance_demandes_sel on public.assistance_demandes;
create policy p_assistance_demandes_sel on public.assistance_demandes for select to authenticated
  using ((select public.agent_can('assistance'))
      or (organisation_id = (select public.my_organisation_id())
          and (created_by = auth.uid() or (select public.is_admin()))));

create or replace function public.assistance_role(p_demande bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.agent_can('assistance') then 'plateforme'
    when d.organisation_id = public.my_organisation_id()
         and (d.created_by = auth.uid() or public.is_admin())
         and exists (select 1 from profiles p where p.id = auth.uid() and p.approved) then 'client'
  end
  from assistance_demandes d where d.id = p_demande;
$$;

-- ------------------------------------------------------------
-- 5. Fonctions de gestion, par permission
-- ------------------------------------------------------------
drop function if exists public.create_organisation(text, text);
create or replace function public.create_organisation(p_nom text, p_formule text default 'pro', p_essai boolean default false)
returns public.organisations language plpgsql security definer set search_path = public as $$
declare v_org public.organisations; v_jours int; v_modele bigint;
begin
  if not public.agent_can('clients') then raise exception 'Permission « clients » requise.'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Le nom du client est obligatoire.'; end if;
  if not exists (select 1 from formules where key = p_formule and actif) then raise exception 'Offre inconnue ou désactivée : %', p_formule; end if;
  select essai_jours into v_jours from plateforme_reglages where id = 1;
  insert into organisations(nom, formule, essai_jusqu_au)
  values (trim(p_nom), p_formule, case when p_essai and coalesce(v_jours, 0) > 0 then current_date + v_jours end)
  returning * into v_org;
  -- Réglages de départ : ceux du client ouvert, sinon ceux du premier client.
  v_modele := coalesce(public.current_org_id(), (select min(organisation_id) from settings));
  insert into settings
  select (jsonb_populate_record(null::settings, to_jsonb(s) || jsonb_build_object('organisation_id', v_org.id))).*
  from settings s where s.organisation_id = v_modele;
  if not found then
    insert into settings(id, organisation_id) values (1, v_org.id);
  end if;
  return v_org;
end; $$;
revoke execute on function public.create_organisation(text, text, boolean) from anon;

create or replace function public.switch_organisation(p_org bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.agent_can('ouvrir_client') then raise exception 'Permission « ouvrir un client » requise.'; end if;
  if not exists (select 1 from organisations where id = p_org) then raise exception 'Organisation inconnue.'; end if;
  update profiles set organisation_id = p_org, station_id = null where id = auth.uid();
  delete from profile_stations where profile_id = auth.uid();
end; $$;

create or replace function public.assign_organisation(p_profile uuid, p_org bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.agent_can('clients') then raise exception 'Permission « clients » requise.'; end if;
  if not exists (select 1 from organisations where id = p_org) then raise exception 'Organisation inconnue.'; end if;
  if exists (select 1 from profiles where id = p_profile and plateforme_role is not null) then
    raise exception 'Ce compte est un agent PumpIT.';
  end if;
  update profiles set organisation_id = p_org, station_id = null where id = p_profile;
  delete from profile_stations where profile_id = p_profile;
end; $$;

create or replace function public.emettre_facture(p_org bigint, p_debut date, p_mois int default 1)
returns public.factures language plpgsql security definer set search_path = public as $$
declare o organisations; f formules; r plateforme_reglages; v factures; ht numeric; tva numeric;
begin
  if not public.agent_can('facturation') then raise exception 'Permission « facturation » requise.'; end if;
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

-- Encaisser : prolonge l'abonnement, réactive le client et met fin à l'essai.
create or replace function public.encaisser_facture(p_facture bigint, p_date date default current_date,
                                                    p_mode text default null, p_reference text default null)
returns public.factures language plpgsql security definer set search_path = public as $$
declare v factures;
begin
  if not public.agent_can('facturation') then raise exception 'Permission « facturation » requise.'; end if;
  update factures set statut = 'payee', paye_le = coalesce(p_date, current_date),
         mode_paiement = nullif(trim(p_mode), ''), reference_paiement = nullif(trim(p_reference), '')
  where id = p_facture and statut = 'emise' returning * into v;
  if not found then raise exception 'Facture introuvable, déjà payée ou annulée.'; end if;
  update organisations
     set abonnement_jusqu_au = greatest(coalesce(abonnement_jusqu_au, v.periode_fin), v.periode_fin),
         statut = 'actif', essai_jusqu_au = null
   where id = v.organisation_id;
  return v;
end; $$;

create or replace function public.annuler_facture(p_facture bigint)
returns public.factures language plpgsql security definer set search_path = public as $$
declare v factures;
begin
  if not public.agent_can('facturation') then raise exception 'Permission « facturation » requise.'; end if;
  update factures set statut = 'annulee' where id = p_facture and statut = 'emise' returning * into v;
  if not found then raise exception 'Seule une facture émise et non payée peut être annulée.'; end if;
  return v;
end; $$;

-- Équipe PumpIT : liste, ajout par e-mail, changement de rôle, retrait (p_role = NULL).
create or replace function public.bo_agents()
returns table (id uuid, full_name text, email text, plateforme_role text, organisation_id bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.agent_can('agents') then raise exception 'Permission « équipe » requise.'; end if;
  return query
  select p.id, p.full_name, u.email::text, p.plateforme_role, p.organisation_id
  from profiles p join auth.users u on u.id = p.id
  where p.plateforme_role is not null order by p.full_name;
end; $$;
revoke execute on function public.bo_agents() from anon;

create or replace function public.agent_definir(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ancien text;
begin
  if not public.agent_can('agents') then raise exception 'Permission « équipe » requise.'; end if;
  if p_role is not null and not exists (select 1 from plateforme_roles where key = p_role) then
    raise exception 'Rôle inconnu : %', p_role;
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'Aucun compte avec cet e-mail. La personne doit d''abord créer son compte sur l''écran de connexion.';
  end if;
  if v_id = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle.'; end if;
  select plateforme_role into v_ancien from profiles where id = v_id;
  if v_ancien = 'super_admin' and p_role is distinct from 'super_admin'
     and (select count(*) from profiles where plateforme_role = 'super_admin') <= 1 then
    raise exception 'Il doit rester au moins un super administrateur.';
  end if;
  alter table public.profiles disable trigger user;
  update profiles set plateforme_role = p_role, is_platform_admin = (p_role is not distinct from 'super_admin'),
         approved = case when p_role is not null then true else approved end
  where id = v_id;
  alter table public.profiles enable trigger user;
end; $$;
revoke execute on function public.agent_definir(text, text) from anon;

-- ------------------------------------------------------------
-- 6. Supervision et statistiques
-- ------------------------------------------------------------
drop function if exists public.bo_supervision();
create or replace function public.bo_supervision()
returns table (
  id bigint, nom text, formule text, statut text, abonnement_jusqu_au date, essai_jusqu_au date, acces boolean,
  code_invitation text, created_at timestamptz,
  nb_stations bigint, stations_a_jour bigint, nb_comptes bigint, comptes_en_attente bigint,
  derniere_activite timestamptz, rappels_ouverts bigint,
  factures_impayees bigint, montant_impaye numeric, demandes_ouvertes bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.agent_can('supervision') then raise exception 'Permission « supervision » requise.'; end if;
  return query
  select o.id, o.nom, o.formule, o.statut, o.abonnement_jusqu_au, o.essai_jusqu_au, public.organisation_accessible(o),
    o.code_invitation, o.created_at,
    (select count(*) from stations s where s.organisation_id = o.id),
    (select count(distinct sub.station_id) from submissions sub where sub.organisation_id = o.id and sub.report_date = current_date),
    (select count(*) from profiles p where p.organisation_id = o.id and p.approved and p.plateforme_role is null),
    (select count(*) from profiles p where p.organisation_id = o.id and not p.approved and p.plateforme_role is null),
    (select max(sub.created_at) from submissions sub where sub.organisation_id = o.id),
    (select count(*) from notifications n where n.organisation_id = o.id and not n.resolved),
    (select count(*) from factures f where f.organisation_id = o.id and f.statut = 'emise'),
    (select coalesce(sum(f.montant_ttc), 0) from factures f where f.organisation_id = o.id and f.statut = 'emise'),
    (select count(*) from assistance_demandes d where d.organisation_id = o.id and d.statut <> 'resolue')
  from organisations o
  order by o.nom;
end; $$;
revoke execute on function public.bo_supervision() from anon;

-- État de chaque station, tous clients confondus.
--   a_jour    : au moins une saisie aujourd'hui
--   en_retard : dernière saisie dans les 7 derniers jours
--   inactive  : aucune saisie depuis plus de 7 jours (ou jamais)
create or replace function public.bo_stations()
returns table (station_id bigint, station text, organisation_id bigint, client text,
               derniere_saisie timestamptz, saisies_7j bigint, etat text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.agent_can('supervision') then raise exception 'Permission « supervision » requise.'; end if;
  return query
  select s.id, s.nom, o.id, o.nom, x.derniere, coalesce(x.n7, 0),
    case when x.aujourdhui then 'a_jour'
         when x.derniere >= now() - interval '7 days' then 'en_retard'
         else 'inactive' end
  from stations s join organisations o on o.id = s.organisation_id
  left join lateral (
    select max(sub.created_at) as derniere,
           count(*) filter (where sub.report_date >= current_date - 6) as n7,
           bool_or(sub.report_date = current_date) as aujourdhui
    from submissions sub where sub.station_id = s.id
  ) x on true
  order by o.nom, s.nom;
end; $$;
revoke execute on function public.bo_stations() from anon;

-- Activité par jour sur les p_jours derniers jours.
create or replace function public.bo_activite(p_jours int default 30)
returns table (jour date, saisies bigint, stations bigint, clients bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.agent_can('supervision') then raise exception 'Permission « supervision » requise.'; end if;
  return query
  select d::date,
    (select count(*) from submissions sub where sub.report_date = d::date),
    (select count(distinct sub.station_id) from submissions sub where sub.report_date = d::date),
    (select count(distinct sub.organisation_id) from submissions sub where sub.report_date = d::date)
  from generate_series(current_date - (greatest(least(coalesce(p_jours, 30), 365), 1) - 1), current_date, interval '1 day') d
  order by 1;
end; $$;
revoke execute on function public.bo_activite(int) from anon;

commit;
