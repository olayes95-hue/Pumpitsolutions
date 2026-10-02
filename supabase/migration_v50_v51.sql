-- ============================================================
--  MIGRATION COMBINÉE v50 + v51 — à exécuter dans Supabase > SQL
--  Editor > Run, après v49 (déjà confirmée exécutée).
--  Idempotente (create table if not exists / drop+create policy).
-- ============================================================

-- ---------- v50 : solde d'ouverture (Bilan simplifié) ----------
create table if not exists finance_soldes_ouverture (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id) unique,
  date_ouverture date not null,
  montant numeric not null default 0,
  note text,
  created_by uuid references profiles(id),
  updated_at timestamptz default now());

alter table finance_soldes_ouverture enable row level security;
drop policy if exists p_fso_sel on finance_soldes_ouverture;
create policy p_fso_sel on finance_soldes_ouverture for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_fso_all on finance_soldes_ouverture;
create policy p_fso_all on finance_soldes_ouverture for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on finance_soldes_ouverture to authenticated;

-- ---------- v51 : rapprochement mensuel des bons ----------
create table if not exists finance_bons_reconciliation (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  mois text not null,                 -- 'YYYY-MM'
  montant_direction numeric not null default 0,
  note text,
  created_by uuid references profiles(id),
  updated_at timestamptz default now(),
  unique(station_id, mois));

alter table finance_bons_reconciliation enable row level security;
drop policy if exists p_fbr_sel on finance_bons_reconciliation;
create policy p_fbr_sel on finance_bons_reconciliation for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_fbr_all on finance_bons_reconciliation;
create policy p_fbr_all on finance_bons_reconciliation for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on finance_bons_reconciliation to authenticated;
