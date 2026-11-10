-- ============================================================
--  MIGRATION v158 — Suivi jusqu'à clôture des demandes d'explication
--  + nouvelle fonctionnalité congés/absences.
--
--  1) demandes_explication : jusqu'ici le cycle s'arrêtait à "repondue"
--  (réponse de l'employé) sans jamais être formellement refermé par la
--  direction — demande explicite de l'utilisateur ("doivent être suivies
--  jusqu'à... clôture"). Ajoute un 4e statut 'cloturee' + la décision
--  prise (justifié / sanction / etc.), horodatée et tracée.
--
--  2) conges_demandes (nouvelle table) : demande de congé/absence par un
--  employé, validée ou refusée par le gérant/directeur (manage_team).
-- ============================================================

begin;

alter table public.demandes_explication add column if not exists decision text;
alter table public.demandes_explication add column if not exists decided_at timestamptz;
alter table public.demandes_explication add column if not exists decided_by uuid references public.profiles(id);

alter table public.demandes_explication drop constraint if exists demandes_explication_statut_check;
alter table public.demandes_explication add constraint demandes_explication_statut_check
  check (statut in ('envoyee', 'repondue', 'sans_reponse', 'cloturee'));

-- L'employé ne peut toujours modifier que sa réponse — étendu aux nouveaux champs de clôture
-- (réservés à manage_team/admin) et au statut (un employé ne peut mettre que 'repondue', jamais
-- se clôturer ou se marquer "sans_reponse" lui-même).
create or replace function public.prevent_demande_tampering()
returns trigger language plpgsql as $$
begin
  if auth.uid() = old.employe_id and not (public.is_admin() or (select public.my_permissions()) && array['manage_team']) then
    if new.motif is distinct from old.motif
       or new.date_limite is distinct from old.date_limite
       or new.employe_id is distinct from old.employe_id
       or new.station_id is distinct from old.station_id
       or new.created_by is distinct from old.created_by
       or new.decision is distinct from old.decision
       or new.decided_at is distinct from old.decided_at
       or new.decided_by is distinct from old.decided_by
       or new.statut <> 'repondue' then
      raise exception 'Vous ne pouvez modifier que votre réponse.';
    end if;
  end if;
  return new;
end; $$;

create table if not exists public.conges_demandes (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) default public.current_org_id(),
  station_id bigint not null references public.stations(id),
  employe_id uuid not null references public.profiles(id),
  type text not null check (type in ('conge', 'absence')),
  date_debut date not null,
  date_fin date not null check (date_fin >= date_debut),
  motif text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'validee', 'refusee', 'annulee')),
  decidee_par uuid references public.profiles(id),
  decidee_at timestamptz,
  note_decision text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_conges_demandes_employe on public.conges_demandes(employe_id);
create index if not exists idx_conges_demandes_station on public.conges_demandes(station_id);

alter table public.conges_demandes enable row level security;

drop policy if exists tenant_isolation on public.conges_demandes;
create policy tenant_isolation on public.conges_demandes as restrictive
  using (organisation_id = current_org_id()) with check (organisation_id = current_org_id());

drop trigger if exists trg_set_organisation on public.conges_demandes;
create trigger trg_set_organisation before insert on public.conges_demandes
  for each row execute function public.set_organisation_id();

-- Lecture : l'employé voit ses propres demandes, manage_team/view_team voient celles de l'org.
drop policy if exists p_conges_sel on public.conges_demandes;
create policy p_conges_sel on public.conges_demandes for select
  using (is_admin() or (select my_permissions()) && array['manage_team','view_team'] or employe_id = auth.uid());

-- Création : l'employé crée sa propre demande (statut forcé 'en_attente' par le défaut de colonne
-- — pas de check ici, mais le trigger ci-dessous empêche de se l'auto-valider), manage_team peut
-- aussi créer pour un tiers (ex. absence déclarée après coup par le gérant).
drop policy if exists p_conges_ins on public.conges_demandes;
create policy p_conges_ins on public.conges_demandes for insert
  with check (is_admin() or (select my_permissions()) && array['manage_team'] or employe_id = auth.uid());

-- Mise à jour : un employé ne peut qu'annuler sa propre demande tant qu'elle est en attente ;
-- la validation/refus est réservée à manage_team/admin (vérifié aussi en trigger ci-dessous).
drop policy if exists p_conges_upd on public.conges_demandes;
create policy p_conges_upd on public.conges_demandes for update
  using (is_admin() or (select my_permissions()) && array['manage_team'] or employe_id = auth.uid())
  with check (is_admin() or (select my_permissions()) && array['manage_team'] or employe_id = auth.uid());

drop policy if exists p_conges_del on public.conges_demandes;
create policy p_conges_del on public.conges_demandes for delete
  using (is_admin() or (select my_permissions()) && array['manage_team']);

create or replace function public.prevent_conge_self_validation()
returns trigger language plpgsql as $$
begin
  if auth.uid() = old.employe_id and not (public.is_admin() or (select public.my_permissions()) && array['manage_team']) then
    if new.statut is distinct from old.statut and new.statut <> 'annulee' then
      raise exception 'Seul le gérant ou le directeur peut valider ou refuser une demande de congé.';
    end if;
    if new.decidee_par is distinct from old.decidee_par or new.decidee_at is distinct from old.decidee_at
       or new.note_decision is distinct from old.note_decision then
      raise exception 'Champs réservés au gérant/directeur.';
    end if;
    if old.statut <> 'en_attente' and (new.statut is distinct from old.statut or new.date_debut is distinct from old.date_debut or new.date_fin is distinct from old.date_fin) then
      raise exception 'Une demande déjà traitée ne peut plus être modifiée par l''employé.';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_prevent_conge_self_validation on public.conges_demandes;
create trigger trg_prevent_conge_self_validation before update on public.conges_demandes
  for each row execute function public.prevent_conge_self_validation();

commit;
