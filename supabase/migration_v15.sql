-- ============================================================
--  MIGRATION v15 — Commissions automatiques sur tous les pôles
--  (taux de commission gaz/lubrifiant et supérette paramétrables).
--  À exécuter dans Supabase > SQL Editor > Run (après v14).
-- ============================================================

alter table settings add column if not exists taux_gaz numeric default 8;        -- % commission gaz+lubrifiant
alter table settings add column if not exists taux_superette numeric default 8;  -- % commission supérette
