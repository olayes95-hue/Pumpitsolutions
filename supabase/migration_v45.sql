-- ============================================================
--  MIGRATION v45 — Capacité des cuves (état des cuves, Journal de bord).
--
--  Permet d'afficher le niveau de chaque cuve en % de sa capacité réelle
--  (jauge visuelle), pas seulement en litres bruts. Capacité par station
--  (chaque station peut avoir des cuves de taille différente), une valeur
--  pour la cuve essence et une pour la cuve gasoil — 20 000 L par défaut
--  pour les deux, modifiable par station dans Stations & équipe.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v44). Idempotente.
-- ============================================================

alter table stations add column if not exists capacite_essence numeric not null default 20000;
alter table stations add column if not exists capacite_gasoil numeric not null default 20000;
