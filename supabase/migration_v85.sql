-- Commission réelle gaz + lubrifiant (au lieu d'une estimation à taux fixe %) : gaz avait déjà
-- une quantité vendue déclarée (gaz_vendu_3/6/12/38) ; lubrifiant n'en avait aucune (seul un
-- résidu stock veille/jour existait, qui mélange vraies ventes et casse/vol/erreur de saisie —
-- inutilisable pour une commission fiable). Ajoute le même mécanisme que le gaz pour le
-- lubrifiant : une quantité vendue déclarée par référence, jsonb comme lubrifiant_stock.

alter table daily_reports add column if not exists lubrifiant_vendu jsonb;

-- Commission réelle = Σ quantité vendue × (prix de vente − prix d'achat), par jour puis
-- agrégée par mois — remplace le calcul à taux fixe (settings.taux_gaz) dans Finance.jsx.
-- Utilise les prix ACTUELS de la fiche produit (products.prix_vente/prix_achat) pour tout
-- l'historique, comme le faisait déjà le taux fixe (settings.taux_gaz est lui aussi une
-- valeur unique appliquée à tous les mois) — pas une régression, même limite qu'avant.
create or replace view v_commission_reelle_mensuelle as
with lub_jour as (
  select r.id,
    sum(coalesce(nullif(kv.value, '')::numeric, 0) * (coalesce(pr.prix_vente, 0) - coalesce(pr.prix_achat, 0))) as commission_lubrifiant
  from daily_reports r, jsonb_each_text(coalesce(r.lubrifiant_vendu, '{}'::jsonb)) kv
  left join products pr on pr.categorie = 'lubrifiant' and pr.nom = kv.key
  group by r.id
)
select r.station_id, to_char(r.report_date, 'YYYY-MM') as mois,
  sum(
    coalesce(r.gaz_vendu_3, 0)  * (coalesce(p3.prix_vente, 0)  - coalesce(p3.prix_achat, 0))
    + coalesce(r.gaz_vendu_6, 0)  * (coalesce(p6.prix_vente, 0)  - coalesce(p6.prix_achat, 0))
    + coalesce(r.gaz_vendu_12, 0) * (coalesce(p12.prix_vente, 0) - coalesce(p12.prix_achat, 0))
    + coalesce(r.gaz_vendu_38, 0) * (coalesce(p38.prix_vente, 0) - coalesce(p38.prix_achat, 0))
  ) as commission_gaz,
  sum(coalesce(lj.commission_lubrifiant, 0)) as commission_lubrifiant
from daily_reports r
left join products p3  on p3.categorie = 'gaz' and p3.nom = '3 kg'
left join products p6  on p6.categorie = 'gaz' and p6.nom = '6 kg'
left join products p12 on p12.categorie = 'gaz' and p12.nom = '12 kg'
left join products p38 on p38.categorie = 'gaz' and p38.nom = '38 kg'
left join lub_jour lj on lj.id = r.id
group by r.station_id, to_char(r.report_date, 'YYYY-MM');

grant select on v_commission_reelle_mensuelle to authenticated, anon;

do $$
begin
  if exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'v_commission_reelle_mensuelle') then
    execute 'alter view public.v_commission_reelle_mensuelle set (security_invoker = on)';
  end if;
end $$;
