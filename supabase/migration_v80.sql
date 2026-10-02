-- v_reorder_lubrifiant ne couvrait que le lubrifiant, alors que toute l'infrastructure
-- sous-jacente (v_stock_theorique, v_sorties_deduites) couvre déjà le gaz aussi (via
-- daily_reports.gaz_stock_3/6/12/38, cf. v_stock_declare_jour). Généralisée en
-- v_reorder_produit : même calcul, categorie en plus, sans filtre sur 'lubrifiant'.

drop view if exists v_reorder_lubrifiant;

create or replace view v_reorder_produit as
with p as (
  select coalesce(delai_livraison_jours, 3) as lead_def, coalesce(jours_securite, 2) as secu
  from settings where id = 1
),
conso as (
  select station_id, categorie, produit,
    avg(greatest(sortie_deduite, 0)) as conso_moy_jour,
    count(*) filter (where sortie_deduite > 0) as freq_jours_sortie
  from v_sorties_deduites
  where categorie in ('gaz', 'lubrifiant') and report_date > current_date - 30
  group by station_id, categorie, produit
)
select
  t.station_id, t.categorie, t.produit,
  t.stock_declare as dernier_stock_declare,
  t.stock_theorique as stock_theorique_actuel,
  coalesce(c.conso_moy_jour, 0) as conso_moy_jour,
  coalesce(c.freq_jours_sortie, 0) as freq_jours_sortie,
  pr.seuil as stock_minimum,
  greatest(coalesce(pr.seuil, 0), round(coalesce(c.conso_moy_jour, 0) * ((select lead_def from p) + (select secu from p)))) as stock_cible,
  greatest(0, greatest(coalesce(pr.seuil, 0), round(coalesce(c.conso_moy_jour, 0) * ((select lead_def from p) + (select secu from p)))) - t.stock_theorique) as quantite_a_commander,
  pr.conditionnement_nom, pr.conditionnement_qte,
  case when coalesce(pr.conditionnement_qte, 0) > 0
    then ceil(greatest(0, greatest(coalesce(pr.seuil, 0), round(coalesce(c.conso_moy_jour, 0) * ((select lead_def from p) + (select secu from p)))) - t.stock_theorique) / pr.conditionnement_qte)
    end as cartons_a_commander,
  pr.prix_achat,
  pr.prix_achat * greatest(0, greatest(coalesce(pr.seuil, 0), round(coalesce(c.conso_moy_jour, 0) * ((select lead_def from p) + (select secu from p)))) - t.stock_theorique) as cout_estimatif,
  exists(select 1 from fuel_orders o where o.station_id = t.station_id and o.categorie = t.categorie and o.produit = t.produit
    and o.statut in ('proposee', 'validee', 'lancee', 'partielle')) as commande_en_cours
from v_stock_theorique t
join products pr on pr.categorie = t.categorie and pr.nom = t.produit
left join conso c on c.station_id = t.station_id and c.categorie = t.categorie and c.produit = t.produit
where t.categorie in ('gaz', 'lubrifiant');

grant select on v_reorder_produit to authenticated, anon;
