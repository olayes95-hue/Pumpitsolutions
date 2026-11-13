-- ============================================================
--  MIGRATION v168 — Motif de refus sur les commandes.
--
--  Signalement utilisateur (commande carburant #67, Vedoko, bons saisis
--  à 4 655 967 F au lieu de 3 650 000 F pour 5000 L) : le validateur
--  (directeur ou autre, permission validate_orders) ne pouvait que
--  Valider/Refuser une commande proposée sans pouvoir expliquer pourquoi
--  ni corriger directement une erreur de saisie évidente — obligeant à
--  tout refaire depuis zéro (cause probable du vrai bug précédent : la
--  commande "supprimée" n'ayant en fait jamais été supprimée).
--
--  Ajoute motif_refus (texte, visible par le chef de piste) — la
--  correction directe des champs (quantité, bons, chèque, montant) ne
--  nécessite pas de colonne nouvelle, juste une UPDATE sur les champs
--  déjà existants, déjà couverte par la policy p_orders_upd.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v167).
-- ============================================================

begin;

alter table public.fuel_orders add column if not exists motif_refus text;

commit;
