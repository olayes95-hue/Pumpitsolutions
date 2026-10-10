-- ============================================================
--  MIGRATION v137 — Fix : alerte "Écart à la réception" envoyée même
--  quand la commande est intégralement reçue (aucun écart réel).
--
--  v_order_reception calcule `complet` via un sous-select sur `settings`
--  filtré par `settings.organisation_id = current_org_id()` — current_org_id()
--  lit auth.uid(), qui vaut NULL pour tout appelant sans JWT utilisateur,
--  notamment le notification-poller (clé service_role). Le sous-select
--  renvoie alors 0 ligne, le taux de perte acceptable devient NULL, et
--  `complet` devient NULL (ni vrai ni faux) — `if (!vr || vr.complet) continue`
--  dans le poller ne s'arrête JAMAIS sur un NULL, donc l'email "écart
--  important" partait pour TOUTE réception, même 100% conforme (ex. 7000
--  commandés pour 7000 reçus à Beaurivage).
--
--  Fix : dériver le taux de perte acceptable de la STATION de la commande
--  (via stations.organisation_id), jamais de l'identité de l'appelant —
--  correct aussi bien pour l'app (utilisateur authentifié) que pour le
--  poller (service_role, sans utilisateur).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v136).
-- ============================================================

begin;

create or replace view public.v_order_reception as
with t as (
  select s.id as station_id, coalesce(se.taux_perte_acceptable, 5) as tx
  from public.stations s
  join public.settings se on se.organisation_id = s.organisation_id
)
select o.id as order_id, o.station_id, o.produit, o.categorie, o.quantite_commandee,
  coalesce(rc.recu, 0)                                     as quantite_recue_total,
  greatest(o.quantite_commandee - coalesce(rc.recu, 0), 0) as reste,
  coalesce(rc.nb, 0)                                       as nb_receptions,
  (coalesce(rc.recu, 0) >= o.quantite_commandee - o.quantite_commandee * coalesce(t.tx, 5) / 100) as complet
from public.fuel_orders o
left join lateral (
  select sum(r.quantite_recue) as recu, count(*) as nb
  from public.order_receptions r where r.order_id = o.id
) rc on true
left join t on t.station_id = o.station_id;

alter view public.v_order_reception set (security_invoker = on);
grant select on public.v_order_reception to authenticated, anon;

commit;
