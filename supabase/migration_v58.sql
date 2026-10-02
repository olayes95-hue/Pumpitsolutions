-- ============================================================
--  MIGRATION v58 — Lubrifiants, Phase A : fondation additive.
--
--  Objectif : préparer le terrain pour (1) le conditionnement
--  (carton/bidon) par produit et (2) un vocabulaire de mouvement
--  plus riche (casse, perte, consommation interne, retours,
--  correction d'inventaire), sans rien casser de l'existant.
--
--  Tout est nullable/additif :
--   - products.unite_stock / conditionnement_nom / conditionnement_qte
--     ne sont lus par aucune vue ni page tant que Phase B/C ne les
--     exploite pas.
--   - stock_movements.qte_saisie / unite_saisie / facteur_conversion /
--     detail_saisie sont des colonnes de traçabilité de la saisie ;
--     `quantite` garde exactement son sens actuel (quantité canonique
--     déjà convertie), donc v_stock_produits, v_sorties_deduites et
--     v_stock_valeur continuent de fonctionner sans modification.
--   - `type` (entree/sortie/ajustement) n'est PAS touché : le nouveau
--     vocabulaire métier (casse, perte, consommation_interne,
--     retour_fournisseur, retour_client, vente, correction_inventaire)
--     vit dans `source`, déjà en texte libre — la correspondance
--     source→type est gérée côté application (Phase C).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v57). Idempotente.
-- ============================================================

alter table products add column if not exists unite_stock text;
alter table products add column if not exists conditionnement_nom text;
alter table products add column if not exists conditionnement_qte numeric;

alter table stock_movements add column if not exists qte_saisie numeric;
alter table stock_movements add column if not exists unite_saisie text;
alter table stock_movements add column if not exists facteur_conversion numeric;
alter table stock_movements add column if not exists detail_saisie text;
