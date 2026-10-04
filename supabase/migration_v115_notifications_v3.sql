-- ============================================================
--  MIGRATION v115 — 3 déclencheurs de plus (compte à valider, accès
--  retiré, client suspendu), qui ont besoin de savoir QUAND une ligne a
--  changé (pas seulement quand elle a été créée).
--
--  profiles.created_at existait déjà (réutilisé pour compte_a_valider —
--  nouveau profil, approved=false). Mais "accès retiré" et "client
--  suspendu" sont des bascules sur une ligne EXISTANTE (profiles.approved
--  true→false, organisations.statut →'suspendu') : sans colonne horaire
--  dédiée, impossible de distinguer "vient de changer" de "n'a jamais
--  changé" pour le curseur du poller. D'où ces deux updated_at — posées
--  explicitement par le code (Stations.jsx, Clients.jsx), pas de trigger
--  automatique, comme le reste de l'appli (voir compte_bancaire_solde_initial).
-- ============================================================

alter table profiles add column if not exists updated_at timestamptz;
alter table organisations add column if not exists updated_at timestamptz;

insert into notification_rules (trigger_key, nom, destinataires, sujet, corps_html, actif)
select * from (values
  ('compte_a_valider', 'Compte employé en attente de validation',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Nouveau compte en attente de validation',
    'Un nouveau compte ({{nom}} — {{email}}) vient de s''inscrire et attend d''être validé.<br><br>Rendez-vous dans Stations et équipe pour lui attribuer une station et valider l''accès.',
    false),
  ('compte_retire', 'Accès compte retiré',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Accès retiré pour un compte',
    'L''accès de {{nom}} a été retiré de l''application.<br><br>Si c''est une erreur, le compte peut être revalidé depuis Stations et équipe.',
    false),
  ('client_suspendu', 'Client suspendu',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Votre accès PumpIT a été suspendu',
    'L''accès de {{station}} à PumpIT a été suspendu.<br><br>Vos données sont conservées. Contactez PumpIT pour régulariser et retrouver l''accès.',
    false)
) as v(trigger_key, nom, destinataires, sujet, corps_html, actif)
where not exists (select 1 from notification_rules r where r.trigger_key = v.trigger_key);
