-- ============================================================
--  MIGRATION v143 — Clients à crédit : une dépense non-cash (carburant ou
--  autre pôle donné sans encaissement, déclarée au jour le jour par le chef
--  de piste — exactement comme la dépense déplacement du propriétaire déjà
--  existante, catégorie CARBURANT, non_cash=true) mais qui doit être
--  remboursée par un tiers (société/personne), donc suivie comme une
--  créance plutôt que comptée comme une charge définitive.
--
--  Pas de nouvelle table de "ventes à crédit" : extension de `expenses`
--  (expenses.client_id optionnel) + une table de remboursements reçus.
--  Solde dû toujours DÉRIVÉ (vue), jamais stocké — cohérent avec
--  bons_restant/v_compte_bancaire déjà dans l'app.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v142).
-- ============================================================

begin;

create table public.clients (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) default public.current_org_id(),
  station_id bigint not null references public.stations(id),
  nom text not null,
  telephone text,
  actif boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index idx_clients_station on public.clients(station_id);

alter table public.expenses add column if not exists client_id bigint references public.clients(id);
create index idx_expenses_client on public.expenses(client_id) where client_id is not null;

create table public.client_remboursements (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) default public.current_org_id(),
  client_id bigint not null references public.clients(id),
  station_id bigint not null references public.stations(id),
  report_date date not null default current_date,
  montant numeric not null check (montant > 0),
  photo_path text,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index idx_client_remb_client on public.client_remboursements(client_id);

-- ---------- RLS : même famille que gaz_mouvements_bouteilles (migration_v134) ----------
alter table public.clients enable row level security;
alter table public.client_remboursements enable row level security;

drop trigger if exists trg_set_organisation on public.clients;
create trigger trg_set_organisation before insert on public.clients
  for each row execute function public.set_organisation_id();
drop trigger if exists trg_set_organisation on public.client_remboursements;
create trigger trg_set_organisation before insert on public.client_remboursements
  for each row execute function public.set_organisation_id();

drop policy if exists tenant_isolation on public.clients;
create policy tenant_isolation on public.clients as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));
drop policy if exists tenant_isolation on public.client_remboursements;
create policy tenant_isolation on public.client_remboursements as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));

-- Lecture : sa station, ou view_finance/view_dashboard sur une station accessible, ou admin.
drop policy if exists p_clients_sel on public.clients;
create policy p_clients_sel on public.clients for select using (
  is_admin() or station_id = (select public.my_station())
  or (
    array[station_id] && (select public.my_accessible_stations())
    and (select public.my_permissions()) && array['view_finance', 'view_dashboard']
  )
);
-- Écriture (insert/update/delete) : réservée à manage_team/admin — ça touche une créance
-- comptable, pas une simple saisie opérationnelle comme les autres tables de Submit.jsx.
drop policy if exists p_clients_write on public.clients;
create policy p_clients_write on public.clients for all using (
  is_admin() or ((select public.my_permissions()) && array['manage_team'] and station_id = (select public.my_station()))
) with check (
  is_admin() or ((select public.my_permissions()) && array['manage_team'] and station_id = (select public.my_station()))
);

drop policy if exists p_remb_sel on public.client_remboursements;
create policy p_remb_sel on public.client_remboursements for select using (
  is_admin() or station_id = (select public.my_station())
  or (
    array[station_id] && (select public.my_accessible_stations())
    and (select public.my_permissions()) && array['view_finance', 'view_dashboard']
  )
);
drop policy if exists p_remb_write on public.client_remboursements;
create policy p_remb_write on public.client_remboursements for all using (
  is_admin() or ((select public.my_permissions()) && array['manage_team'] and station_id = (select public.my_station()))
) with check (
  is_admin() or ((select public.my_permissions()) && array['manage_team'] and station_id = (select public.my_station()))
);

grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.client_remboursements to authenticated;

create or replace view public.v_solde_client as
select c.id as client_id, c.station_id, c.nom,
  coalesce(e.total_du, 0) - coalesce(r.total_rembourse, 0) as solde_du,
  e.derniere_depense, r.dernier_remboursement
from public.clients c
left join (
  select client_id, sum(montant) as total_du, max(report_date) as derniere_depense
  from public.expenses where client_id is not null group by client_id
) e on e.client_id = c.id
left join (
  select client_id, sum(montant) as total_rembourse, max(report_date) as dernier_remboursement
  from public.client_remboursements group by client_id
) r on r.client_id = c.id;
alter view public.v_solde_client set (security_invoker = on);
grant select on public.v_solde_client to authenticated;

commit;
