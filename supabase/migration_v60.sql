-- ============================================================
--  MIGRATION v60 — Lubrifiants, Phase F : suggestions de réappro.
--
--  v_reorder (essence/gasoil) est façonnée autour de deux scalaires
--  station-wide, pas d'un produit par ligne — inadaptée au lubrifiant
--  (plusieurs références par station). Vue sœur, une ligne par produit :
--
--   - conso_moy_jour / freq_jours_sortie : calculées depuis les
--     mouvements de sortie (stock_movements) des 30 derniers jours —
--     PAS depuis v_sorties_deduites (résiduel déclaratif, pas un
--     mouvement identifié par raison).
--   - stock_theorique_actuel : v_stock_theorique (Phase D).
--   - stock_cible : réutilise settings.delai_livraison_jours /
--     jours_securite déjà en place pour essence/gasoil, pas de nouveau
--     champ de délai par produit.
--   - cartons_a_commander : arrondi au carton supérieur via
--     products.conditionnement_qte (Phase A/B) — le gérant n'a jamais
--     à calculer un nombre de cartons lui-même.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v59). Idempotente.
-- ============================================================

create or replace view v_reorder_lubrifiant as
with p as (
  select coalesce(delai_livraison_jours, 3) as lead_def, coalesce(jours_securite, 2) as secu
  from settings where id = 1
),
conso as (
  select station_id, produit,
    avg(qte_jour) as conso_moy_jour,
    count(*) filter (where qte_jour > 0) as freq_jours_sortie
  from (
    select station_id, produit, date_mouvement,
      sum(case when type = 'sortie' then quantite else 0 end) as qte_jour
    from stock_movements
    where categorie = 'lubrifiant' and date_mouvement > current_date - 30
    group by station_id, produit, date_mouvement
  ) d
  group by station_id, produit
)
select
  t.station_id, t.produit,
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
  exists(select 1 from fuel_orders o where o.station_id = t.station_id and o.categorie = 'lubrifiant' and o.produit = t.produit
    and o.statut in ('proposee', 'validee', 'lancee', 'partielle')) as commande_en_cours
from v_stock_theorique t
join products pr on pr.categorie = 'lubrifiant' and pr.nom = t.produit
left join conso c on c.station_id = t.station_id and c.produit = t.produit
where t.categorie = 'lubrifiant';

grant select on v_reorder_lubrifiant to authenticated, anon;
