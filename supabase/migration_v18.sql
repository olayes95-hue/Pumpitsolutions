-- ============================================================
--  MIGRATION v18 — Références lubrifiant gérables par l'admin.
--  À exécuter dans Supabase > SQL Editor > Run (après v17).
-- ============================================================

create table if not exists lubrifiant_types (
  id bigint generated always as identity primary key,
  nom text not null unique,
  actif boolean default true,
  ordre int default 100,
  created_at timestamptz default now());

alter table lubrifiant_types enable row level security;
drop policy if exists p_lub_sel on lubrifiant_types;
create policy p_lub_sel on lubrifiant_types for select using (auth.role()='authenticated');
drop policy if exists p_lub_all on lubrifiant_types;
create policy p_lub_all on lubrifiant_types for all using (is_admin()) with check (is_admin());
grant select on lubrifiant_types to authenticated, anon;

-- références existantes + 20W50 (1L)
insert into lubrifiant_types (nom, ordre) values
 ('5W30 1L',10),('5W30 5L',20),('20W50 1L',25),('20W50 5L',30),('15W40 5L',40),
 ('80W90 1L',50),('50 SAE 5L',60),('Dexron 1L',70),('Dot4 1L',80),('10W40 5L',90),
 ('5W40 5L',100),('Graisse',110),('Liquide refroid.',120),('Nettoyant injecteur',130),('Nettoyant essence',140)
on conflict (nom) do nothing;
