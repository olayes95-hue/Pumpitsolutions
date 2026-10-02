-- ============================================================
--  MIGRATION v26 — Stock gaz/lubrifiant = STOCK DÉCLARÉ chaque jour.
--  Les SORTIES (consommation) ne sont plus générées depuis les ventes :
--  elles sont DÉDUITES de deux relevés consécutifs déclarés par le gérant :
--      sortie(J) = stock_déclaré(J-1) + entrées(J) − stock_déclaré(J)
--  À exécuter dans Supabase > SQL Editor > Run (après v25).
-- ============================================================

-- 0) Nettoyage : supprimer les anciennes sorties AUTO gaz/lubrifiant (doublons
--    qui rendaient le stock négatif). On garde les entrées (achats/livraisons)
--    et la supérette (suivie en valeur).
delete from stock_movements
where source = 'vente' and categorie in ('gaz', 'lubrifiant');

-- 1) Dépivotage du stock DÉCLARÉ par produit et par jour (gaz + lubrifiant)
create or replace view v_stock_declare_jour as
with g as (
  select station_id, report_date, '3 kg'::text as produit, 'gaz'::text as categorie, gaz_stock_3::numeric as q
    from daily_reports where gaz_stock_3 is not null
  union all select station_id, report_date, '6 kg', 'gaz', gaz_stock_6  from daily_reports where gaz_stock_6  is not null
  union all select station_id, report_date, '12 kg','gaz', gaz_stock_12 from daily_reports where gaz_stock_12 is not null
  union all select station_id, report_date, '38 kg','gaz', gaz_stock_38 from daily_reports where gaz_stock_38 is not null
),
l as (
  select r.station_id, r.report_date, kv.key as produit, 'lubrifiant'::text as categorie,
         nullif(kv.value,'')::numeric as q
  from daily_reports r, jsonb_each_text(coalesce(r.lubrifiant_stock, '{}'::jsonb)) kv
  where r.lubrifiant_stock is not null and nullif(kv.value,'') is not null
)
select * from g union all select * from l;

grant select on v_stock_declare_jour to authenticated, anon;

-- 2) Stock actuel = DERNIER relevé déclaré par produit (remplace le calcul par mouvements)
create or replace view v_stock_produits as
select distinct on (station_id, categorie, produit)
  station_id, categorie, produit, q as stock
from v_stock_declare_jour
order by station_id, categorie, produit, report_date desc;

grant select on v_stock_produits to authenticated, anon;

-- 3) Sorties DÉDUITES : consommation du jour = déclaré(veille) + entrées(jour) − déclaré(jour)
create or replace view v_sorties_deduites as
with seq as (
  select d.*,
    lag(q)           over (partition by station_id, categorie, produit order by report_date) as q_veille,
    lag(report_date) over (partition by station_id, categorie, produit order by report_date) as date_veille
  from v_stock_declare_jour d
)
select
  s.station_id, s.report_date, s.categorie, s.produit,
  s.q_veille as stock_veille,
  s.q        as stock_jour,
  coalesce((select sum(m.quantite) from stock_movements m
     where m.station_id = s.station_id and m.categorie = s.categorie and m.produit = s.produit
       and m.type = 'entree' and m.date_mouvement = s.report_date), 0) as entrees,
  ( s.q_veille
    + coalesce((select sum(m.quantite) from stock_movements m
        where m.station_id = s.station_id and m.categorie = s.categorie and m.produit = s.produit
          and m.type = 'entree' and m.date_mouvement = s.report_date), 0)
    - s.q ) as sortie_deduite
from seq s
where s.q_veille is not null;

grant select on v_sorties_deduites to authenticated, anon;

-- Note : v_stock_valeur (valorisation) s'appuie sur v_stock_produits → reflète
-- désormais le stock déclaré. Aucune modification nécessaire de son côté.
