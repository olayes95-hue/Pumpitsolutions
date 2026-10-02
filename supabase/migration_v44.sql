-- ============================================================
--  MIGRATION v44 — Détection des pompes inactives (Journal de bord).
--
--  Une pompe (E1-E4 essence, G1-G4 gasoil) est considérée « inactive »
--  si son relevé 16h n'a pas bougé sur les N dernières saisies
--  journalières où elle a été renseignée (N configurable, par défaut 5).
--  Sert aussi à détecter les pompes qu'une station n'a physiquement pas
--  (relevé toujours vide → jamais assez de valeurs pour conclure, donc
--  ni actif ni inactif, simplement ignorée côté affichage).
--
--  Calcul fait côté client (Journal.jsx) sur les derniers daily_reports —
--  pas de vue SQL dédiée, juste le paramètre configurable ci-dessous.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v43). Idempotente.
-- ============================================================

alter table settings add column if not exists pompe_inactive_apres integer not null default 5;
