-- ============================================================
--  MIGRATION v170 — stock_movements : lecture multi-stations.
--
--  Trouvé en construisant la vue consolidée (Tableau de bord + Stock) :
--  contrairement à daily_reports/charges/expenses/superette_sales (qui
--  supportent déjà my_accessible_stations() + permission), la policy
--  SELECT de stock_movements n'autorisait QUE is_admin() ou sa propre
--  station (my_station()) — un directeur multi-stations (profile_stations,
--  pas admin) obtenait silencieusement 0 ligne pour les autres stations.
--  Ça touche v_stock_produits, v_stock_valeur, v_stock_theorique et la
--  partie bouteilles de v_gaz_etats_bouteilles (déjà utilisée par le
--  Tableau de bord, même avant la vue consolidée).
--
--  Même pattern que p_charges_sel/p_reports_sel : accès à ses stations
--  déclarées (profile_stations) à condition d'avoir une permission de
--  lecture pertinente.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v169).
-- ============================================================

begin;

drop policy if exists p_mvt_sel on public.stock_movements;
create policy p_mvt_sel on public.stock_movements for select
  using (
    is_admin()
    or station_id = my_station()
    or (
      (array[station_id] && my_accessible_stations())
      and (has_permission('view_stock') or has_permission('view_dashboard') or has_permission('view_finance'))
    )
  );

commit;
