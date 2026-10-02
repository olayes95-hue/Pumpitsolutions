-- ============================================================
--  MIGRATION v89 — Fix sécurité : 2 vues repassées SECURITY DEFINER
--  (linter Supabase, alerte niveau ERROR).
--
--  v61 avait déjà mis toutes les vues existantes en `security_invoker = on`
--  (voir son commentaire pour le détail du risque). Depuis :
--  - `v_stock_recon` a été recréée en `create or replace view` dans
--    migration_v87.sql (fix écart-compteur après contrôle) — un
--    CREATE OR REPLACE VIEW sans clause WITH ne conserve PAS les
--    reloptions de l'ancienne définition, donc l'option a été
--    silencieusement perdue à ce moment-là.
--  - `v_reorder_produit` (migration_v80.sql, extension gaz des
--    suggestions de commande) est postérieure à la liste couverte par
--    v61 et n'a jamais reçu l'option.
--
--  Fix identique à v61 : `security_invoker = on` fait exécuter la vue
--  avec les droits de l'appelant, donc les RLS des tables sous-jacentes
--  s'appliquent normalement. Idempotente, ne touche aucune définition
--  de vue, juste l'option. À exécuter dans Supabase > SQL Editor > Run.
-- ============================================================

alter view public.v_stock_recon set (security_invoker = on);
alter view public.v_reorder_produit set (security_invoker = on);
