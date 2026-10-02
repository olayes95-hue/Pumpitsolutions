-- ============================================================
--  MIGRATION v63 — Nettoyage du brouillon perf (v62), abandonné.
--
--  v_verse_recon_v2 / v_pole_recon_jour_v2 (migration_v62) devaient
--  remplacer les sous-requêtes corrélées de v_verse_recon /
--  v_pole_recon_jour par des LEFT JOIN + GROUP BY. Mesuré via
--  EXPLAIN ANALYZE sur données réelles (station 1, 90 jours) :
--  quasi aucun gain (44,1ms vs 42,3ms), et le plan montre que la
--  version jointure ne passe PAS à l'échelle correctement — la
--  jointure sur plage de dates (periode_debut/periode_fin) ne peut
--  pas exploiter l'index idx_dep_periode comme le fait la sous-requête
--  corrélée (qui, elle, connaît la date exacte ligne par ligne), et
--  recalcule tout l'historique de la station au lieu de se limiter à
--  la période demandée (~138 000 paires générées puis filtrées dans
--  le plan mesuré). Abandonné : la version actuelle est conservée.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v62).
-- ============================================================

drop view if exists v_pole_recon_jour_v2;
drop view if exists v_verse_recon_v2;
