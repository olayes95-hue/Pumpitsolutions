-- ============================================================
--  MIGRATION v116 — Charges de la plateforme PumpIT elle-même (salaires,
--  hébergement, loyer, SBEE, SONEB...), distinctes des charges des
--  stations clientes (table `charges`, par station).
--
--  Même esprit que `charges` (mois 'YYYY-MM', catégorie, montant, note,
--  statut à_payer/payé) mais sans station_id/organisation_id — c'est
--  PumpIT elle-même. Visible uniquement dans le back-office (Compta),
--  réservé à la permission 'facturation' (même garde que le reste de
--  Compta.jsx).
-- ============================================================

create table if not exists plateforme_charges (
  id bigint generated always as identity primary key,
  mois text not null,                 -- 'YYYY-MM'
  categorie text not null,            -- SALAIRES / HEBERGEMENT / LOYER / SBEE / SONEB / IMPOTS / PRESTATIONS / AUTRE
  montant numeric not null,
  note text,
  statut text not null default 'a_payer' check (statut in ('a_payer', 'paye')),
  date_paiement date,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_plateforme_charges_mois on plateforme_charges(mois);

alter table plateforme_charges enable row level security;
drop policy if exists p_plateforme_charges_all on plateforme_charges;
create policy p_plateforme_charges_all on plateforme_charges for all
  using ((select public.agent_can('facturation'))) with check ((select public.agent_can('facturation')));
grant select, insert, update, delete on plateforme_charges to authenticated;
