-- Fix URGENT : la policy UPDATE de fuel_orders (réécrite cette session, v73/v77) ne
-- couvrait QUE le cas multi-stations (array[station_id] && my_accessible_stations(),
-- basé sur profile_stations). Or AUCUN gérant/pompiste n'a de ligne dans profile_stations
-- (ils reposent tous sur l'ancien profiles.station_id) — my_accessible_stations() leur
-- renvoie donc toujours un tableau vide, et la policy bloque SILENCIEUSEMENT toute mise à
-- jour de fuel_orders (lancer une commande, marquer une réception partielle/reçue) pour
-- ces comptes, alors que l'écriture de la réception elle-même (order_receptions, qui a
-- gardé son ancien check station_id = my_station()) réussit — d'où des commandes bloquées
-- au statut "lancée" malgré des réceptions bien enregistrées.
--
-- Fix : ajoute le fallback station_id = my_station() (ancien mécanisme mono-station) à
-- côté du check multi-stations existant, sur chaque branche.

drop policy if exists p_orders_upd on fuel_orders;
create policy p_orders_upd on fuel_orders for update
  using (
    is_admin()
    or (
      (select public.my_permissions()) && array['manage_orders']
      and (station_id = (select public.my_station()) or array[station_id] && (select public.my_accessible_stations()))
    )
    or (
      (select public.my_permissions()) && array['validate_orders']
      and (station_id = (select public.my_station()) or array[station_id] && (select public.my_accessible_stations()))
      and statut = 'proposee'
    )
  )
  with check (
    is_admin()
    or (
      (select public.my_permissions()) && array['manage_orders']
      and (station_id = (select public.my_station()) or array[station_id] && (select public.my_accessible_stations()))
    )
    or (
      (select public.my_permissions()) && array['validate_orders']
      and (station_id = (select public.my_station()) or array[station_id] && (select public.my_accessible_stations()))
      and statut in ('validee', 'annulee')
    )
  );
