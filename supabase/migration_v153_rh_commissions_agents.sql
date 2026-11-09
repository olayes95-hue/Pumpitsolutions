-- ============================================================
--  MIGRATION v153 — Module RH pour l'équipe PumpIT (agents : support,
--  comptable, commercial, super_admin), incluant salaire et commission
--  commerciale.
--
--  Réutilise les colonnes RH déjà posées sur profiles pour les employés
--  de station (contrat_type, contrat_fin, cnss_declare,
--  assurance_maladie_fin, visite_medicale_le, visite_medicale_mois —
--  migration_v145) : génériques, pas spécifiques à une station, donc
--  directement applicables à un agent plateforme. Seuls salaire_mensuel
--  et les deux champs de commission sont nouveaux.
--
--  Commission commerciale (recurrent % sur chaque facture, ou unique à
--  la signature — choix PAR AGENT, pas un seul mode global) : dérivée de
--  organisations.apporte_par (qui a ramené ce client) × factures,
--  jamais stockée (même philosophie que v_solde_client/v_dette_personnel).
--  Un versement effectif (paiement réel au commercial) se enregistre à
--  part, dans agent_commission_versements, avec historique.
--
--  Pas de tenant_isolation ici : ces tables sont au niveau PLATEFORME
--  (équipe PumpIT elle-même), pas des données d'un client — RLS basée
--  sur is_agent()/agent_can(), pas organisation_id/current_org_id().
--
--  À exécuter dans Supabase > SQL Editor > Run (après v152).
-- ============================================================

begin;

alter table public.profiles add column if not exists salaire_mensuel numeric;
alter table public.profiles add column if not exists commission_type text check (commission_type in ('aucune', 'recurrent', 'unique'));
alter table public.profiles add column if not exists commission_taux numeric;   -- en %, ex. 5 ou 10 — réglable par agent

alter table public.organisations add column if not exists apporte_par uuid references public.profiles(id);

-- Garde-fou : la policy UPDATE de profiles autorise déjà id = auth.uid() — sans ce trigger, un
-- agent pourrait s'attribuer lui-même un salaire ou un taux de commission. Seul un profil avec
-- la permission plateforme 'agents' (super_admin par défaut) peut changer ces 3 champs, même sur
-- SA PROPRE fiche. Distinct de prevent_rh_self_edit (migration_v145, champs RH station) : permission
-- vérifiée ici est agent_can('agents'), pas manage_team (qui n'a pas de sens pour un agent).
create or replace function public.prevent_agent_rh_self_edit()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() = old.id and not public.agent_can('agents') then
    if new.salaire_mensuel is distinct from old.salaire_mensuel
       or new.commission_type is distinct from old.commission_type
       or new.commission_taux is distinct from old.commission_taux then
      raise exception 'Champs RH plateforme (salaire, commission) réservés à l''équipe PumpIT (permission agents).';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_prevent_agent_rh_self_edit on public.profiles;
create trigger trg_prevent_agent_rh_self_edit before update on public.profiles
  for each row execute function public.prevent_agent_rh_self_edit();

create table if not exists public.agent_commission_versements (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.profiles(id),
  montant numeric not null check (montant > 0),
  periode text,         -- libre, ex. "2026-05" — période couverte par ce versement
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_commission_versements_agent on public.agent_commission_versements(agent_id);

alter table public.agent_commission_versements enable row level security;
drop policy if exists p_acv_sel on public.agent_commission_versements;
create policy p_acv_sel on public.agent_commission_versements for select using (
  public.agent_can('agents') or agent_id = auth.uid()
);
drop policy if exists p_acv_write on public.agent_commission_versements;
create policy p_acv_write on public.agent_commission_versements for all using (
  public.agent_can('agents')
) with check (
  public.agent_can('agents')
);
grant select, insert, update, delete on public.agent_commission_versements to authenticated;

-- Commission due, dérivée (jamais stockée) : une ligne par facture éligible. 'recurrent' = un %
-- de chaque facture du client apporté ; 'unique' = un % une seule fois, sur la toute première
-- facture du client (rang 1 par organisation, date d'émission).
--
-- PAS de security_invoker ici (volontaire — comportement par défaut d'une vue, exécutée avec les
-- droits du créateur) : factures n'autorise en lecture que is_platform_admin() ou l'organisation
-- elle-même, donc un commercial (permission 'clients', pas 'facturation') ne verrait jamais ses
-- propres commissions avec security_invoker=on. La visibilité est donc imposée ICI, explicitement,
-- dans le WHERE : agent_can('agents') (équipe RH plateforme, voit tout) ou agent_id = auth.uid()
-- (un agent ne voit que ses propres commissions).
create or replace view public.v_commission_commerciale as
with factures_rang as (
  select f.id as facture_id, f.organisation_id, o.nom as organisation_nom, f.numero, f.date_emission,
    f.montant_ttc, f.statut, o.apporte_par as agent_id,
    row_number() over (partition by f.organisation_id order by f.date_emission, f.id) as rang
  from public.factures f
  join public.organisations o on o.id = f.organisation_id
  where o.apporte_par is not null
)
select fr.agent_id, fr.facture_id, fr.organisation_id, fr.organisation_nom, fr.numero, fr.date_emission, fr.montant_ttc,
  p.commission_type, p.commission_taux,
  case
    when fr.statut = 'annulee' then 0
    when p.commission_type = 'recurrent' then round(fr.montant_ttc * coalesce(p.commission_taux, 0) / 100)
    when p.commission_type = 'unique' and fr.rang = 1 then round(fr.montant_ttc * coalesce(p.commission_taux, 0) / 100)
    else 0
  end as commission_montant
from factures_rang fr
join public.profiles p on p.id = fr.agent_id
where p.commission_type in ('recurrent', 'unique')
  and (public.agent_can('agents') or fr.agent_id = auth.uid());

grant select on public.v_commission_commerciale to authenticated;

-- Solde par agent : total dû (somme des commissions calculées) − total versé. Même raison :
-- pas de security_invoker, visibilité imposée dans le WHERE.
create or replace view public.v_solde_commission_agent as
select a.agent_id,
  coalesce(d.total_du, 0) - coalesce(v.total_verse, 0) as solde_du,
  coalesce(d.total_du, 0) as total_du, coalesce(v.total_verse, 0) as total_verse
from (select distinct agent_id from public.v_commission_commerciale) a
left join (select agent_id, sum(commission_montant) as total_du from public.v_commission_commerciale group by agent_id) d on d.agent_id = a.agent_id
left join (select agent_id, sum(montant) as total_verse from public.agent_commission_versements group by agent_id) v on v.agent_id = a.agent_id
where public.agent_can('agents') or a.agent_id = auth.uid();

grant select on public.v_solde_commission_agent to authenticated;

-- bo_agents() : corps identique, + les champs RH (déjà filtré par agent_can('agents') en tête
-- de fonction) pour que le back-office puisse afficher/éditer la fiche RH d'un agent. DROP
-- nécessaire (pas juste CREATE OR REPLACE) : le type de retour change (nouvelles colonnes).
drop function if exists public.bo_agents();
create function public.bo_agents()
returns table(
  id uuid, full_name text, email text, plateforme_role text, organisation_id bigint,
  salaire_mensuel numeric, commission_type text, commission_taux numeric,
  contrat_type text, contrat_fin date, cnss_declare boolean, assurance_maladie_fin date,
  visite_medicale_le date, visite_medicale_mois int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.agent_can('agents') then raise exception 'Permission « équipe » requise.'; end if;
  return query
  select p.id, p.full_name, u.email::text, p.plateforme_role, p.organisation_id,
    p.salaire_mensuel, p.commission_type, p.commission_taux,
    p.contrat_type, p.contrat_fin, p.cnss_declare, p.assurance_maladie_fin,
    p.visite_medicale_le, p.visite_medicale_mois
  from public.profiles p join auth.users u on u.id = p.id
  where p.plateforme_role is not null order by p.full_name;
end; $$;

-- Liste légère des commerciaux (id + nom), pour le sélecteur "Commercial référent" dans
-- Clients.jsx — accessible à quiconque a la permission 'clients' (pas besoin de 'agents', que
-- la plupart des commerciaux n'ont pas) : la restrictive tenant_isolation sur profiles bloque
-- sinon tout accès à un profil plateforme_role non-NULL pour qui n'a pas 'agents'.
create or replace function public.bo_commerciaux()
returns table(id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
  where p.plateforme_role = 'commercial' and public.agent_can('clients');
$$;

commit;
