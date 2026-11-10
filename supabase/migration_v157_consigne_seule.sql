-- ============================================================
--  MIGRATION v157 — Commande de gaz : 3ème mode "consigne seule".
--
--  Précision donnée par l'utilisateur après la livraison de v155 : une
--  commande de gaz n'est pas juste "recharge seule" ou "recharge + consigne"
--  (migration_v155) — on doit aussi pouvoir commander la CONSIGNE SEULE
--  (des bouteilles neuves vides, sans contenu — reconstituer un stock de
--  bouteilles sans passer par un remplissage), coût = consigne_prix_achat
--  seul (pas prix_achat).
--
--  fuel_orders.avec_consigne (v155) reste tel quel : recharge + consigne,
--  additif. Nouvelle colonne consigne_seule : consigne seule, exclusive
--  de avec_consigne (contrainte ci-dessous).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v156).
-- ============================================================

begin;

alter table public.fuel_orders add column if not exists consigne_seule boolean not null default false;

alter table public.fuel_orders drop constraint if exists fuel_orders_consigne_exclusive_check;
alter table public.fuel_orders add constraint fuel_orders_consigne_exclusive_check
  check (not (avec_consigne and consigne_seule));

commit;
