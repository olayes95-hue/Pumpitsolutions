-- ============================================================
--  MIGRATION v123 — Le gérant obtient l'accès à l'Historique.
--
--  Jusqu'ici, role_permissions n'accordait au rôle 'gerant' que 'manage_orders'
--  (migration_v65/v65_v72) — Tableau de bord, Alertes, Historique et Point financier
--  étaient donc invisibles pour lui (can('view_history') etc. valent toujours faux
--  pour un rôle non-admin sans ligne dans role_permissions). Seul le Journal de bord
--  lui restait accessible (gardé en dur via `opMetier`, pas une permission) — qui ne
--  montre que des TOTAUX MENSUELS par pôle, jamais le détail jour par jour.
--
--  Conséquence concrète : quand l'alerte "versement manquant/incomplet" se déclenche,
--  le gérant ne voit qu'une phrase résumée (Journal) — seul Historique (v_pole_recon_jour
--  détaillé par jour, avec le tiroir par jour : relevés, stock, dépenses, photos) permet
--  de comprendre POURQUOI. Jusqu'ici, seul l'admin le voyait et devait envoyer des
--  captures d'écran — que le gérant ne pouvait pas explorer lui-même.
--
--  Cette migration n'accorde que view_history (déjà dans le catalogue permissions,
--  migration_v65) — pas view_finance/view_dashboard/view_alerts, non demandés ici.
--  Le cloisonnement par station du gérant est inchangé : les RLS qui s'appuient sur
--  has_permission('view_history') l'exigent toujours COMBINÉ à has_station_access(...).
-- ============================================================

insert into role_permissions (role_key, permission_key)
values ('gerant', 'view_history')
on conflict (role_key, permission_key) do nothing;
