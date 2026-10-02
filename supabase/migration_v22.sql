-- ============================================================
--  MIGRATION v22 — Commandes multi-produits (gaz, lubrifiant, supérette)
--  + mode de paiement (bons / chèque / espèces) + lignes supérette.
--  À exécuter dans Supabase > SQL Editor > Run (après v21).
-- ============================================================

alter table fuel_orders add column if not exists categorie text default 'carburant'; -- carburant/gaz/lubrifiant/superette
alter table fuel_orders add column if not exists mode_paiement text;                  -- bons / cheque / especes
alter table fuel_orders add column if not exists montant_paiement numeric;            -- montant chèque/espèces (hors carburant)
alter table fuel_orders add column if not exists lignes jsonb;                        -- supérette : [{"article":"Eau 1,5L","qte":10}]

update fuel_orders set categorie = 'carburant' where categorie is null;
