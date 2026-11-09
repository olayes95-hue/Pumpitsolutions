-- ============================================================
--  MIGRATION v152 — Module RH léger : demandes d'explication.
--
--  Autonome (pas liée à une dette_personnel précise) : l'admin ou
--  manage_team peut créer une demande pour n'importe quel employé, pour
--  n'importe quel motif (manque de caisse, retard, absence, faute...).
--  L'employé répond lui-même dans l'appli (voir Submit.jsx — bannière
--  si une demande est en attente de réponse).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v151).
-- ============================================================

begin;

create table public.demandes_explication (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) default public.current_org_id(),
  station_id bigint not null references public.stations(id),
  employe_id uuid not null references public.profiles(id),
  motif text not null,
  date_limite date,
  statut text not null default 'envoyee' check (statut in ('envoyee', 'repondue', 'sans_reponse')),
  reponse text,
  reponse_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index idx_demandes_explication_employe on public.demandes_explication(employe_id);

alter table public.demandes_explication enable row level security;

drop trigger if exists trg_set_organisation on public.demandes_explication;
create trigger trg_set_organisation before insert on public.demandes_explication
  for each row execute function public.set_organisation_id();

drop policy if exists tenant_isolation on public.demandes_explication;
create policy tenant_isolation on public.demandes_explication as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));

-- Lecture : admin/manage_team/view_team (RH), ou l'employé concerné lui-même (sa propre demande).
drop policy if exists p_demandes_sel on public.demandes_explication;
create policy p_demandes_sel on public.demandes_explication for select using (
  is_admin() or (select public.my_permissions()) && array['manage_team', 'view_team'] or employe_id = auth.uid()
);
-- Création/suppression : admin/manage_team uniquement (action RH formelle).
drop policy if exists p_demandes_ins on public.demandes_explication;
create policy p_demandes_ins on public.demandes_explication for insert with check (
  is_admin() or (select public.my_permissions()) && array['manage_team']
);
drop policy if exists p_demandes_del on public.demandes_explication;
create policy p_demandes_del on public.demandes_explication for delete using (
  is_admin() or (select public.my_permissions()) && array['manage_team']
);
-- Modification : admin/manage_team (tout champ), OU l'employé concerné (sa réponse seulement,
-- voir le trigger ci-dessous qui bloque toute autre modification de sa part).
drop policy if exists p_demandes_upd on public.demandes_explication;
create policy p_demandes_upd on public.demandes_explication for update using (
  is_admin() or (select public.my_permissions()) && array['manage_team'] or employe_id = auth.uid()
) with check (
  is_admin() or (select public.my_permissions()) && array['manage_team'] or employe_id = auth.uid()
);

-- Garde-fou : la policy UPDATE autorise employe_id = auth.uid() pour permettre la réponse —
-- sans ce trigger, l'employé pourrait aussi modifier le motif, la date limite, ou se
-- réassigner la demande. Même mécanique que prevent_rh_self_edit (migration_v145).
create or replace function public.prevent_demande_tampering()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() = old.employe_id and not (public.is_admin() or (select public.my_permissions()) && array['manage_team']) then
    if new.motif is distinct from old.motif
       or new.date_limite is distinct from old.date_limite
       or new.employe_id is distinct from old.employe_id
       or new.station_id is distinct from old.station_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Vous ne pouvez modifier que votre réponse.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_prevent_demande_tampering on public.demandes_explication;
create trigger trg_prevent_demande_tampering before update on public.demandes_explication
  for each row execute function public.prevent_demande_tampering();

grant select, insert, update, delete on public.demandes_explication to authenticated;

commit;
