-- ============================================================
--  MIGRATION v50 — Solde d'ouverture pour le Bilan simplifié.
--
--  Constat : "Bilan simplifié" (Point financier) cumule stock + bons en
--  cours + cash non versé − charges à payer depuis la toute première
--  ligne en base, mais n'a aucune notion de ce que la station possédait/
--  devait AVANT la mise en place du suivi (station déjà en activité).
--  Résultat : la "Situation nette" affichée est fausse d'un montant fixe
--  égal à ce solde de départ manquant.
--
--  Fix : une table à une ligne par station où l'admin peut saisir, une
--  fois, le solde net réel (actif − passif) à une date de départ donnée.
--  Ce solde est ensuite ajouté au total Actif du bilan dès que la
--  période affichée atteint cette date — montant libre, positif ou
--  négatif (une dette de départ diminue la situation nette).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v49). Idempotente.
-- ============================================================

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
