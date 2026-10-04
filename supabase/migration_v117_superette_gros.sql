-- ============================================================
--  MIGRATION v117 — Prix de gros (carton) pour les produits supérette.
--
--  Le conditionnement (nom + qté/carton) existait déjà sur `products` (utilisé
--  jusqu'ici pour le lubrifiant). On ajoute juste le prix d'achat du gros : le
--  prix d'achat unité s'en déduit côté front (gros ÷ qté/carton) quand le
--  conditionnement est renseigné, au lieu d'être tapé à la main.
-- ============================================================

alter table products add column if not exists prix_achat_gros numeric;
