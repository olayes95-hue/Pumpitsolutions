-- ============================================================
--  MIGRATION v54 — Deux ajouts demandés :
--
--  1) Déconnexion automatique configurable (settings.deconnexion_auto_heures,
--     défaut 24h = 1 jour). Réglable dans Stations & équipe, appliquée côté app.
--
--  2) Pertes sur livraisons DANS LA NORME (pas seulement l'excès hors seuil)
--     désormais exposées en montant (perte_montant) sur v_pertes_livraison et
--     v_pertes_mensuelles, pour être comptées comme une charge au Point
--     financier même quand elles sont "acceptables" — l'essence/gasoil non
--     livré reste un coût réel pour la station, que ce soit ou non retenu
--     sur le salaire du gérant (perte_na_montant, logique séparée, inchangée).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v53). Idempotente.
-- ============================================================

alter table settings add column if not exists deconnexion_auto_heures integer not null default 24;

-- ── v_pertes_livraison : ajoute perte_montant (total) en fin de liste ──
create or replace view v_pertes_livraison as
with t as (select taux_perte_acceptable as tx from settings where id=1)
select o.id, o.station_id, o.report_date, o.produit,
  o.quantite_commandee,
  coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant) as livre,
  greatest(o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0), 0) as perte_litres,
  round(o.quantite_commandee * (select tx from t) / 100) as seuil_acceptable,
  greatest((o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0)) - o.quantite_commandee * (select tx from t)/100, 0) as perte_na_litres,
  coalesce(o.prix_achat,0) as prix_achat,
  round(greatest((o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0)) - o.quantite_commandee * (select tx from t)/100, 0) * coalesce(o.prix_achat,0)) as perte_na_montant,
  round(greatest(o.quantite_commandee - coalesce(l.livre_reel, o.cuve_apres - o.cuve_avant, 0), 0) * coalesce(o.prix_achat,0)) as perte_montant
from fuel_orders o
left join v_order_livraison l on l.order_id = o.id
where o.statut='recue' and o.quantite_commandee is not null
  and coalesce(o.categorie, 'carburant') = 'carburant'
  and (l.livre_reel is not null or (o.cuve_apres is not null and o.cuve_avant is not null));

grant select on v_pertes_livraison to authenticated, anon;

-- ── v_pertes_mensuelles : ajoute sum(perte_montant) EN DERNIER (colonnes existantes intactes) ──
create or replace view v_pertes_mensuelles as
select station_id, to_char(report_date,'YYYY-MM') as mois,
  sum(perte_litres) as perte_litres,
  sum(perte_na_litres) as perte_na_litres,
  sum(perte_na_montant) as perte_na_montant,
  count(*) filter (where perte_na_litres > 0) as nb_livraisons_hors_seuil,
  sum(perte_montant) as perte_montant
from v_pertes_livraison
group by station_id, to_char(report_date,'YYYY-MM');

grant select on v_pertes_livraison, v_pertes_mensuelles to authenticated, anon;
