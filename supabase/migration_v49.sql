-- ============================================================
--  MIGRATION v49 — Fix : v_pertes_livraison comptait les commandes GAZ
--  comme du carburant jamais livré.
--
--  Le gaz n'a pas de notion de cuve avant/après (pas de cuve enterrée à
--  mesurer) : prix_achat/cuve_avant/cuve_apres restent volontairement
--  vides sur une commande gaz réceptionnée. Mais v_order_livraison
--  agrège TOUTES les order_receptions (toutes catégories confondues) —
--  pour une commande gaz, ça donne livre_reel = 0 (aucune ligne cuve à
--  sommer), ce qui n'est PAS null. v_pertes_livraison inclut alors la
--  commande gaz avec "livré = 0", donc "perte = quantité commandée en
--  entier" — des bouteilles de gaz bien reçues apparaissent comme du
--  carburant totalement perdu (litres > 0), avec un montant à 0 F
--  puisque le gaz n'a jamais de prix_achat renseigné.
--
--  Symptôme observé : "Pertes NON acceptables" (Point financier / Journal
--  de bord) affiche des litres non nuls alors que le "Montant (base
--  retenue)" reste à 0 F, sur une période où seules des commandes gaz
--  ont été reçues.
--
--  Fix : la vue ne considère plus que les commandes de catégorie
--  carburant (coalesce sur categorie, comme partout ailleurs dans
--  l'app, une commande sans categorie renseignée = carburant par
--  défaut, catégorie historique avant l'ajout de gaz/lubrifiant/
--  supérette aux commandes).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v48). Idempotente.
--  N'ajoute qu'une condition WHERE — ne touche pas la liste des
--  colonnes, aucun risque de casser une vue qui en dépend.
-- ============================================================

create or replace view v_pertes_livraison as
with t as (select taux_perte_acceptable as tx from settings where id=1)
select o.id, o.station_id, o.report_date, o.produit,
  o.quantite_commandee,
  coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant) as livre,
  greatest(o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0), 0) as perte_litres,
  round(o.quantite_commandee * (select tx from t) / 100) as seuil_acceptable,
  greatest((o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0)) - o.quantite_commandee * (select tx from t)/100, 0) as perte_na_litres,
  coalesce(o.prix_achat,0) as prix_achat,
  round(greatest((o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0)) - o.quantite_commandee * (select tx from t)/100, 0) * coalesce(o.prix_achat,0)) as perte_na_montant
from fuel_orders o
left join v_order_livraison l on l.order_id = o.id
where o.statut='recue' and o.quantite_commandee is not null
  and coalesce(o.categorie, 'carburant') = 'carburant'
  and (l.livre_reel is not null or (o.cuve_apres is not null and o.cuve_avant is not null));

grant select on v_pertes_livraison to authenticated, anon;
-- v_pertes_mensuelles (agrégation sur v_pertes_livraison) n'a pas besoin d'être
-- recréée : même structure de colonnes, elle hérite automatiquement du correctif.
