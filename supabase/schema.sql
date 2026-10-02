-- ============================================================
--  STATION BEAURIVAGE — Schéma Supabase (Postgres)
--  À coller dans Supabase > SQL Editor > New query > Run
-- ============================================================

-- ---------- Profils & rôles ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'gerant' check (role in ('gerant','admin')),
  created_at timestamptz default now()
);

-- crée automatiquement un profil (rôle gérant par défaut) à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'gerant')
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- Rapport quotidien (le "Point") ----------
create table if not exists daily_reports (
  id bigint generated always as identity primary key,
  report_date date not null unique,
  -- carburant
  ess_litres numeric, ess_pu numeric, ess_bon numeric, ess_espece numeric,
  gas_litres numeric, gas_pu numeric, gas_bon numeric, gas_espece numeric,
  -- autres pôles (espèces)
  gaz_espece numeric, superette_espece numeric, lubrifiant_espece numeric,
  -- compteurs pompes
  e1 numeric, e2 numeric, e3 numeric, e4 numeric,
  g1 numeric, g2 numeric, g3 numeric, g4 numeric,
  total_bon_cumul numeric,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ---------- Dépenses payées en espèces ----------
create table if not exists expenses (
  id bigint generated always as identity primary key,
  report_date date not null,
  categorie text not null,        -- SBEE / SUPERETTE / CARBURANT / AUTRE
  montant numeric not null,
  motif text,
  justificatif boolean default false,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_expenses_date on expenses(report_date);

-- ---------- Versements bancaires (avec photo bordereau) ----------
create table if not exists deposits (
  id bigint generated always as identity primary key,
  report_date date not null,      -- jour de recette concerné
  pole text not null default 'carburant',  -- carburant / gaz / superette / lubrifiant
  montant numeric not null,
  deposit_date date,              -- date figurant sur le bordereau
  ref_bordereau text,
  photo_path text,                -- chemin dans le bucket "bordereaux"
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_deposits_date on deposits(report_date);

-- ============================================================
--  MÉTRIQUES & MOTEUR D'ALERTES (vues)
-- ============================================================
create or replace view v_report_metrics as
with base as (
  select r.*,
    coalesce(ess_espece,0)+coalesce(gas_espece,0)+coalesce(gaz_espece,0)
      +coalesce(superette_espece,0)+coalesce(lubrifiant_espece,0) as cash_declare,
    coalesce(ess_bon,0)+coalesce(gas_bon,0) as ventes_bon,
    coalesce(e1,0)+coalesce(e2,0)+coalesce(e3,0)+coalesce(e4,0) as e_total,
    coalesce(g1,0)+coalesce(g2,0)+coalesce(g3,0)+coalesce(g4,0) as g_total
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
  case when prev_date = report_date - 1 and e_total>=e_prev then e_total-e_prev end as e_litres_compteur,
  case when prev_date = report_date - 1 and g_total>=g_prev then g_total-g_prev end as g_litres_compteur
from withprev w;

-- Alertes : une ligne par problème détecté
create or replace view v_alerts as
-- 1) versement manquant
select report_date, 'VERSEMENT_MANQUANT'::text as type, 'haute'::text as gravite,
       'Cash à verser '||round((cash_declare-total_depense))||' F, aucun versement enregistré' as detail
from v_report_metrics
where (cash_declare-total_depense) > 1000 and total_verse = 0
union all
-- 2) versement incomplet
select report_date, 'VERSEMENT_INCOMPLET', 'haute',
       'Versé '||round(total_verse)||' F < à verser '||round(cash_declare-total_depense)||' F'
from v_report_metrics
where total_verse > 0 and total_verse < (cash_declare-total_depense) - 1000
union all
-- 3) écart de caisse (recette ≠ dépenses + versement)
select report_date, 'ECART_CAISSE', 'moyenne',
       'Écart '||round(cash_declare-total_depense-total_verse)||' F (recette≠dépenses+versement)'
from v_report_metrics
where abs(cash_declare-total_depense-total_verse) > 1000 and total_verse > 0
union all
-- 4) dépense non justifiée
select e.report_date, 'DEPENSE_NON_JUSTIFIEE', 'moyenne',
       'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e
where e.justificatif = false or e.motif is null or e.motif = ''
union all
-- 5) écart compteur essence
select report_date, 'ECART_COMPTEUR', 'moyenne',
       'Essence: compteur '||round(e_litres_compteur)||' L vs déclaré '||round(coalesce(ess_litres,0))||' L'
from v_report_metrics
where e_litres_compteur is not null and ess_litres is not null
  and abs(e_litres_compteur - ess_litres) > 100;

-- ============================================================
--  SÉCURITÉ (Row Level Security)
-- ============================================================
alter table profiles enable row level security;
alter table daily_reports enable row level security;
alter table expenses enable row level security;
alter table deposits enable row level security;

-- profils : chacun voit le sien ; admin voit tout ; chacun modifie le sien
drop policy if exists p_profiles_sel on profiles;
create policy p_profiles_sel on profiles for select using (id = auth.uid() or is_admin());
drop policy if exists p_profiles_upd on profiles;
create policy p_profiles_upd on profiles for update using (id = auth.uid() or is_admin());

-- Durcissement : seul un admin (ou l'éditeur SQL/service) peut changer un rôle.
-- Un utilisateur normal de l'app ne peut PAS se promouvoir admin lui-même.
-- NB: security INVOKER (défaut) — indispensable pour que current_user = le rôle appelant
-- ('authenticated' pour l'app, 'postgres' pour l'éditeur SQL). En security definer,
-- current_user vaudrait le propriétaire et le verrou ne se déclencherait jamais.
create or replace function public.prevent_role_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.role is distinct from old.role
     and current_user = 'authenticated'   -- utilisateur de l'app (≠ éditeur SQL 'postgres' / 'service_role')
     and not public.is_admin() then
    raise exception 'Seul un administrateur peut modifier le rôle d''un compte.';
  end if;
  return new;
end; $$;
drop trigger if exists trg_prevent_role_change on profiles;
create trigger trg_prevent_role_change before update on profiles
  for each row execute function public.prevent_role_change();

-- données : tout utilisateur authentifié lit ; gérant+admin écrivent ; admin supprime
drop policy if exists p_reports_sel on daily_reports;
create policy p_reports_sel on daily_reports for select using (auth.role() = 'authenticated');
drop policy if exists p_reports_ins on daily_reports;
create policy p_reports_ins on daily_reports for insert with check (auth.role() = 'authenticated');
drop policy if exists p_reports_upd on daily_reports;
create policy p_reports_upd on daily_reports for update using (auth.role() = 'authenticated');
drop policy if exists p_reports_del on daily_reports;
create policy p_reports_del on daily_reports for delete using (is_admin());

drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (auth.role() = 'authenticated');
drop policy if exists p_exp_ins on expenses;
create policy p_exp_ins on expenses for insert with check (auth.role() = 'authenticated');
drop policy if exists p_exp_del on expenses;
create policy p_exp_del on expenses for delete using (is_admin() or created_by = auth.uid());

drop policy if exists p_dep_sel on deposits;
create policy p_dep_sel on deposits for select using (auth.role() = 'authenticated');
drop policy if exists p_dep_ins on deposits;
create policy p_dep_ins on deposits for insert with check (auth.role() = 'authenticated');
drop policy if exists p_dep_del on deposits;
create policy p_dep_del on deposits for delete using (is_admin() or created_by = auth.uid());

-- Accès API aux vues (PostgREST) pour les utilisateurs connectés
grant select on v_report_metrics to authenticated, anon;
grant select on v_alerts to authenticated, anon;

-- Note : créer un bucket de stockage nommé "bordereaux" (public) dans
-- Supabase > Storage, pour les photos de versement (voir README étape 4).
-- Puis autoriser l'upload par les utilisateurs connectés :
--   Storage > bordereaux > Policies > New policy > "Allow authenticated uploads"
--   (INSERT + SELECT pour le rôle authenticated).
