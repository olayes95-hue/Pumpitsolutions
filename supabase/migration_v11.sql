-- ============================================================
--  MIGRATION v11 — Anti-fraude : journal d'audit inviolable,
--  verrouillage du passé, suppressions restreintes, rôle pompiste.
--  À exécuter dans Supabase > SQL Editor > Run (après v10).
-- ============================================================

-- ---------- Rôle "pompiste" ----------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('gerant','admin','pompiste'));

create or replace function public.my_role()
returns text language sql stable security definer set search_path=public as $$
  select role from profiles where id = auth.uid();
$$;

-- ---------- Journal d'audit (immuable) ----------
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  table_name text, row_id text, action text,
  station_id bigint, changed_by uuid, changed_by_email text,
  old_data jsonb, new_data jsonb,
  changed_at timestamptz default now());
create index if not exists idx_audit_time on audit_log(changed_at desc);
create index if not exists idx_audit_station on audit_log(station_id, changed_at desc);

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_sid bigint; v_email text; v_row record;
begin
  v_row := case when tg_op='DELETE' then old else new end;
  begin v_sid := v_row.station_id; exception when others then v_sid := null; end;
  select email into v_email from auth.users where id = auth.uid();
  insert into audit_log(table_name,row_id,action,station_id,changed_by,changed_by_email,old_data,new_data)
  values (tg_table_name, v_row.id::text, tg_op, v_sid, auth.uid(), v_email,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end);
  return v_row;
end; $$;

do $$ declare t text;
begin
  foreach t in array array['daily_reports','deposits','expenses','deliveries','fuel_orders','inspections'] loop
    execute format('drop trigger if exists audit_%1$s on %1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

alter table audit_log enable row level security;
drop policy if exists p_audit_sel on audit_log;
create policy p_audit_sel on audit_log for select using (is_admin());
grant select on audit_log to authenticated;

-- ---------- Verrouillage du passé pour le gérant ----------
-- gérant : ne modifie que les 2 derniers jours ; admin : tout
drop policy if exists p_reports_upd on daily_reports;
create policy p_reports_upd on daily_reports for update
  using (is_admin() or (station_id = public.my_station() and report_date >= current_date - 2));
-- insert : pas de saisie trop ancienne pour le gérant (max 7 jours)
drop policy if exists p_reports_ins on daily_reports;
create policy p_reports_ins on daily_reports for insert
  with check (is_admin() or (station_id = public.my_station() and report_date >= current_date - 7));

-- ---------- Suppressions financières réservées à l'admin ----------
drop policy if exists p_exp_del on expenses;
create policy p_exp_del on expenses for delete using (is_admin());
drop policy if exists p_dep_del on deposits;
create policy p_dep_del on deposits for delete using (is_admin());
drop policy if exists p_deliv_del on deliveries;
create policy p_deliv_del on deliveries for delete using (is_admin());

-- ---------- Le pompiste ne touche pas aux données financières ----------
drop policy if exists p_dep_ins on deposits;
create policy p_dep_ins on deposits for insert
  with check (auth.role()='authenticated' and public.my_role() is distinct from 'pompiste');
drop policy if exists p_exp_ins on expenses;
create policy p_exp_ins on expenses for insert
  with check (auth.role()='authenticated' and public.my_role() is distinct from 'pompiste');
drop policy if exists p_deliv_ins on deliveries;
create policy p_deliv_ins on deliveries for insert
  with check (auth.role()='authenticated' and public.my_role() is distinct from 'pompiste');
drop policy if exists p_orders_ins on fuel_orders;
create policy p_orders_ins on fuel_orders for insert
  with check (auth.role()='authenticated' and public.my_role() is distinct from 'pompiste');
