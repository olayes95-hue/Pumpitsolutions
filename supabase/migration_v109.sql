-- ============================================================
--  MIGRATION v109 — Vérification du bordereau par le rapprochement bancaire.
--
--  Un versement dont le crédit est retrouvé sur le relevé bancaire (écran
--  Rapprochement) est une preuve au moins aussi fiable qu'une relecture à
--  l'œil de la photo (voir migration_v92) — la banque elle-même confirme
--  le montant. Plutôt que de forcer le comptable à revérifier à la main
--  des bordereaux déjà confirmés par la banque, le front (BankRecon.jsx)
--  marque désormais `verifie = true` automatiquement dès qu'un rapprochement
--  réussit (manuel ou automatique par date+montant), avec `verifie_source`
--  pour que « Vérif bordereaux » affiche la bonne origine au lieu de
--  toujours dire « à l'œil ».
--
--  Pas de nouvelle policy : la mise à jour passe par la policy p_dep_upd
--  existante (v92), déjà ouverte à is_admin()/my_station()/view_ocr_check.
-- ============================================================

alter table deposits add column if not exists verifie_source text
  check (verifie_source is null or verifie_source in ('manuel', 'rapprochement'));
