-- ============================================================
--  MIGRATION v8 — Prix d'achat carburant (admin) +
--  commande rattachée à un jour (réception).
--  À exécuter dans Supabase > SQL Editor > Run (après v7).
-- ============================================================

-- Prix d'achat paramétrables (par défaut = prix de vente − marge)
alter table settings add column if not exists essence_pa numeric default 705;
alter table settings add column if not exists gasoil_pa  numeric default 730;

-- Commande rattachée à un jour + coût d'achat
alter table fuel_orders add column if not exists report_date date;   -- jour de réception
alter table fuel_orders add column if not exists prix_achat numeric; -- prix d'achat unitaire retenu
alter table fuel_orders add column if not exists montant numeric;    -- coût = quantité × prix d'achat
