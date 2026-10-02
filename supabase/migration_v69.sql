-- ============================================================
--  MIGRATION v69 — RBAC, Phase B4 : écriture finance (manage_finance).
--
--  charges, finance_periodes_verrouillees, finance_soldes_ouverture,
--  finance_bons_reconciliation, compte_bancaire_solde_initial,
--  compte_bancaire_mouvements passent de is_admin()-only à
--  is_admin() or (manage_finance + station propre/rattachée).
--
--  Décision actée : le comptable peut aussi verrouiller/déverrouiller
--  un mois (finance_periodes_verrouillees couverte par manage_finance,
--  pas réservée à l'admin) — le garde-fou mois_verrouille() sur
--  charges continue de s'appliquer identiquement à tout le monde,
--  admin compris.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v68). Idempotente.
-- ============================================================

drop policy if exists p_charges_all on charges;
create policy p_charges_all on charges for all
  using ((is_admin() or (has_permission('manage_finance') and has_station_access(station_id))) and not public.mois_verrouille(station_id, mois))
  with check ((is_admin() or (has_permission('manage_finance') and has_station_access(station_id))) and not public.mois_verrouille(station_id, mois));

drop policy if exists p_fpv_all on finance_periodes_verrouillees;
create policy p_fpv_all on finance_periodes_verrouillees for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

drop policy if exists p_fso_all on finance_soldes_ouverture;
create policy p_fso_all on finance_soldes_ouverture for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

drop policy if exists p_fbr_all on finance_bons_reconciliation;
create policy p_fbr_all on finance_bons_reconciliation for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

drop policy if exists p_cbsi_all on compte_bancaire_solde_initial;
create policy p_cbsi_all on compte_bancaire_solde_initial for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));

drop policy if exists p_cbm_all on compte_bancaire_mouvements;
create policy p_cbm_all on compte_bancaire_mouvements for all
  using (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_finance') and has_station_access(station_id)));
