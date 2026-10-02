-- ============================================================
--  MIGRATION v48 — Point financier pour expert-comptable.
--
--  charges (Point financier → Charges fixes) gagne :
--   - photo_path      : justificatif (facture, bulletin de salaire, avis d'imposition...)
--   - statut          : 'a_payer' | 'paye'
--   - date_paiement   : renseignée quand statut='paye'
--   - code_comptable  : libre (ex. plan comptable SYSCOHADA), non contraint — l'app
--                        n'impose pas de plan comptable, juste un champ de correspondance
--                        pour faciliter l'import dans un logiciel comptable.
--
--  Verrouillage de période : une fois un mois verrouillé (admin), plus aucune charge
--  fixe ne peut y être ajoutée/modifiée/supprimée tant qu'il n'est pas déverrouillé
--  explicitement — geste volontaire, symétrique au déverrouillage.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v47). Idempotente.
-- ============================================================

alter table charges add column if not exists photo_path text;
alter table charges add column if not exists statut text not null default 'a_payer';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'charges_statut_check') then
    alter table charges add constraint charges_statut_check check (statut in ('a_payer','paye'));
  end if;
end $$;
alter table charges add column if not exists date_paiement date;
alter table charges add column if not exists code_comptable text;

create table if not exists finance_periodes_verrouillees (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  mois text not null,                 -- 'YYYY-MM'
  verrouille_by uuid references profiles(id),
  verrouille_at timestamptz default now(),
  unique(station_id, mois));

alter table finance_periodes_verrouillees enable row level security;
drop policy if exists p_fpv_sel on finance_periodes_verrouillees;
create policy p_fpv_sel on finance_periodes_verrouillees for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_fpv_all on finance_periodes_verrouillees;
create policy p_fpv_all on finance_periodes_verrouillees for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on finance_periodes_verrouillees to authenticated;

create or replace function public.mois_verrouille(p_station_id bigint, p_mois text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from finance_periodes_verrouillees where station_id = p_station_id and mois = p_mois);
$$;

-- Écriture sur charges déjà réservée à l'admin (p_charges_all) — on ajoute la condition
-- que le mois ne soit pas verrouillé. Le déverrouillage reste toujours possible (table
-- séparée, non concernée par cette policy) : la sortie de verrou est un geste volontaire.
drop policy if exists p_charges_all on charges;
create policy p_charges_all on charges for all
  using (is_admin() and not public.mois_verrouille(station_id, mois))
  with check (is_admin() and not public.mois_verrouille(station_id, mois));
