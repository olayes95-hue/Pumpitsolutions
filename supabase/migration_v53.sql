-- ============================================================
--  MIGRATION v53 — Fix racine des fausses alertes "Écart de cuve
--  (fuite/vol ?)" causées par une livraison reçue le même jour.
--
--  Diagnostic (constaté sur Beaurivage, livraison essence du 13/08 reçue
--  tard le soir) : réceptionner une livraison ÉCRASE directement
--  daily_reports.ess_stock/gas_stock avec le niveau après livraison
--  (cuve_apres), peu importe qu'un relevé du matin ait déjà été saisi ce
--  jour-là. Le modèle anti-coulage (v_stock_recon) compare ensuite ce
--  MÊME ess_stock d'un jour à l'autre ET rajoute la livraison une
--  seconde fois via deliv_ess (déjà corrigé en v52 pour cibler le bon
--  jour) → la livraison est comptée DEUX FOIS quel que soit le jour
--  choisi, ce qui produit un écart artificiel énorme (observé : ±5920 L)
--  aussi souvent qu'une livraison arrive après le relevé du matin —
--  signalé par l'utilisateur comme fréquent.
--
--  Fix : un relevé du matin FIGÉ (ess_stock_matin/gas_stock_matin),
--  écrit UNIQUEMENT par le pas "Matin" de la saisie du jour (jamais par
--  une réception de livraison). ess_stock/gas_stock continuent de
--  refléter le dernier niveau connu (Stock, jauges, alertes stock bas —
--  comportement inchangé). La réconciliation anti-coulage (v_stock_recon)
--  utilise désormais le relevé figé (avec repli sur ess_stock si aucun
--  relevé du matin n'existe pour ce jour, ex. données antérieures à ce
--  fix) — la livraison n'est alors comptée qu'une fois, via deliv_ess.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v52). Idempotente.
-- ============================================================

alter table daily_reports add column if not exists ess_stock_matin numeric;
alter table daily_reports add column if not exists gas_stock_matin numeric;

-- ── v_report_metrics : ajoute ess_stock_matin/gas_stock_matin en tout dernier
--    (même prudence qu'en v46 : colonnes existantes intactes, rien n'est réordonné) ──
create or replace view v_report_metrics as
with base as (
  select
    r.id, r.report_date, r.ess_litres, r.ess_pu, r.ess_bon, r.ess_espece,
    r.gas_litres, r.gas_pu, r.gas_bon, r.gas_espece, r.gaz_espece, r.superette_espece,
    r.lubrifiant_espece, r.e1, r.e2, r.e3, r.e4, r.g1, r.g2, r.g3, r.g4,
    r.total_bon_cumul, r.note, r.created_by, r.created_at, r.ess_stock, r.gas_stock,
    r.gaz_stock_3, r.gaz_stock_6, r.gaz_stock_12, r.gaz_stock_38,
    r.gaz_vendu_3, r.gaz_vendu_6, r.gaz_vendu_12, r.gaz_vendu_38,
    r.lubrifiant_stock, r.station_id,
    r.e1_m, r.e2_m, r.e3_m, r.e4_m, r.g1_m, r.g2_m, r.g3_m, r.g4_m,
    coalesce(r.ess_espece,0)+coalesce(r.gas_espece,0)+coalesce(r.gaz_espece,0)
      +coalesce(r.superette_espece,0)+coalesce(r.lubrifiant_espece,0) as cash_declare,
    coalesce(r.ess_bon,0)+coalesce(r.gas_bon,0) as ventes_bon,
    coalesce(r.e1_m,0)+coalesce(r.e2_m,0)+coalesce(r.e3_m,0)+coalesce(r.e4_m,0)
      +coalesce(r.e5_m,0)+coalesce(r.e6_m,0)+coalesce(r.e7_m,0)+coalesce(r.e8_m,0)+coalesce(r.e9_m,0)+coalesce(r.e10_m,0) as e_open,
    coalesce(r.g1_m,0)+coalesce(r.g2_m,0)+coalesce(r.g3_m,0)+coalesce(r.g4_m,0)
      +coalesce(r.g5_m,0)+coalesce(r.g6_m,0)+coalesce(r.g7_m,0)+coalesce(r.g8_m,0)+coalesce(r.g9_m,0)+coalesce(r.g10_m,0) as g_open
  from daily_reports r),
withlead as (
  select *,
    lead(e_open) over (partition by station_id order by report_date) as e_open_next,
    lead(g_open) over (partition by station_id order by report_date) as g_open_next,
    lead(report_date) over (partition by station_id order by report_date) as next_date
  from base),
calc as (
  select *,
    case when next_date = report_date + 1 and e_open>0 and e_open_next>=e_open and (e_open_next - e_open) < 30000 then e_open_next - e_open end as ess_litres_calc,
    case when next_date = report_date + 1 and g_open>0 and g_open_next>=g_open and (g_open_next - g_open) < 30000 then g_open_next - g_open end as gas_litres_calc
  from withlead)
select c.*,
  coalesce(c.ess_litres, c.ess_litres_calc) as ess_litres_retenu,
  coalesce(c.gas_litres, c.gas_litres_calc) as gas_litres_retenu,
  (coalesce(c.ess_litres,0) + coalesce(c.gas_litres,0))
    * (select marge_unitaire from settings where id=1) as marge_estimee,
  coalesce(c.ess_litres,0) * coalesce(c.ess_pu,0)
    + coalesce(c.gas_litres,0) * coalesce(c.gas_pu,0) as ca_carburant,
  (select coalesce(sum(montant),0) from expenses e
     where e.report_date=c.report_date and e.station_id=c.station_id and coalesce(e.non_cash,false)=false) as total_depense,
  (select coalesce(sum(montant),0) from deposits d
     where d.station_id=c.station_id and coalesce(d.periode_fin, d.deposit_date, d.report_date)=c.report_date) as total_verse,
  (select coalesce(sum(montant),0) from deliveries l where l.report_date=c.report_date and l.station_id=c.station_id) as total_livraisons,
  -- v46 : colonnes ajoutées en tout dernier, jamais mêlées à r.* plus haut.
  r2.e5, r2.e6, r2.e7, r2.e8, r2.e9, r2.e10,
  r2.g5, r2.g6, r2.g7, r2.g8, r2.g9, r2.g10,
  r2.e5_m, r2.e6_m, r2.e7_m, r2.e8_m, r2.e9_m, r2.e10_m,
  r2.g5_m, r2.g6_m, r2.g7_m, r2.g8_m, r2.g9_m, r2.g10_m,
  -- v53 : relevé de cuve du matin, figé (jamais écrasé par une réception de livraison).
  r2.ess_stock_matin, r2.gas_stock_matin
from calc c
join daily_reports r2 on r2.id = c.id;

grant select on v_report_metrics to authenticated, anon;

-- ── v_stock_recon : réconciliation basée sur le relevé du matin FIGÉ, pas sur le
--    dernier niveau connu (qui peut avoir été écrasé par une livraison ce jour-là).
--    Repli sur ess_stock/gas_stock si aucun relevé du matin n'a été saisi pour ce jour
--    (ex. données antérieures à v53) — comportement inchangé dans ce cas précis. ──
create or replace view v_stock_recon as
with b as (
  select station_id, report_date,
    coalesce(ess_stock_matin, ess_stock) as ess_stock,
    coalesce(gas_stock_matin, gas_stock) as gas_stock,
    ess_litres, gas_litres, e_open, g_open,
    lag(coalesce(ess_stock_matin, ess_stock)) over w as ess_prev,
    lag(coalesce(gas_stock_matin, gas_stock)) over w as gas_prev,
    lag(e_open)      over w as e_open_prev,
    lag(g_open)      over w as g_open_prev,
    lag(report_date) over w as prev_date
  from v_report_metrics
  window w as (partition by station_id order by report_date)
),
mv as (
  select b.*,
    -- mouvement compteur de la PÉRIODE des ventes du jour (8h veille → 8h jour)
    case when b.prev_date = b.report_date - 1 and b.e_open>0 and b.e_open_prev>0
           and b.e_open >= b.e_open_prev and (b.e_open - b.e_open_prev) < 30000
         then b.e_open - b.e_open_prev end as ess_mouvement,
    case when b.prev_date = b.report_date - 1 and b.g_open>0 and b.g_open_prev>0
           and b.g_open >= b.g_open_prev and (b.g_open - b.g_open_prev) < 30000
         then b.g_open - b.g_open_prev end as gas_mouvement,
    -- livraisons de la période = enregistrées sous J−1 (prev_date), pas J (report_date) — v52
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.prev_date and o.produit='essence' and o.statut='recue') as deliv_ess,
    (select coalesce(sum(cuve_apres-cuve_avant),0) from fuel_orders o
       where o.station_id=b.station_id and o.report_date=b.prev_date and o.produit='gasoil' and o.statut='recue') as deliv_gas
  from b
)
select mv.*,
  coalesce(ess_litres, ess_mouvement) as ess_retenu,
  coalesce(gas_litres, gas_mouvement) as gas_retenu,
  -- cuve attendue = cuve (relevé matin) de la VEILLE − ventes du jour + livraisons du jour
  (ess_prev - coalesce(ess_litres, ess_mouvement, 0) + deliv_ess) as ess_attendu,
  (gas_prev - coalesce(gas_litres, gas_mouvement, 0) + deliv_gas) as gas_attendu,
  case when prev_date = report_date - 1 and ess_stock is not null and ess_prev is not null
       then ess_stock - (ess_prev - coalesce(ess_litres, ess_mouvement, 0) + deliv_ess) end as ecart_ess,
  case when prev_date = report_date - 1 and gas_stock is not null and gas_prev is not null
       then gas_stock - (gas_prev - coalesce(gas_litres, gas_mouvement, 0) + deliv_gas) end as ecart_gas
from mv;

grant select on v_stock_recon to authenticated, anon;
