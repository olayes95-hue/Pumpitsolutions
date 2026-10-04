-- ============================================================
--  MIGRATION v113 — Module de notifications (Brevo), paramétrable
--  depuis le back-office PumpIT (super administrateur uniquement).
--
--  Deux tables :
--  - notification_rules : règles définies par l'admin plateforme —
--    quel événement (trigger_key) déclenche l'envoi, à qui
--    (destinataires, JSON), avec quel sujet/corps HTML, active ou non.
--  - notification_log : historique d'envoi (succès/échec), pour audit.
--  - notification_cursors : mémorise jusqu'où chaque trigger a déjà été
--    traité par la fonction planifiée (notification-poller), pour ne
--    jamais notifier deux fois le même événement.
--
--  Format de `destinataires` (jsonb) :
--    {"type": "fixe", "emails": ["a@x.com", "b@x.com"]}       — liste fixe
--    {"type": "evenement", "champ": "email"}                  — l'adresse
--      portée par l'événement lui-même (ex. le nouvel inscrit)
--
--  Déclencheurs (trigger_key) gérés par notification-poller au lancement :
--    'user_signup'   — nouveau compte créé (profiles.created_at)
--    'alerte_haute'  — nouvelle alerte de gravité haute (v_alerts)
--  D'autres triggers peuvent être ajoutés plus tard (poller à étendre).
--
--  RLS : réservé à is_platform_admin() — jamais aux clients. L'écriture
--  du log se fait par la fonction edge (clé service_role, hors RLS).
-- ============================================================

create table if not exists notification_rules (
  id bigint generated always as identity primary key,
  trigger_key text not null,
  nom text not null,
  destinataires jsonb not null,
  sujet text not null,
  corps_html text not null,
  actif boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists notification_log (
  id bigint generated always as identity primary key,
  rule_id bigint references notification_rules(id) on delete set null,
  trigger_key text not null,
  destinataire_email text not null,
  sujet text,
  statut text not null check (statut in ('envoye', 'echec')),
  erreur text,
  payload jsonb,
  envoye_at timestamptz default now()
);
create index if not exists idx_notification_log_envoye on notification_log(envoye_at desc);

create table if not exists notification_cursors (
  trigger_key text primary key,
  dernier_at timestamptz not null default '2000-01-01'
);

alter table notification_rules enable row level security;
alter table notification_log enable row level security;
alter table notification_cursors enable row level security;

drop policy if exists p_notif_rules_all on notification_rules;
create policy p_notif_rules_all on notification_rules for all
  using ((select is_platform_admin())) with check ((select is_platform_admin()));

drop policy if exists p_notif_log_sel on notification_log;
create policy p_notif_log_sel on notification_log for select using ((select is_platform_admin()));

drop policy if exists p_notif_cursors_sel on notification_cursors;
create policy p_notif_cursors_sel on notification_cursors for select using ((select is_platform_admin()));

grant select, insert, update, delete on notification_rules to authenticated;
grant select on notification_log, notification_cursors to authenticated;

-- Nouvelle permission plateforme 'notifications' — réservée au super administrateur, au même
-- niveau de sensibilité que 'reglages'/'agents' (paramètre qui envoie des mails en masse).
update plateforme_roles set permissions = array_append(permissions, 'notifications')
where key = 'super_admin' and not ('notifications' = any(permissions));
