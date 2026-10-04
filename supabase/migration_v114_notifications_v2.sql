-- ============================================================
--  MIGRATION v114 — Notifications v2 : catalogue complet de déclencheurs
--  + paramétrage par offre.
--
--  1) notification_rules gagne deux colonnes pour limiter une règle à
--     certaines offres :
--     - requiert_fonction : si posée, la règle ne s'applique qu'aux
--       stations dont l'offre inclut cette fonction (formules.fonctions,
--       même mécanique que le reste de l'appli — voir has(fonction)).
--     - formules : liste directe de clés d'offre (essentiel/pro/complet)
--       si la règle ne correspond à aucune fonction existante.
--     Aucune des deux posée = la règle s'applique à toutes les offres.
--
--  2) Règles de démarrage, INACTIVES par défaut (actif=false) — à
--     relire, ajuster les destinataires fixes si besoin, puis activer
--     depuis Notifications. destinataires de type 'roles_client' :
--     résolu par le poller vers les comptes admin/directeur de
--     l'organisation (évènements plateforme) ou de la station
--     concernée (évènements opérationnels).
-- ============================================================

alter table notification_rules add column if not exists requiert_fonction text;
alter table notification_rules add column if not exists formules text[];

insert into notification_rules (trigger_key, nom, destinataires, sujet, corps_html, actif)
select * from (values
  ('versement_manquant', 'Versement manquant',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Versement manquant — {{station}}',
    'Le {{date}}, {{station}} signale : {{detail}}.<br><br>Nous vous recommandons de vérifier la Saisie du jour correspondante et le Journal de bord afin d''identifier la cause de cet écart.',
    false),
  ('versement_incomplet', 'Versement incomplet',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Versement incomplet — {{station}}',
    'Le {{date}}, {{station}} signale : {{detail}}.<br><br>Merci de vérifier la Saisie du jour correspondante.',
    false),
  ('ecart_caisse', 'Écart de caisse',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Écart de caisse détecté — {{station}}',
    'Le {{date}}, {{station}} signale : {{detail}}.<br><br>À vérifier dans le Journal de bord.',
    false),
  ('ecart_compteur', 'Écart de compteur carburant',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Écart de compteur carburant — {{station}}',
    'Le {{date}}, {{station}} signale : {{detail}}.<br><br>Vérifiez les relevés matin/16h/soir.',
    false),
  ('ecart_stock', 'Écart de stock',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Écart de stock — {{station}}',
    'Un écart a été détecté sur le stock de {{station}} le {{date}} : {{detail}}.',
    false),
  ('stock_bas', 'Stock bas',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Stock bas — {{station}}',
    'Le stock de {{station}} est descendu sous le seuil d''alerte le {{date}} : {{detail}}.<br><br>Pensez à commander.',
    false),
  ('point_manquant', 'Journée non saisie',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Journée non saisie — {{station}}',
    'Aucune saisie n''a été enregistrée pour {{station}} le {{date}}.<br><br>Relancez le gérant si besoin.',
    false),
  ('releve_compteur_manquant', 'Relevé compteur manquant',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Relevé compteur manquant — {{station}}',
    'Un relevé de compteur de {{station}} du {{date}} n''a pas été renseigné : {{detail}}.',
    false),
  ('depense_non_justifiee', 'Dépense non justifiée',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Dépense sans justificatif — {{station}}',
    'Une dépense à {{station}} le {{date}} n''a ni photo ni motif renseigné : {{detail}}.',
    false),
  ('commande_a_valider', 'Commande à valider',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Commande à valider — {{station}}',
    '{{gerant}} a proposé une commande de {{produit}} ({{quantite}}) pour {{station}} le {{date}}.<br><br>Validez-la depuis Commandes.',
    false),
  ('commande_statut', 'Commande validée ou refusée',
    '{"type":"evenement","champ":"email_proposeur"}'::jsonb,
    'Votre commande a été {{statut}}',
    'Votre commande de {{produit}} pour {{station}} a été {{statut}} par {{valideur}}.',
    false),
  ('reception_ecart', 'Écart à la réception',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Écart à la réception — {{station}}',
    'La réception de la commande {{produit}} à {{station}} le {{date}} présente un écart important : {{quantite_commandee}} commandé(s) pour {{quantite_recue}} reçu(s).',
    false),
  ('essai_j3', 'Essai se termine dans 3 jours',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Votre essai PumpIT se termine dans 3 jours',
    'L''essai gratuit de {{station}} se termine le {{date_fin}}.<br><br>Pour continuer à utiliser PumpIT sans interruption, contactez-nous ou passez à un abonnement payant depuis votre espace Entreprise.',
    false),
  ('essai_termine', 'Essai terminé',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Votre essai PumpIT est terminé',
    'L''essai gratuit de {{station}} s''est terminé le {{date_fin}}. L''accès est maintenant limité.<br><br>Pour réactiver votre station, contactez PumpIT.',
    false),
  ('facture_emise', 'Facture émise',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Nouvelle facture PumpIT — {{numero}}',
    'Une nouvelle facture ({{numero}}) de {{montant}} F a été émise pour la période du {{periode_debut}} au {{periode_fin}}.<br><br>Consultez-la depuis votre espace Entreprise.',
    false),
  ('facture_retard', 'Facture en retard',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Facture PumpIT en attente de règlement',
    'La facture {{numero}} de {{montant}} F, émise le {{date_emission}}, n''est pas encore réglée.<br><br>Merci de régulariser pour éviter une suspension d''accès.',
    false)
) as v(trigger_key, nom, destinataires, sujet, corps_html, actif)
where not exists (select 1 from notification_rules r where r.trigger_key = v.trigger_key);
