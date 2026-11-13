-- ============================================================
--  MIGRATION v169 — Autoriser un membre de station à créer une notification.
--
--  Demande utilisateur : pendant un inventaire, un chef de piste/vendeuse peut
--  proposer un nouvel article qui n'existe pas encore au catalogue (statut
--  'en_attente', déjà géré par Products.jsx > "Produits à valider") — le
--  directeur doit en être notifié. Jusqu'ici, la table `notifications` n'avait
--  aucune policy INSERT permissive : seul le planificateur serveur (service
--  role, hors RLS) pouvait y écrire. On ajoute l'équivalent de la policy déjà
--  en place sur stock_movements (p_mvt_ins) : un membre de sa propre station,
--  ou un admin, peut créer une notification pour cette station.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v168).
-- ============================================================

begin;

create policy p_notif_ins on public.notifications for insert
  with check (is_admin() or station_id = my_station());

commit;
