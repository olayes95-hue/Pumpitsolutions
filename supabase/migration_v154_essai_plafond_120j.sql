-- ============================================================
--  MIGRATION v154 — Plafonne la durée d'essai gratuit à 120 jours
--  (au lieu de 365) : défense en profondeur, en plus de la validation
--  déjà posée côté front (Reglages.jsx, Clients.jsx).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v153).
-- ============================================================

begin;

alter table public.plateforme_reglages drop constraint if exists plateforme_reglages_essai_jours_check;
alter table public.plateforme_reglages add constraint plateforme_reglages_essai_jours_check check (essai_jours >= 0 and essai_jours <= 120);

-- Si la durée actuellement réglée dépassait 120 jours, la ramener au plafond pour que la
-- contrainte ci-dessus puisse s'appliquer sans échouer.
update public.plateforme_reglages set essai_jours = 120 where essai_jours > 120;

commit;
