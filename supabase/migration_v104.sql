-- ============================================================
--  MIGRATION v104 — Nombre maximum d'utilisateurs par station, par offre
--
--  L'admin de la plateforme règle, pour chaque offre (Essentiel/Pro/
--  Complet, ou toute offre créée), combien de comptes (gérant, pompiste,
--  vendeuse, admin, directeur, comptable...) peuvent être rattachés à
--  UNE MÊME station. NULL = illimité (comportement actuel inchangé pour
--  toute offre qui ne règle rien).
--
--  Appliqué côté application (Stations & équipe → Équipe, à la validation
--  d'un compte ou au changement de station) — pas en RLS : c'est une
--  limite commerciale/organisationnelle, pas une règle de sécurité, et
--  elle doit rester modifiable sans migration si l'admin change d'avis.
-- ============================================================

alter table formules add column if not exists max_utilisateurs_station integer;
