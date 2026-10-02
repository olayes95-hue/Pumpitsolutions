-- ============================================================
--  RBAC — migrations v73 (fix perf URGENT) + v74 (directeur voit
--  le Journal de bord), combinées dans l'ordre. À exécuter en
--  une seule fois dans Supabase > SQL Editor > Run, APRÈS
--  migration_v65_v72.sql. Idempotent.
-- ============================================================


-- ############################################################
-- ## migration_v73.sql
-- ############################################################

-- ============================================================
--  MIGRATION v73 — URGENT fix perf : les policies RLS ajoutées en v66-v72
--  appellent has_permission()/has_station_access() PAR LIGNE avec des
--  arguments qui empêchent Postgres de les évaluer une seule fois par
--  requête (pattern documenté : un appel de fonction dont l'argument
--  dépend de la ligne, ou imbriqué dans une autre fonction, n'est PAS
--  automatiquement mis en cache par le planner) — ça a cassé
--  l'utilisation des index existants (idx_dr_st_date, idx_mvt_st_date,
--  etc.) sur toutes les pages de Pilotage, d'où le ralentissement
--  remonté juste après le déploiement.
--
--  Fix (pattern recommandé par Postgres/Supabase pour ce cas précis) :
--  deux nouvelles fonctions SANS ARGUMENT — my_accessible_stations()
--  et my_permissions() — appelées comme sous-requête scalaire
--  `(select ...)` directement dans chaque policy. Une sous-requête non
--  corrélée comme celle-ci est reconnue par le planner et évaluée UNE
--  SEULE FOIS par requête (pas par ligne), puis chaque ligne ne fait
--  plus qu'un test `array[station_id] && tableau déjà calculé` — une
--  comparaison simple, compatible avec les index existants.
--
--  Remplace TOUTES les policies des migrations v66 à v72 par cette
--  forme optimisée — même logique exacte, juste restructurée pour la
--  performance. has_permission()/has_station_access() sont conservées
--  (redéfinies pour rester cohérentes) mais ne sont plus utilisées
--  dans aucune policy.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v72). Idempotente.
-- ============================================================

create or replace function public.my_accessible_stations()
returns bigint[] language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then (select coalesce(array_agg(id), '{}') from stations)
    else (
      select coalesce(array_agg(distinct sid), '{}') from (
        select public.my_station() as sid
        union all
        select station_id from profile_stations where profile_id = auth.uid()
      ) x where sid is not null
    )
  end;
$$;

create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(rp.permission_key), '{}')
  from profiles p
  join role_permissions rp on rp.role_key = p.role
  where p.id = auth.uid();
$$;

-- Conservées pour cohérence (non utilisées dans les policies ci-dessous).
create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or array[p_key] && (select public.my_permissions());
$$;

create or replace function public.has_station_access(p_station_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select p_station_id is not null and array[p_station_id] && (select public.my_accessible_stations());
$$;

-- ---------- B1 : expenses / deliveries / fuel_orders INSERT ----------

drop policy if exists p_exp_ins on expenses;
create policy p_exp_ins on expenses for insert with check (
  is_admin() or ((select public.my_permissions()) && array['manage_orders'] and station_id = public.my_station())
);

drop policy if exists p_deliv_ins on deliveries;
create policy p_deliv_ins on deliveries for insert with check (
  is_admin() or ((select public.my_permissions()) && array['manage_orders'] and station_id = public.my_station())
);

drop policy if exists p_orders_ins on fuel_orders;
create policy p_orders_ins on fuel_orders for insert with check (
  is_admin() or ((select public.my_permissions()) && array['manage_orders'] and station_id = public.my_station())
);

-- ---------- B2 : fuel_orders UPDATE/SELECT, order_receptions SELECT ----------

drop policy if exists p_orders_upd on fuel_orders;
create policy p_orders_upd on fuel_orders for update
  using (
    is_admin()
    or ((select public.my_permissions()) && array['manage_orders'] and array[station_id] && (select public.my_accessible_stations()))
    or ((select public.my_permissions()) && array['validate_orders'] and array[station_id] && (select public.my_accessible_stations()) and statut = 'proposee')
  )
  with check (
    is_admin()
    or ((select public.my_permissions()) && array['manage_orders'] and array[station_id] && (select public.my_accessible_stations()))
    or ((select public.my_permissions()) && array['validate_orders'] and array[station_id] && (select public.my_accessible_stations()) and statut in ('validee', 'annulee'))
  );

drop policy if exists p_orders_sel on fuel_orders;
create policy p_orders_sel on fuel_orders for select using (
  is_admin() or station_id = public.my_station()
  or (
    array[station_id] && (select public.my_accessible_stations())
    and (select public.my_permissions()) && array['view_dashboard', 'view_finance', 'validate_orders', 'manage_orders']
  )
);

drop policy if exists p_recept_sel on order_receptions;
create policy p_recept_sel on order_receptions for select using (
  is_admin() or station_id = public.my_station()
  or (
    array[station_id] && (select public.my_accessible_stations())
    and (select public.my_permissions()) && array['view_finance', 'validate_orders', 'manage_orders']
  )
);

-- ---------- B3 : lecture élargie (9 tables) ----------

drop policy if exists p_reports_sel on daily_reports;
create policy p_reports_sel on daily_reports for select using (
  is_admin() or station_id = public.my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_dashboard', 'view_history', 'view_finance'])
);

drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (
  is_admin() or station_id = public.my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_dashboard', 'view_history', 'view_finance'])
);

drop policy if exists p_dep_sel on deposits;
create policy p_dep_sel on deposits for select using (
  is_admin() or station_id = public.my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_dashboard', 'view_history', 'view_finance', 'view_bank_recon', 'view_ocr_check'])
);

drop policy if exists p_deliv_sel on deliveries;
create policy p_deliv_sel on deliveries for select using (
  is_admin() or station_id = public.my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_dashboard', 'view_history', 'view_finance'])
);

drop policy if exists p_mvt_sel on stock_movements;
create policy p_mvt_sel on stock_movements for select using (
  is_admin() or station_id = public.my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_dashboard', 'view_finance'])
);

drop policy if exists p_charges_sel on charges;
create policy p_charges_sel on charges for select using (
  is_admin() or station_id = public.my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_dashboard', 'view_finance'])
);

drop policy if exists p_dismiss_sel on alert_dismissals;
create policy p_dismiss_sel on alert_dismissals for select using (
  is_admin() or station_id = public.my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_dashboard', 'view_alerts'])
);

drop policy if exists p_attach_sel on attachments;
create policy p_attach_sel on attachments for select using (
  is_admin() or station_id = public.my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_history'])
);

drop policy if exists p_ssales_sel on superette_sales;
create policy p_ssales_sel on superette_sales for select using (
  is_admin() or station_id = my_station()
  or (array[station_id] && (select public.my_accessible_stations()) and (select public.my_permissions()) && array['view_dashboard'])
);

-- ---------- B4 : écriture finance ----------

drop policy if exists p_charges_all on charges;
create policy p_charges_all on charges for all
  using ((is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations()))) and not public.mois_verrouille(station_id, mois))
  with check ((is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations()))) and not public.mois_verrouille(station_id, mois));

drop policy if exists p_fpv_all on finance_periodes_verrouillees;
create policy p_fpv_all on finance_periodes_verrouillees for all
  using (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())))
  with check (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())));

drop policy if exists p_fso_all on finance_soldes_ouverture;
create policy p_fso_all on finance_soldes_ouverture for all
  using (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())))
  with check (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())));

drop policy if exists p_fbr_all on finance_bons_reconciliation;
create policy p_fbr_all on finance_bons_reconciliation for all
  using (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())))
  with check (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())));

drop policy if exists p_cbsi_all on compte_bancaire_solde_initial;
create policy p_cbsi_all on compte_bancaire_solde_initial for all
  using (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())))
  with check (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())));

drop policy if exists p_cbm_all on compte_bancaire_mouvements;
create policy p_cbm_all on compte_bancaire_mouvements for all
  using (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())))
  with check (is_admin() or ((select public.my_permissions()) && array['manage_finance'] and array[station_id] && (select public.my_accessible_stations())));

-- ---------- B5 : bank_lines ----------

drop policy if exists p_bank_sel on bank_lines;
create policy p_bank_sel on bank_lines for select using (
  is_admin() or ((select public.my_permissions()) && array['view_bank_recon'] and array[station_id] && (select public.my_accessible_stations()))
);

drop policy if exists p_bank_ins on bank_lines;
create policy p_bank_ins on bank_lines for insert with check (
  is_admin() or ((select public.my_permissions()) && array['manage_bank_recon'] and array[station_id] && (select public.my_accessible_stations()))
);

drop policy if exists p_bank_upd on bank_lines;
create policy p_bank_upd on bank_lines for update
  using (is_admin() or ((select public.my_permissions()) && array['manage_bank_recon'] and array[station_id] && (select public.my_accessible_stations())))
  with check (is_admin() or ((select public.my_permissions()) && array['manage_bank_recon'] and array[station_id] && (select public.my_accessible_stations())));

drop policy if exists p_bank_del on bank_lines;
create policy p_bank_del on bank_lines for delete using (
  is_admin() or ((select public.my_permissions()) && array['manage_bank_recon'] and array[station_id] && (select public.my_accessible_stations()))
);

-- ---------- B6 : audit_log ----------

drop policy if exists p_audit_sel on audit_log;
create policy p_audit_sel on audit_log for select using (
  is_admin() or ((select public.my_permissions()) && array['view_audit_log'] and array[station_id] && (select public.my_accessible_stations()))
);

-- ---------- B7 : products / suppliers / stations / profiles ----------

drop policy if exists p_products_all on products;
create policy p_products_all on products for all
  using (is_admin() or (select public.my_permissions()) && array['manage_products'])
  with check (is_admin() or (select public.my_permissions()) && array['manage_products']);

drop policy if exists p_suppliers_all on suppliers;
create policy p_suppliers_all on suppliers for all
  using (is_admin() or (select public.my_permissions()) && array['manage_suppliers'])
  with check (is_admin() or (select public.my_permissions()) && array['manage_suppliers']);

drop policy if exists p_stations_upd on stations;
create policy p_stations_upd on stations for update using (
  is_admin() or (select public.my_permissions()) && array['manage_stations_config']
);
drop policy if exists p_stations_ins on stations;
create policy p_stations_ins on stations for insert with check (
  is_admin() or (select public.my_permissions()) && array['manage_stations_config']
);

drop policy if exists p_profiles_upd on profiles;
create policy p_profiles_upd on profiles for update using (
  id = auth.uid() or is_admin() or (select public.my_permissions()) && array['manage_team']
);

-- ############################################################
-- ## migration_v74.sql
-- ############################################################

-- ============================================================
--  MIGRATION v74 — RBAC : le directeur voit le Journal de bord (activité
--  quotidienne du gérant), en plus de Tableau de bord/Historique/Alertes/
--  Point financier déjà accordés.
--
--  Nouvelle permission dédiée (view_journal) plutôt que réutiliser
--  view_history, pour rester cohérent avec le reste du catalogue
--  (une permission par page). Aucun changement RLS nécessaire :
--  Journal.jsx ne lit que des tables/vues déjà couvertes par les
--  permissions view_dashboard/view_history/view_finance/view_alerts
--  que le directeur a déjà (submissions, v_stock_forecast,
--  v_pole_recon_jour, expenses, v_pertes_mensuelles, v_alerts,
--  alert_dismissals, fuel_orders, settings, daily_reports,
--  v_latest_stock — vérifié table par table).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v73). Idempotente.
-- ============================================================

insert into permissions (key, label, category) values
  ('view_journal', 'Journal de bord', 'Pilotage')
on conflict (key) do nothing;

insert into role_permissions (role_key, permission_key) values
  ('directeur', 'view_journal')
on conflict do nothing;
