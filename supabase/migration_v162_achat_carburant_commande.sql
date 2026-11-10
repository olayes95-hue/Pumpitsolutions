-- ============================================================
--  MIGRATION v162 — Achat carburant = commandes reçues, pas déduit de la marge.
--
--  Demande explicite de l'utilisateur : "les achats carburant c'est tout ce
--  qui est passé en commande, pas déduit de la marge réelle" — jusqu'ici
--  achatCarburant (Finance.jsx) était backé depuis vente − commission
--  (un residu théorique), pas une donnée d'achat réelle.
--
--  v_pertes_mensuelles agrège déjà v_pertes_livraison (qui a, par
--  commande reçue : livre = quantité réellement livrée, prix_achat) —
--  ajoute juste la colonne achat_carburant = sum(livre * prix_achat),
--  même source que les pertes, cohérent avec le traitement gaz/lubrifiant/
--  supérette (achat = livraisons RÉCEPTIONNÉES, pas commandées en cours
--  — celles-là restent un actif "en transit" dans le Bilan, pas une charge).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v161, ou après v160
--  si v161 n'a pas encore été appliquée — indépendantes).
-- ============================================================

begin;

create or replace view public.v_pertes_mensuelles as
select station_id,
  to_char(report_date::timestamptz, 'YYYY-MM') as mois,
  sum(perte_litres) as perte_litres,
  sum(perte_na_litres) as perte_na_litres,
  sum(perte_na_montant) as perte_na_montant,
  count(*) filter (where perte_na_litres > 0) as nb_livraisons_hors_seuil,
  sum(perte_montant) as perte_montant,
  sum(livre * prix_achat) as achat_carburant
from v_pertes_livraison
group by station_id, to_char(report_date::timestamptz, 'YYYY-MM');

alter view public.v_pertes_mensuelles set (security_invoker = on);

commit;
