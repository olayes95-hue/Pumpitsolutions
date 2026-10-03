-- ============================================================
--  MIGRATION v105 — Prévision de commande : écran à part
--
--  Les prévisions carburant (Tableau de bord) et gaz/lubrifiant (Stock et
--  mouvements) sont regroupées dans un seul écran "Prévision de commande".
--  Nouvelle permission view_prevision, accordée par défaut au directeur
--  (en plus de l'admin, qui y a toujours accès) — pas au comptable ni au
--  gérant par défaut ; l'admin peut l'ajouter à un autre rôle depuis
--  Stations & équipe → Rôles s'il le souhaite.
--
--  L'écran reste aussi soumis à la fonction "prevision" de l'offre de la
--  station (déjà en place depuis la v102/v103) : il faut les DEUX pour le
--  voir — la permission (qui, chez le client) et la fonction (l'offre le
--  permet-elle).
-- ============================================================

insert into permissions (key, label, category)
select 'view_prevision', 'Prévision de commande', 'Pilotage'
where not exists (select 1 from permissions where key = 'view_prevision');

insert into role_permissions (role_key, permission_key)
select 'directeur', 'view_prevision'
where exists (select 1 from roles where key = 'directeur')
  and not exists (select 1 from role_permissions where role_key = 'directeur' and permission_key = 'view_prevision');
