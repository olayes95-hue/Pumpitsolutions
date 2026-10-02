-- ============================================================
--  MIGRATION v70 — RBAC, Phase B5 : bank_lines éclatée + scoping station.
--
--  Aujourd'hui `for all using (is_admin())` — aucune notion de station
--  du tout (un admin voit déjà toutes les stations, donc ça n'avait
--  jamais posé de problème). Éclatée en policies SELECT/INSERT/UPDATE/
--  DELETE séparées (une seule policy "for all" ne peut pas mélanger
--  des USING différents par opération), avec view_bank_recon en
--  lecture et manage_bank_recon en écriture, scopées par station.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v69). Idempotente.
-- ============================================================

drop policy if exists p_bank_all on bank_lines;

create policy p_bank_sel on bank_lines for select using (
  is_admin() or (has_permission('view_bank_recon') and has_station_access(station_id))
);

create policy p_bank_ins on bank_lines for insert with check (
  is_admin() or (has_permission('manage_bank_recon') and has_station_access(station_id))
);

create policy p_bank_upd on bank_lines for update
  using (is_admin() or (has_permission('manage_bank_recon') and has_station_access(station_id)))
  with check (is_admin() or (has_permission('manage_bank_recon') and has_station_access(station_id)));

create policy p_bank_del on bank_lines for delete using (
  is_admin() or (has_permission('manage_bank_recon') and has_station_access(station_id))
);
