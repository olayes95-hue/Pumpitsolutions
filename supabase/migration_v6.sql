-- ============================================================
--  MIGRATION v6 — Photos envoyées par le gérant (compteurs, stock, factures…)
--  À exécuter dans Supabase > SQL Editor > Run (après v5).
--  Réutilise le bucket public "bordereaux" pour le stockage.
-- ============================================================

create table if not exists attachments (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  report_date date not null,
  categorie text default 'autre',   -- compteur / stock / facture / bordereau / autre
  photo_path text not null,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now());
create index if not exists idx_attach on attachments(station_id, report_date);

alter table attachments enable row level security;
drop policy if exists p_attach_sel on attachments;
create policy p_attach_sel on attachments for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_attach_ins on attachments;
create policy p_attach_ins on attachments for insert with check (auth.role()='authenticated');
drop policy if exists p_attach_del on attachments;
create policy p_attach_del on attachments for delete using (is_admin() or created_by = auth.uid());
