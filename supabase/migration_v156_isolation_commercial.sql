-- ============================================================
--  MIGRATION v156 — Isolation des données clients pour le rôle "commercial".
--
--  Trou de sécurité trouvé en vérifiant le périmètre réel d'un agent
--  "commercial" (permissions par défaut : {supervision, clients}) :
--  - La policy RLS p_org_sel sur `organisations` autorisait TOUT agent
--    (is_agent() = true dès que plateforme_role n'est pas null) à lire
--    la table entière, sans filtre sur organisations.apporte_par.
--    -> Clients.jsx (back-office, perm "clients") affichait donc TOUS
--    les clients de la plateforme à un commercial, pas seulement les siens.
--  - bo_supervision()/bo_stations()/bo_activite() (RPC SECURITY DEFINER
--    utilisées par Stats.jsx, perm "supervision") ne vérifiaient que
--    agent_can('supervision'), sans aucun filtre par agent apporteur.
--    -> Stats.jsx affichait le chiffre d'affaires et l'activité de
--    TOUTE la plateforme à un commercial.
--
--  Seules les vues de commission (v_commission_commerciale,
--  v_solde_commission_agent, migration_v153) étaient déjà correctement
--  isolées (filtre explicite agent_id = auth.uid() pour qui n'a pas la
--  permission "agents").
--
--  Règle appliquée partout ci-dessous, via la fonction agent_scope_visible() :
--  un agent voit tout (comme avant) SAUF s'il a le rôle "commercial" ET
--  n'a pas la permission "agents" (qui reste le niveau "backoffice admin",
--  cohérent avec migration_v153) — dans ce cas il ne voit que les
--  organisations dont il est l'apporteur (organisations.apporte_par).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v155).
-- ============================================================

begin;

create or replace function public.agent_scope_visible(p_apporte_par uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    case
      when public.agent_can('agents') then true
      when (select p.plateforme_role from public.profiles p where p.id = auth.uid()) is distinct from 'commercial' then true
      else p_apporte_par = auth.uid()
    end
$$;

-- organisations : Clients.jsx (perm "clients") interroge cette table directement.
drop policy if exists p_org_sel on public.organisations;
create policy p_org_sel on public.organisations for select to authenticated
  using (id = my_organisation_id() or public.agent_scope_visible(apporte_par));

-- p_org_write est déclarée FOR ALL (pas FOR UPDATE) : sa clause USING s'applique donc
-- AUSSI au SELECT (combinée en OR avec p_org_sel ci-dessus) — c'est en réalité LA fuite
-- réelle, indépendante de p_org_sel : agent_can('clients') seul (vrai pour "commercial"
-- par défaut) suffisait à lire toute la table, sans aucun filtre apporte_par.
drop policy if exists p_org_write on public.organisations;
create policy p_org_write on public.organisations for all to authenticated
  using (public.agent_can('clients') and public.agent_scope_visible(apporte_par))
  with check (public.agent_can('clients') and public.agent_scope_visible(apporte_par));

drop function if exists public.bo_supervision();
create or replace function public.bo_supervision()
returns table (
  id bigint, nom text, formule text, statut text, abonnement_jusqu_au date, essai_jusqu_au date,
  accessible boolean, code_invitation text, created_at timestamptz,
  nb_stations bigint, nb_actives_aujourdhui bigint, nb_approuves bigint, nb_en_attente bigint,
  derniere_activite timestamptz, nb_alertes bigint, nb_factures_impayees bigint,
  total_factures_impayees numeric, nb_demandes_ouvertes bigint, revenu_mensuel numeric
) language plpgsql security definer set search_path = public as $$
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
  where public.agent_scope_visible(o.apporte_par)
  order by o.nom;
end; $$;

drop function if exists public.bo_stations();
create or replace function public.bo_stations()
returns table (
  station_id bigint, station_nom text, organisation_id bigint, organisation_nom text,
  derniere timestamptz, n7 bigint, etat text, formule text, prix_mensuel numeric
) language plpgsql security definer set search_path = public as $$
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
  where public.agent_scope_visible(o.apporte_par)
  order by o.nom, s.nom;
end; $$;

drop function if exists public.bo_activite(int);
create or replace function public.bo_activite(p_jours int default 30)
returns table (jour date, nb_saisies bigint, nb_stations bigint, nb_organisations bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.agent_can('supervision') then raise exception 'Permission « supervision » requise.'; end if;
  return query
  select d::date,
    (select count(*) from submissions sub join organisations o on o.id = sub.organisation_id
       where sub.report_date = d::date and public.agent_scope_visible(o.apporte_par)),
    (select count(distinct sub.station_id) from submissions sub join organisations o on o.id = sub.organisation_id
       where sub.report_date = d::date and public.agent_scope_visible(o.apporte_par)),
    (select count(distinct sub.organisation_id) from submissions sub join organisations o on o.id = sub.organisation_id
       where sub.report_date = d::date and public.agent_scope_visible(o.apporte_par))
  from generate_series(current_date - (greatest(least(coalesce(p_jours, 30), 365), 1) - 1), current_date, interval '1 day') d
  order by 1;
end; $$;

commit;
