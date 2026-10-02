-- ============================================================
--  MIGRATION v9 — Notifications 9h / 17h (point manquant)
--  Notifie gérant + admin si l'info du matin (9h) ou de 16h (17h) manque.
--  À exécuter dans Supabase > SQL Editor > Run (après v8).
--  Nécessite l'extension pg_cron (Database > Extensions > activer "pg_cron").
-- ============================================================

create table if not exists notifications (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  type text,
  message text,
  resolved boolean default false,
  created_at timestamptz default now());
create index if not exists idx_notif_station on notifications(station_id, resolved, created_at desc);

alter table notifications enable row level security;
drop policy if exists p_notif_sel on notifications;
create policy p_notif_sel on notifications for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_notif_upd on notifications;
create policy p_notif_upd on notifications for update using (is_admin() or station_id = public.my_station());

-- Détecte les infos manquantes et crée une notification (sans doublon dans la journée)
create or replace function public.notify_missing(p_moment text)
returns void language plpgsql security definer set search_path = public as $$
declare msg text;
begin
  msg := case p_moment
    when 'matin' then '⏰ 9h — Point du matin non reçu (stock + relevés d''ouverture). À envoyer rapidement.'
    when 'apres-midi' then '⏰ 17h — Relevés 16h non reçus. À envoyer rapidement.'
    else '⏰ Information manquante.' end;
  insert into notifications(station_id, type, message)
  select s.id, 'MANQUE_' || p_moment, msg
  from stations s
  where exists (select 1 from daily_reports r where r.station_id = s.id and r.report_date < current_date) -- station active
    and not exists (select 1 from submissions sub where sub.station_id = s.id and sub.report_date = current_date and sub.moment = p_moment)
    and not exists (select 1 from notifications n where n.station_id = s.id and n.type = 'MANQUE_' || p_moment and n.created_at::date = current_date);
end; $$;

grant execute on function public.notify_missing(text) to authenticated;

-- Planification (pg_cron tourne en UTC ; Bénin = UTC+1 → 9h=08:00 UTC, 17h=16:00 UTC)
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('notif-matin-9h'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('notif-16h-17h'); exception when others then null; end $$;
select cron.schedule('notif-matin-9h', '0 8 * * *',  $$ select public.notify_missing('matin') $$);
select cron.schedule('notif-16h-17h', '0 16 * * *', $$ select public.notify_missing('apres-midi') $$);

-- (Test manuel : select public.notify_missing('matin');  puis  select * from notifications; )
