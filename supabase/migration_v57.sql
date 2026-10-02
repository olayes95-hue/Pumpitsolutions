-- ============================================================
--  MIGRATION v57 — Suivi du compte bancaire.
--
--  4 flux à suivre :
--   - dépôts (déjà en base : table `deposits`, cash versé par la station)
--   - chèques de commandes (déjà en base : fuel_orders.cheque_montant)
--   - virements reçus de la direction (remboursement des bons) — NOUVEAU
--   - frais bancaires — NOUVEAU
--
--  Un solde initial (comme finance_soldes_ouverture) sert de point de
--  départ ; v_compte_bancaire calcule le solde courant = initial +
--  dépôts − chèques + virements bons − frais, depuis cette date.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v56). Idempotente.
-- ============================================================

create table if not exists compte_bancaire_solde_initial (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id) unique,
  date_solde date not null,
  montant numeric not null default 0,
  note text,
  created_by uuid references profiles(id),
  updated_at timestamptz default now());

alter table compte_bancaire_solde_initial enable row level security;
drop policy if exists p_cbsi_sel on compte_bancaire_solde_initial;
create policy p_cbsi_sel on compte_bancaire_solde_initial for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_cbsi_all on compte_bancaire_solde_initial;
create policy p_cbsi_all on compte_bancaire_solde_initial for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on compte_bancaire_solde_initial to authenticated;

create table if not exists compte_bancaire_mouvements (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  date_mouvement date not null,
  type text not null check (type in ('virement_bons','frais_bancaire')),
  montant numeric not null,           -- toujours positif, le sens vient du type
  note text,
  photo_path text,                    -- justificatif (avis de virement, relevé de frais)
  created_by uuid references profiles(id),
  created_at timestamptz default now());

alter table compte_bancaire_mouvements enable row level security;
drop policy if exists p_cbm_sel on compte_bancaire_mouvements;
create policy p_cbm_sel on compte_bancaire_mouvements for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_cbm_all on compte_bancaire_mouvements;
create policy p_cbm_all on compte_bancaire_mouvements for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on compte_bancaire_mouvements to authenticated;

create or replace view v_compte_bancaire as
with si as (
  select station_id, date_solde, montant as solde_initial
  from compte_bancaire_solde_initial
),
depots as (
  select d.station_id, sum(d.montant) as total_depots
  from deposits d join si on si.station_id = d.station_id
  where d.report_date > si.date_solde
  group by d.station_id
),
cheques as (
  select o.station_id, sum(coalesce(o.cheque_montant,0)) as total_cheques
  from fuel_orders o join si on si.station_id = o.station_id
  where o.statut <> 'annulee' and o.date_lancement is not null and o.date_lancement > si.date_solde
  group by o.station_id
),
virements as (
  select m.station_id, sum(m.montant) as total_virements
  from compte_bancaire_mouvements m join si on si.station_id = m.station_id
  where m.type = 'virement_bons' and m.date_mouvement > si.date_solde
  group by m.station_id
),
frais as (
  select m.station_id, sum(m.montant) as total_frais
  from compte_bancaire_mouvements m join si on si.station_id = m.station_id
  where m.type = 'frais_bancaire' and m.date_mouvement > si.date_solde
  group by m.station_id
)
select si.station_id, si.date_solde, si.solde_initial,
  coalesce(dp.total_depots,0) as total_depots,
  coalesce(ch.total_cheques,0) as total_cheques,
  coalesce(vi.total_virements,0) as total_virements,
  coalesce(fr.total_frais,0) as total_frais,
  si.solde_initial + coalesce(dp.total_depots,0) - coalesce(ch.total_cheques,0)
    + coalesce(vi.total_virements,0) - coalesce(fr.total_frais,0) as solde_actuel
from si
left join depots dp on dp.station_id = si.station_id
left join cheques ch on ch.station_id = si.station_id
left join virements vi on vi.station_id = si.station_id
left join frais fr on fr.station_id = si.station_id;

grant select on v_compte_bancaire to authenticated, anon;
