-- ============================================================
--  MIGRATION v10 — OCR des bordereaux de versement
--  Stocke le montant lu automatiquement sur la photo + l'écart.
--  À exécuter dans Supabase > SQL Editor > Run (après v9).
-- ============================================================

alter table deposits add column if not exists montant_ocr numeric;   -- montant lu sur la photo
alter table deposits add column if not exists date_ocr date;         -- date lue
alter table deposits add column if not exists ref_ocr text;          -- référence lue
alter table deposits add column if not exists ocr_ecart numeric;     -- montant_ocr − montant déclaré
alter table deposits add column if not exists ocr_at timestamptz;    -- date de l'analyse
