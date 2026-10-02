-- ============================================================
--  MIGRATION v67 — RBAC, Phase B2 : fuel_orders UPDATE (validate vs
--  manage) + lecture élargie fuel_orders/order_receptions.
--
--  Le directeur ne peut QUE valider/refuser une commande proposée
--  (statut 'proposee' -> 'validee'/'annulee') — jamais la créer, la
--  lancer ou la réceptionner. Imposé ici au niveau RLS via la valeur
--  de statut AVANT (using) et APRÈS (with check) la transition, pas
--  seulement caché côté écran : un appel API direct qui tenterait de
--  faire passer une commande 'lancee'/'partielle' à autre chose, ou de
--  modifier une commande déjà validée, échoue quel que soit le rôle
--  qui n'a que validate_orders.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v66). Idempotente.
-- ============================================================

drop policy if exists p_orders_upd on fuel_orders;
create policy p_orders_upd on fuel_orders for update
  using (
    is_admin()
    or (has_permission('manage_orders') and has_station_access(station_id))
    or (has_permission('validate_orders') and has_station_access(station_id) and statut = 'proposee')
  )
  with check (
    is_admin()
    or (has_permission('manage_orders') and has_station_access(station_id))
    or (has_permission('validate_orders') and has_station_access(station_id) and statut in ('validee', 'annulee'))
  );

drop policy if exists p_orders_sel on fuel_orders;
create policy p_orders_sel on fuel_orders for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_dashboard') or has_permission('view_finance')
    or has_permission('validate_orders') or has_permission('manage_orders')
  ))
);

drop policy if exists p_recept_sel on order_receptions;
create policy p_recept_sel on order_receptions for select using (
  is_admin() or station_id = public.my_station()
  or (has_station_access(station_id) and (
    has_permission('view_finance') or has_permission('validate_orders') or has_permission('manage_orders')
  ))
);
