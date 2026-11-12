-- ============================================================
--  MIGRATION v166 — Réception gaz promo : plusieurs types par livraison.
--
--  v165 ne permettait qu'un seul type (taille) par réception déclarée —
--  demande de l'utilisateur : une même livraison peut contenir 1, 2 ou
--  plusieurs tailles de bouteilles à la fois. Remplace les colonnes
--  taille/quantite/prix_vente_unitaire par un tableau `lignes` jsonb
--  (une entrée par taille), même pattern que fuel_orders.lignes pour
--  les commandes supérette multi-articles. Le reste (montant à
--  retourner au fournisseur, échéance NCE, photo, statut) reste unique
--  par réception : une seule NCE couvre toute la livraison, quel que
--  soit le nombre de types de bouteilles.
--
--  Aucune donnée existante à migrer (fonctionnalité déployée sans
--  usage réel encore) — remplacement direct des colonnes.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v165).
-- ============================================================

begin;

alter table public.gaz_promo_receptions add column if not exists lignes jsonb;

update public.gaz_promo_receptions
  set lignes = jsonb_build_array(jsonb_build_object('taille', taille, 'quantite', quantite, 'prix_vente_unitaire', prix_vente_unitaire))
  where lignes is null and taille is not null;

alter table public.gaz_promo_receptions alter column lignes set not null;
alter table public.gaz_promo_receptions drop column if exists taille;
alter table public.gaz_promo_receptions drop column if exists quantite;
alter table public.gaz_promo_receptions drop column if exists prix_vente_unitaire;

commit;
