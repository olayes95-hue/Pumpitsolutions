-- ============================================================
--  MIGRATION v148 — Module RH léger : dettes du personnel, alimentées
--  manuellement par l'admin depuis les manques de caisse déjà détectés
--  (v_verse_recon, le même calcul que l'alerte VERSEMENT_INCOMPLET) —
--  pas d'attribution automatique : un manque sur une période où plusieurs
--  personnes ont saisi est ambigu, l'admin choisit à qui l'attribuer (ou
--  l'ignore, via alert_dismissals comme n'importe quelle alerte).
--
--  Solde dû toujours DÉRIVÉ (v_dette_personnel), jamais stocké — même
--  philosophie que v_solde_client (clients à crédit, migration_v143).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v147).
-- ============================================================

begin;

create table public.dettes_personnel (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) default public.current_org_id(),
  station_id bigint not null references public.stations(id),
  employe_id uuid not null references public.profiles(id),
  -- carburant / gaz_lub / superette (manque à verser, voir v_verse_recon) ou perte_livraison
  -- (perte carburant au-delà du seuil de tolérance, voir v_pertes_livraison.perte_na_montant).
  pole_groupe text not null,
  periode_debut date not null,
  periode_fin date not null,
  -- Renseigné uniquement pour pole_groupe='perte_livraison' : une perte est un évènement ponctuel
  -- (une réception) et non une période — distingue deux réceptions le même jour, que l'unicité
  -- (station, pole_groupe, periode_debut, periode_fin) seule ne pourrait pas distinguer.
  fuel_order_id bigint references public.fuel_orders(id),
  montant numeric not null check (montant > 0),
  note text,
  attribue_par uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
-- Empêche d'attribuer deux fois le même manque à verser détecté (même station+pôle+période).
create unique index idx_dettes_personnel_unique on public.dettes_personnel(station_id, pole_groupe, periode_debut, periode_fin)
  where pole_groupe <> 'perte_livraison';
-- Empêche d'attribuer deux fois la même perte de livraison détectée.
create unique index idx_dettes_personnel_perte_unique on public.dettes_personnel(fuel_order_id)
  where pole_groupe = 'perte_livraison';
create index idx_dettes_personnel_employe on public.dettes_personnel(employe_id);

create table public.dettes_personnel_remboursements (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) default public.current_org_id(),
  employe_id uuid not null references public.profiles(id),
  station_id bigint not null references public.stations(id),
  report_date date not null default current_date,
  montant numeric not null check (montant > 0),
  photo_path text,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index idx_dettes_personnel_remb_employe on public.dettes_personnel_remboursements(employe_id);

alter table public.dettes_personnel enable row level security;
alter table public.dettes_personnel_remboursements enable row level security;

drop trigger if exists trg_set_organisation on public.dettes_personnel;
create trigger trg_set_organisation before insert on public.dettes_personnel
  for each row execute function public.set_organisation_id();
drop trigger if exists trg_set_organisation on public.dettes_personnel_remboursements;
create trigger trg_set_organisation before insert on public.dettes_personnel_remboursements
  for each row execute function public.set_organisation_id();

drop policy if exists tenant_isolation on public.dettes_personnel;
create policy tenant_isolation on public.dettes_personnel as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));
drop policy if exists tenant_isolation on public.dettes_personnel_remboursements;
create policy tenant_isolation on public.dettes_personnel_remboursements as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));

-- Lecture : qui gère déjà l'équipe (manage_team/view_team), direction incluse. Écriture :
-- réservée à l'admin (voir en-tête — « validation manuelle par l'admin » explicitement voulu),
-- sauf les remboursements, enregistrables aussi par manage_team (même niveau que le reste RH).
drop policy if exists p_dettes_sel on public.dettes_personnel;
create policy p_dettes_sel on public.dettes_personnel for select using (
  is_admin() or (select public.my_permissions()) && array['manage_team', 'view_team']
);
drop policy if exists p_dettes_write on public.dettes_personnel;
create policy p_dettes_write on public.dettes_personnel for all using (is_admin()) with check (is_admin());

drop policy if exists p_dettes_remb_sel on public.dettes_personnel_remboursements;
create policy p_dettes_remb_sel on public.dettes_personnel_remboursements for select using (
  is_admin() or (select public.my_permissions()) && array['manage_team', 'view_team']
);
drop policy if exists p_dettes_remb_write on public.dettes_personnel_remboursements;
create policy p_dettes_remb_write on public.dettes_personnel_remboursements for all using (
  is_admin() or (select public.my_permissions()) && array['manage_team']
) with check (
  is_admin() or (select public.my_permissions()) && array['manage_team']
);

grant select, insert, update, delete on public.dettes_personnel to authenticated;
grant select, insert, update, delete on public.dettes_personnel_remboursements to authenticated;

create or replace view public.v_dette_personnel as
select e.employe_id,
  coalesce(d.total_du, 0) - coalesce(r.total_rembourse, 0) as solde_du,
  d.total_du, r.total_rembourse, d.derniere_dette, r.dernier_remboursement
from (
  select employe_id from public.dettes_personnel
  union
  select employe_id from public.dettes_personnel_remboursements
) e
left join (
  select employe_id, sum(montant) as total_du, max(periode_fin) as derniere_dette
  from public.dettes_personnel group by employe_id
) d on d.employe_id = e.employe_id
left join (
  select employe_id, sum(montant) as total_rembourse, max(report_date) as dernier_remboursement
  from public.dettes_personnel_remboursements group by employe_id
) r on r.employe_id = e.employe_id;
alter view public.v_dette_personnel set (security_invoker = on);
grant select on public.v_dette_personnel to authenticated;

commit;
