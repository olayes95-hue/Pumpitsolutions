-- ============================================================
--  MIGRATION v20 — Commandes : complément chèque + dates saisissables.
--  À exécuter dans Supabase > SQL Editor > Run (après v19).
-- ============================================================

alter table fuel_orders add column if not exists cheque_montant numeric;   -- complément payé par chèque
alter table fuel_orders add column if not exists cheque_ref text;          -- n° / réf du chèque
alter table fuel_orders add column if not exists date_proposition date;    -- date de la proposition
alter table fuel_orders add column if not exists date_lancement date;      -- date de lancement
-- (la date de réception reste report_date)
