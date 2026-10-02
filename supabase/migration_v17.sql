-- ============================================================
--  MIGRATION v17 — Photo justificatif obligatoire sur les dépenses.
--  À exécuter dans Supabase > SQL Editor > Run (après v16).
-- ============================================================

alter table expenses add column if not exists photo_path text;  -- justificatif (photo)
