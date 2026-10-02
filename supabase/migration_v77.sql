-- Reintroduit l'acces multi-stations du directeur (revert d'urgence v75)
-- sur daily_reports/expenses/deposits/deliveries, cette fois avec le motif
-- qui evite le piege de performance de v73 :
--   - is_admin()/my_station() enveloppes en (select ...) -> InitPlan unique
--   - has_permission('cle constante') enveloppe en (select ...) -> InitPlan
--     unique par cle (l'argument ne depend pas de la ligne scannee)
--   - appartenance aux stations via un tableau precalcule UNE FOIS
--     (my_accessible_stations(), fonction 0-argument donc hoistable) puis
--     un simple test de recouvrement de tableau par ligne
--     (array[station_id] && ...), pas un appel de fonction par ligne.
--
-- Confirme via EXPLAIN ANALYZE (transaction annulee) avec le compte
-- directeur de test, station 1 : 463 lignes retournees (identique a
-- l'admin), 101 ms d'execution (contre 17 701 ms avec l'ancienne
-- version non enveloppee de ce meme elargissement en v73).

create or replace function public.my_accessible_stations()
returns bigint[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(station_id), '{}'::bigint[])
  from public.profile_stations
  where profile_id = auth.uid();
$$;

create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    join public.role_permissions rp on rp.role_key = p.role
    where p.id = auth.uid() and rp.permission_key = p_key
  );
$$;

drop policy if exists p_reports_sel on daily_reports;
create policy p_reports_sel on daily_reports for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (
      (select has_permission('view_dashboard'))
      or (select has_permission('view_history'))
      or (select has_permission('view_finance'))
    )
  )
);

drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (
      (select has_permission('view_dashboard'))
      or (select has_permission('view_history'))
      or (select has_permission('view_finance'))
    )
  )
);

drop policy if exists p_dep_sel on deposits;
create policy p_dep_sel on deposits for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (
      (select has_permission('view_dashboard'))
      or (select has_permission('view_history'))
      or (select has_permission('view_finance'))
    )
  )
);

drop policy if exists p_deliv_sel on deliveries;
create policy p_deliv_sel on deliveries for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (
      (select has_permission('view_dashboard'))
      or (select has_permission('view_history'))
      or (select has_permission('view_finance'))
    )
  )
);
