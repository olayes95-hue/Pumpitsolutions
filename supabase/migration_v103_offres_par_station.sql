-- ============================================================
--  v103 : OFFRES PAR STATION ET ACTIVITÉS PAR OFFRE
-- ============================================================
--  À exécuter après la v102. Transactionnel, rejouable.
--
--  1. Chaque station a sa propre offre. Un client peut avoir une station
--     en Complet et deux en Essentiel. L'offre du client (organisations.formule)
--     devient l'offre par défaut de ses nouvelles stations.
--  2. Le prix d'une offre est un prix PAR STATION et par mois. Une facture
--     additionne les stations du client, avec une ligne par offre.
--  3. Chaque offre liste ses activités : carburant, lubrifiants, gaz, supérette.
--  4. Offres réalignées sur la grille commerciale (Essentiel, Pro, Complet).
-- ============================================================

begin;

do $$ begin
  if to_regprocedure('public.agent_can(text)') is null then
    raise exception 'Exécutez d''abord migration_v102_backoffice_complet.sql.';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. Activités par offre, grille commerciale
-- ------------------------------------------------------------
do $$
declare premiere_fois boolean;
begin
  select not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'formules' and column_name = 'activites')
    into premiere_fois;
  alter table public.formules add column if not exists activites text[] not null default array['carburant','lubrifiant','gaz','superette'];
  if premiere_fois then
    -- Grille commerciale. Ces valeurs restent modifiables dans Back-office > Offres.
    update public.formules set activites = array['carburant'],
           fonctions = array['export'],
           description = 'Le carburant, sans WhatsApp ni cahier.'
     where key = 'essentiel';
    update public.formules set activites = array['carburant','lubrifiant','gaz'],
           fonctions = array['export','alertes_completes','prevision'],
           description = 'Carburant, lubrifiants et gaz sous contrôle.'
     where key = 'pro';
    update public.formules set activites = array['carburant','lubrifiant','gaz','superette'],
           fonctions = array['export','alertes_completes','prevision','finance','bordereaux','audit'],
           description = 'Toute la station, toutes les activités.',
           prix_mensuel = case when prix_mensuel = 70000 then 75000 else prix_mensuel end
     where key = 'complet';
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Une offre par station
-- ------------------------------------------------------------
alter table public.stations add column if not exists formule text references public.formules(key);
alter table public.stations disable trigger user;
update public.stations s set formule = o.formule
  from public.organisations o where o.id = s.organisation_id and s.formule is null;
alter table public.stations enable trigger user;
alter table public.stations alter column formule set not null;
create index if not exists idx_stations_formule on public.stations(formule);

-- Nouvelle station : elle prend l'offre par défaut de son client.
-- L'offre d'une station ne se change que depuis le back-office (permission « clients ») :
-- sans ce garde-fou, l'administrateur d'un client pourrait choisir lui-même son offre.
create or replace function public.station_offre()
returns trigger language plpgsql set search_path = public as $$   -- pas « security definer » : current_user doit rester celui de l'appelant
declare v_defaut text;
begin
  if tg_op = 'INSERT' then
    if new.formule is null or (current_user = 'authenticated' and not public.agent_can('clients')) then
      select formule into v_defaut from organisations where id = coalesce(new.organisation_id, public.current_org_id());
      new.formule := coalesce(v_defaut, new.formule);
    end if;
  elsif new.formule is distinct from old.formule
        and current_user = 'authenticated' and not public.agent_can('clients') then
    raise exception 'L''offre d''une station se modifie dans le back-office PumpIT.';
  end if;
  return new;
end; $$;
revoke execute on function public.station_offre() from anon, authenticated;

-- Le nom du trigger le place après trg_set_organisation (ordre alphabétique) :
-- l'organisation de la station est déjà connue quand il s'exécute.
drop trigger if exists trg_station_offre on public.stations;
create trigger trg_station_offre before insert or update on public.stations
  for each row execute function public.station_offre();

-- Changer l'offre d'une station depuis le back-office, sans avoir à « ouvrir » le client.
create or replace function public.station_definir_offre(p_station bigint, p_formule text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.agent_can('clients') then raise exception 'Permission « clients » requise.'; end if;
  if not exists (select 1 from formules where key = p_formule) then raise exception 'Offre inconnue : %', p_formule; end if;
  update stations set formule = p_formule where id = p_station;
  if not found then raise exception 'Station inconnue.'; end if;
end; $$;
revoke execute on function public.station_definir_offre(bigint, text) from anon;

-- ------------------------------------------------------------
-- 3. Facturation : prix par station, une ligne par offre
-- ------------------------------------------------------------
alter table public.factures add column if not exists lignes jsonb;

create or replace function public.emettre_facture(p_org bigint, p_debut date, p_mois int default 1)
returns public.factures language plpgsql security definer set search_path = public as $$
declare o organisations; r plateforme_reglages; v factures;
        v_lignes jsonb; ht numeric; tva numeric; v_nb bigint;
begin
  if not public.agent_can('facturation') then raise exception 'Permission « facturation » requise.'; end if;
  if p_mois is null or p_mois < 1 or p_mois > 24 then raise exception 'Nombre de mois invalide (1 à 24).'; end if;
  if p_debut is null then raise exception 'La date de début est obligatoire.'; end if;
  select * into o from organisations where id = p_org;
  if not found then raise exception 'Client inconnu.'; end if;
  select * into r from plateforme_reglages where id = 1;

  -- Une ligne par offre payante : quantité = stations × mois, prix unitaire = prix mensuel de l'offre.
  select jsonb_agg(jsonb_build_object(
           'designation', 'Abonnement PumpIT ' || x.label || ' : ' || x.noms,
           'quantite', x.n * p_mois, 'prix_unitaire', x.prix, 'montant', x.n * p_mois * x.prix) order by x.ordre, x.label),
         sum(x.n * p_mois * x.prix), sum(x.n)
    into v_lignes, ht, v_nb
  from (
    select f.label, f.ordre, f.prix_mensuel as prix, count(*) as n, string_agg(s.nom, ', ' order by s.nom) as noms
    from stations s join formules f on f.key = s.formule
    where s.organisation_id = p_org and f.prix_mensuel > 0
    group by f.key, f.label, f.ordre, f.prix_mensuel
  ) x;
  if v_lignes is null then raise exception 'Aucune station payante à facturer pour ce client.'; end if;

  tva := round(ht * coalesce(r.taux_tva, 0) / 100);
  insert into factures(numero, organisation_id, periode_debut, periode_fin, formule, designation,
                       quantite, prix_unitaire, montant_ht, taux_tva, montant_tva, montant_ttc, lignes)
  values (
    coalesce(r.prefixe_facture, 'PI') || '-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('facture_numero_seq')::text, 5, '0'),
    p_org, p_debut, (p_debut + make_interval(months => p_mois) - interval '1 day')::date, o.formule,
    'Abonnement PumpIT, ' || v_nb || ' station' || case when v_nb > 1 then 's' else '' end,
    p_mois, ht / p_mois, ht, coalesce(r.taux_tva, 0), tva, ht + tva, v_lignes)
  returning * into v;
  return v;
end; $$;

-- ------------------------------------------------------------
-- 4. Supervision et statistiques : par station
-- ------------------------------------------------------------
drop function if exists public.bo_supervision();
create or replace function public.bo_supervision()
returns table (
  id bigint, nom text, formule text, statut text, abonnement_jusqu_au date, essai_jusqu_au date, acces boolean,
  code_invitation text, created_at timestamptz,
  nb_stations bigint, stations_a_jour bigint, nb_comptes bigint, comptes_en_attente bigint,
  derniere_activite timestamptz, rappels_ouverts bigint,
  factures_impayees bigint, montant_impaye numeric, demandes_ouvertes bigint, montant_mensuel numeric
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
    (select count(*) from assistance_demandes d where d.organisation_id = o.id and d.statut <> 'resolue'),
    (select coalesce(sum(f.prix_mensuel), 0) from stations s join formules f on f.key = s.formule where s.organisation_id = o.id)
  from organisations o
  order by o.nom;
end; $$;
revoke execute on function public.bo_supervision() from anon;

drop function if exists public.bo_stations();
create or replace function public.bo_stations()
returns table (station_id bigint, station text, organisation_id bigint, client text,
               derniere_saisie timestamptz, saisies_7j bigint, etat text, formule text, prix_mensuel numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.agent_can('supervision') then raise exception 'Permission « supervision » requise.'; end if;
  return query
  select s.id, s.nom, o.id, o.nom, x.derniere, coalesce(x.n7, 0),
    case when x.aujourdhui then 'a_jour'
         when x.derniere >= now() - interval '7 days' then 'en_retard'
         else 'inactive' end,
    s.formule, f.prix_mensuel
  from stations s join organisations o on o.id = s.organisation_id
  join formules f on f.key = s.formule
  left join lateral (
    select max(sub.created_at) as derniere,
           count(*) filter (where sub.report_date >= current_date - 6) as n7,
           bool_or(sub.report_date = current_date) as aujourdhui
    from submissions sub where sub.station_id = s.id
  ) x on true
  order by o.nom, s.nom;
end; $$;
revoke execute on function public.bo_stations() from anon;

commit;
