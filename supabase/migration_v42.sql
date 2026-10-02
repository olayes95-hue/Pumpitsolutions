-- ============================================================
--  MIGRATION v42 — La prévision de commande (v_reorder) ignore
--  totalement les commandes DÉJÀ EN COURS : elle criait « commander
--  maintenant » même si une commande était déjà proposée/validée/
--  lancée/partielle pour ce produit — redondant, source de confusion.
--
--  Ajoute une colonne `commande_en_cours` (bool) : vrai si une commande
--  du produit est proposée/validée/lancée/partielle pour la station.
--  Le frontend distingue alors 3 états : ok / commande déjà en cours /
--  à commander maintenant (au lieu de rouge à tort quand le camion est
--  déjà en route).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v41). Idempotente.
-- ============================================================

drop view if exists v_reorder cascade;
create view v_reorder as
with p as (
  select coalesce(delai_livraison_jours,3) as lead_def, coalesce(jours_securite,2) as secu,
         coalesce(marge_unitaire,25) as marge from settings where id=1
)
select x.*,
  round(x.conso_jour * (x.lead + x.secu)) as seuil_commande_litres,
  case when x.conso_jour > 0 then greatest(round(x.jours_restant - x.lead - x.secu), 0) end as jours_avant_commande,
  case when x.conso_jour > 0
    then (current_date + greatest(round(x.jours_restant - x.lead - x.secu), 0) * interval '1 day')::date end as date_commande_conseillee,
  case when x.jours_restant is not null then (current_date + round(x.jours_restant) * interval '1 day')::date end as date_rupture_estimee,
  -- « commander maintenant » seulement si le seuil est atteint ET qu'aucune commande n'est déjà en cours.
  (x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant <= x.lead + x.secu and not x.commande_en_cours) as commander_maintenant,
  case when x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant < x.lead and not x.commande_en_cours
    then round((x.lead - x.jours_restant) * x.conso_jour * (select marge from p)) else 0 end as manque_a_gagner_estime
from (
  select f.station_id, f.nom, 'essence'::text as produit,
    f.ess_stock as stock, f.conso_ess_jour as conso_jour, f.jours_essence as jours_restant,
    coalesce((select delai_moyen_jours from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='essence'),
             (select lead_def from p)) as lead,
    (select secu from p) as secu,
    coalesce((select nb_commandes from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='essence'),0) as nb_delai,
    exists(select 1 from fuel_orders o where o.station_id=f.station_id and o.produit='essence'
      and o.statut in ('proposee','validee','lancee','partielle')) as commande_en_cours
  from v_stock_forecast f
  union all
  select f.station_id, f.nom, 'gasoil',
    f.gas_stock, f.conso_gas_jour, f.jours_gasoil,
    coalesce((select delai_moyen_jours from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='gasoil'),
             (select lead_def from p)),
    (select secu from p),
    coalesce((select nb_commandes from v_delai_moyen dm where dm.station_id=f.station_id and dm.produit='gasoil'),0),
    exists(select 1 from fuel_orders o where o.station_id=f.station_id and o.produit='gasoil'
      and o.statut in ('proposee','validee','lancee','partielle'))
  from v_stock_forecast f
) x;

grant select on v_reorder to authenticated, anon;
