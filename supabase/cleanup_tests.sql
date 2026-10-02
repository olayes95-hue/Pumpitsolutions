-- ============================================================
--  NETTOYAGE DES DONNÉES DE TEST — à lancer UNE FOIS avant la vraie
--  mise en service. Ne touche PAS aux données historiques
--  (409 points + 382 versements datés 2025–2026).
--  Supabase > SQL Editor > Run.
-- ============================================================

-- 1) Toutes les lignes datées dans le FUTUR (créées par les tests : 2090+)
delete from daily_reports where report_date > current_date;
delete from deposits      where report_date > current_date;
delete from expenses      where report_date > current_date;
delete from deliveries    where report_date > current_date;
delete from submissions   where report_date > current_date;
delete from inspections   where date_controle > current_date;
delete from fuel_orders   where report_date > current_date;

-- 2) Commandes de test restées "en cours" (jamais réceptionnées, créées par tests)
delete from fuel_orders where statut in ('proposee','validee','lancee')
  and created_at::date >= current_date - 1;

-- 3) Versements/dépenses de test créés aujourd'hui par des comptes de test
delete from deposits d using auth.users u
  where d.created_by = u.id and d.report_date >= current_date
    and (u.email like '%@example.com' or u.email ~ '(test|qa|loader|cleanup|probe|full|role|stationsec|v[0-9])');

-- 4) Journal d'audit : repartir propre (efface les événements générés par les tests)
truncate table audit_log restart identity;

-- 5) Notifications de test
delete from notifications;

-- (Optionnel) supprimer les comptes de test — décommente si tu veux faire le ménage
-- dans Authentication > Users. NE PAS supprimer le compte "seed.loader…" qui porte
-- l'historique. Le plus simple : les supprimer un par un dans le dashboard Auth.
