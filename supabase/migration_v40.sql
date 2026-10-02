-- ============================================================
--  MIGRATION v40 — Perte livraison correcte pour les commandes
--  reçues en PLUSIEURS fois (réceptions partielles).
--
--  Problème : fuel_orders.cuve_avant = cuve_avant de la 1re réception,
--  cuve_apres = cuve_apres de la DERNIÈRE réception (écrasé à chaque
--  réception). Pour une commande reçue en 2+ fois, si du carburant a été
--  VENDU entre les deux livraisons, (dernier cuve_apres − premier cuve_avant)
--  inclut ces ventes → perte de livraison FAUSSEMENT gonflée. Cette perte
--  alimente le Point financier (base de retenue potentielle sur salaire) :
--  impact réel, pas juste cosmétique.
--
--  Correctif : la livraison réelle = SOMME des (cuve_apres − cuve_avant)
--  de CHAQUE réception individuelle (order_receptions stocke déjà cuve
--  avant/après PAR réception) — chaque delta ne couvre que sa propre
--  livraison, insensible aux ventes entre deux réceptions.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v39). Idempotente.
-- ============================================================

create or replace view v_order_livraison as
select order_id, station_id,
  sum(case when cuve_avant is not null and cuve_apres is not null then cuve_apres - cuve_avant else 0 end) as livre_reel,
  sum(quantite_recue) as quantite_recue_total,
  count(*) as nb_receptions
from order_receptions
group by order_id, station_id;

grant select on v_order_livraison to authenticated, anon;

-- v_pertes_livraison : même colonnes qu'avant (v16), calcul de « livre » corrigé.
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
  and (l.livre_reel is not null or (o.cuve_apres is not null and o.cuve_avant is not null));

grant select on v_pertes_livraison to authenticated, anon;
-- v_pertes_mensuelles (agrégation sur v_pertes_livraison) n'a pas besoin d'être
-- recréée : même structure de colonnes, elle hérite automatiquement du correctif.
