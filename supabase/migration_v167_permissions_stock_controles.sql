-- ============================================================
--  MIGRATION v167 — Permissions manquantes : Stock et Contrôles.
--
--  Signalement utilisateur : le rôle "directeur" (rôle client personnalisé,
--  créé via Stations > Rôles) ne voit pas "Stock et mouvements". Cause :
--  contrairement à presque toutes les autres pages (view_dashboard,
--  view_finance, view_history, view_journal...), l'accès à /stock et
--  /controles était gated uniquement par des rôles codés en dur
--  (gérant/pompiste/vendeuse/admin/manage_orders) — rien dans le
--  catalogue `permissions` ne pouvait donner cet accès à un rôle
--  personnalisé, même via la matrice "Rôles > Permissions" déjà en
--  place dans Stations.jsx.
--
--  Ajoute view_stock et view_controles au catalogue — maintenant
--  cochables comme n'importe quelle autre permission pour tout rôle
--  personnalisé (App.jsx utilise déjà `op || can('view_stock')` etc.,
--  voir commit correspondant).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v166).
-- ============================================================

begin;

insert into public.permissions (key, label, category) values
  ('view_stock', 'Stock et mouvements (lecture)', 'Stock'),
  ('view_controles', 'Contrôles ANM (lecture)', 'Pilotage')
on conflict (key) do nothing;

commit;
