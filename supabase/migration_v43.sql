-- ============================================================
--  MIGRATION v43 — Interrupteur « Bons utilisables pour les commandes ».
--
--  Aujourd'hui, une commande carburant peut être financée en partie par
--  des bons + un complément chèque. Bientôt, les bons seront virés
--  directement sur le compte bancaire de la station — il ne sera plus
--  possible de les utiliser pour payer une commande, qui devra donc être
--  réglée à 100 % par chèque.
--
--  Ce réglage (activé par défaut = comportement actuel inchangé) permet à
--  l'admin de basculer lui-même le jour venu, sans intervention développeur :
--  le formulaire de commande (carburant + gaz/lubrifiant) masque alors
--  l'option bons et n'autorise plus que le chèque.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v42). Idempotente.
-- ============================================================

alter table settings add column if not exists bons_utilisables_commande boolean not null default true;
