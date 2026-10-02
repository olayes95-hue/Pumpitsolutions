-- ============================================================
--  MIGRATION v2 — moments de saisie, livraisons/achats,
--  prix & marge, gaz par type, lubrifiant par type.
--  À exécuter UNE FOIS dans Supabase > SQL Editor > Run.
--  (idempotent : réexécutable sans casse)
-- ============================================================

-- ---------- Paramètres (prix de vente & marge) ----------
create table if not exists settings (
  id int primary key default 1,
  essence_pv numeric not null default 725,
  gasoil_pv  numeric not null default 750,
  marge_unitaire numeric not null default 25,   -- FCFA / litre, tous carburants
  constraint one_row check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- ---------- Stock & gaz/lubrifiant sur le point du jour ----------
alter table daily_reports add column if not exists ess_stock numeric;   -- litres en cuve
alter table daily_reports add column if not exists gas_stock numeric;
-- bouteilles de gaz par type : stock restant
alter table daily_reports add column if not exists gaz_stock_3  numeric;
alter table daily_reports add column if not exists gaz_stock_6  numeric;
alter table daily_reports add column if not exists gaz_stock_12 numeric;
alter table daily_reports add column if not exists gaz_stock_38 numeric;
-- bouteilles de gaz vendues par type (dans la journée)
alter table daily_reports add column if not exists gaz_vendu_3  numeric;
alter table daily_reports add column if not exists gaz_vendu_6  numeric;
alter table daily_reports add column if not exists gaz_vendu_12 numeric;
alter table daily_reports add column if not exists gaz_vendu_38 numeric;
-- inventaire lubrifiant : { "5W30 1L": 6, "20W50 5L": 5, ... }
alter table daily_reports add column if not exists lubrifiant_stock jsonb;

-- ---------- Livraisons & achats ----------
create table if not exists deliveries (
  id bigint generated always as identity primary key,
  report_date date not null,
  type text not null,              -- essence / gasoil / gaz / lubrifiant / autre
  quantite numeric,
  unite text,                      -- litres / bouteilles / cartons / unité
  pu_achat numeric,                -- prix d'achat unitaire
  montant numeric,                 -- coût total de la livraison/achat
  fournisseur text,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_deliveries_date on deliveries(report_date);

-- ---------- Journal des envois (moments : matin / 16h / soir) ----------
create table if not exists submissions (
  id bigint generated always as identity primary key,
  report_date date not null,
  moment text not null,            -- matin / apres-midi / soir / autre
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_submissions_date on submissions(report_date);

-- ---------- Métriques : marge, gaz, livraisons ----------
create or replace view v_report_metrics as
with base as (
  select r.*,
    coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
      +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0) as cash_declare,
    coalesce(ess_bon,0)+coalesce(gas_bon,0) as ventes_bon,
    coalesce(e1,0)+coalesce(e2,0)+coalesce(e3,0)+coalesce(e4,0) as e_total,
    coalesce(g1,0)+coalesce(g2,0)+coalesce(g3,0)+coalesce(g4,0) as g_total,
    (coalesce(ess_litres,0)+coalesce(gas_litres,0))
      * (select marge_unitaire from settings where id=1) as marge_estimee
  from daily_reports r
),
withprev as (
  select *,
    lag(e_total) over (order by report_date) as e_prev,
    lag(g_total) over (order by report_date) as g_prev,
    lag(report_date) over (order by report_date) as prev_date
  from base
)
select w.*,
  (select coalesce(sum(montant),0) from expenses e where e.report_date=w.report_date) as total_depense,
  (select coalesce(sum(montant),0) from deposits d where d.report_date=w.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=w.report_date) as total_livraisons,
  case when prev_date = report_date - 1 and e_total>=e_prev then e_total-e_prev end as e_litres_compteur,
  case when prev_date = report_date - 1 and g_total>=g_prev then g_total-g_prev end as g_litres_compteur
from withprev w;

-- ---------- Sécurité (RLS) sur les nouvelles tables ----------
alter table settings enable row level security;
alter table deliveries enable row level security;
alter table submissions enable row level security;

drop policy if exists p_settings_sel on settings;
create policy p_settings_sel on settings for select using (auth.role()='authenticated');
drop policy if exists p_settings_upd on settings;
create policy p_settings_upd on settings for update using (is_admin());

drop policy if exists p_deliv_sel on deliveries;
create policy p_deliv_sel on deliveries for select using (auth.role()='authenticated');
drop policy if exists p_deliv_ins on deliveries;
create policy p_deliv_ins on deliveries for insert with check (auth.role()='authenticated');
drop policy if exists p_deliv_del on deliveries;
create policy p_deliv_del on deliveries for delete using (is_admin() or created_by=auth.uid());

drop policy if exists p_sub_sel on submissions;
create policy p_sub_sel on submissions for select using (auth.role()='authenticated');
drop policy if exists p_sub_ins on submissions;
create policy p_sub_ins on submissions for insert with check (auth.role()='authenticated');

grant select on v_report_metrics to authenticated, anon;
