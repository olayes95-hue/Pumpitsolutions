-- ============================================================
--  MIGRATION v118 — Supérette : stock par article (sans déclaration quotidienne).
--
--  Gaz/lubrifiant : le stock par produit vient d'une DÉCLARATION quotidienne du
--  gérant (v26) — adapté à une poignée de références. La supérette peut compter
--  des dizaines d'articles : faire déclarer un compte complet chaque jour serait
--  trop lourd. On garde donc la supérette SANS déclaration : son stock par
--  article se déduit uniquement des mouvements déjà enregistrés (livraisons,
--  sorties, corrections) — exactement la même formule que l'ancien calcul
--  gaz/lubrifiant par mouvements (v23), avant que v26 le remplace par la
--  déclaration pour CES deux catégories seulement.
--
--  v_stock_produits sert déjà de source à Stock.jsx (stock restant, seuils bas,
--  tendance) : on y ajoute la branche supérette plutôt que de dupliquer un
--  écran séparé. v_stock_valeur (valorisation, v23) n'est pas touchée.
-- ============================================================

create or replace view v_stock_produits as
select station_id, categorie, produit, stock from (
  select distinct on (station_id, categorie, produit)
    station_id, categorie, produit, q as stock
  from v_stock_declare_jour
  order by station_id, categorie, produit, report_date desc
) gaz_lubrifiant
union all
select station_id, categorie, produit,
  sum(case when type = 'sortie' then -coalesce(quantite, 0) else coalesce(quantite, 0) end) as stock
from stock_movements
where categorie = 'superette' and produit is not null and quantite is not null
group by station_id, categorie, produit;

grant select on v_stock_produits to authenticated, anon;
