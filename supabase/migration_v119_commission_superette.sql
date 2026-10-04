-- ============================================================
--  MIGRATION v119 — Commission réelle supérette (PV − PA), comme gaz/lubrifiant (v85).
--
--  Jusqu'ici la supérette était estimée à un taux fixe (settings.taux_superette % du chiffre
--  d'affaires), seule catégorie encore sur ce mode (cf. commentaire déjà présent dans
--  Stations.jsx). Elle a maintenant un catalogue par article avec prix d'achat/vente
--  (Produits & prix) et des ventes quotidiennes par produit (table superette_sales, saisie
--  vendeuse) — le même calcul réel que v_commission_reelle_mensuelle devient possible :
--  Σ quantité vendue × (prix de vente à la vente − prix d'achat catalogue actuel).
--
--  Basculement explicite par l'admin (superette_commission_reelle, défaut false) plutôt
--  qu'automatique : tant que prix_achat n'est pas renseigné pour l'essentiel du catalogue
--  supérette, le calcul réel vaudrait artificiellement la totalité du prix de vente en marge
--  (prix_achat manquant = traité comme 0, même limite assumée que v85) — l'admin active une
--  fois les prix d'achat saisis.
-- ============================================================

alter table settings add column if not exists superette_commission_reelle boolean not null default false;

create or replace view v_commission_superette_mensuelle as
select ss.station_id, to_char(ss.report_date, 'YYYY-MM') as mois,
  sum(coalesce(ss.quantite, 0) * (coalesce(ss.prix_vente, 0) - coalesce(pr.prix_achat, 0))) as commission_superette
from superette_sales ss
left join products pr on pr.id = ss.product_id
group by ss.station_id, to_char(ss.report_date, 'YYYY-MM');

grant select on v_commission_superette_mensuelle to authenticated, anon;

do $$
begin
  if exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'v_commission_superette_mensuelle') then
    execute 'alter view public.v_commission_superette_mensuelle set (security_invoker = on)';
  end if;
end $$;
