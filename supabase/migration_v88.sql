-- Fix : le Point financier affichait des chiffres différents pour le directeur/comptable que
-- pour l'admin. Cause : 6 tables utilisées par Finance.jsx (charges, compte_bancaire_mouvements,
-- compte_bancaire_solde_initial, finance_bons_reconciliation, finance_periodes_verrouillees,
-- finance_soldes_ouverture) faisaient partie du rollback d'urgence de plus tôt cette session
-- (fausses alertes RLS), et n'ont jamais été réélargies ensuite comme daily_reports/expenses/
-- deposits/deliveries (v77) ou alert_dismissals (v83) — restées sur la policy simple
-- is_admin() OR station_id = my_station(), toujours fausse pour le directeur/comptable
-- (station via profile_stations, pas profiles.station_id). Même motif InitPlan-friendly
-- que les fixs précédents, gated sur view_finance (que directeur ET comptable ont).

drop policy if exists p_charges_sel on charges;
create policy p_charges_sel on charges for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_finance'))
  )
);

drop policy if exists p_cbm_sel on compte_bancaire_mouvements;
create policy p_cbm_sel on compte_bancaire_mouvements for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_finance'))
  )
);

drop policy if exists p_cbsi_sel on compte_bancaire_solde_initial;
create policy p_cbsi_sel on compte_bancaire_solde_initial for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_finance'))
  )
);

drop policy if exists p_fbr_sel on finance_bons_reconciliation;
create policy p_fbr_sel on finance_bons_reconciliation for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_finance'))
  )
);

drop policy if exists p_fpv_sel on finance_periodes_verrouillees;
create policy p_fpv_sel on finance_periodes_verrouillees for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_finance'))
  )
);

drop policy if exists p_fso_sel on finance_soldes_ouverture;
create policy p_fso_sel on finance_soldes_ouverture for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_finance'))
  )
);
