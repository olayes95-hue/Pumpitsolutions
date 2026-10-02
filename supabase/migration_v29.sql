-- ============================================================
--  MIGRATION v29 — Analyse PRÉDICTIVE des commandes carburant.
--  Objectif : ne jamais tomber en rupture (rupture = ventes perdues = CA perdu).
--  On croise la consommation moyenne/jour, le stock en cuve, le DÉLAI DE LIVRAISON
--  et une marge de sécurité pour dire QUAND commander.
--  À exécuter dans Supabase > SQL Editor > Run (après v28).
-- ============================================================

-- 1) Paramètres de réappro (modifiables dans Stations & équipe)
alter table settings add column if not exists delai_livraison_jours numeric default 3;  -- délai fournisseur (j)
alter table settings add column if not exists jours_securite numeric default 2;          -- stock tampon (j)

-- 2) Vue prédictive : par produit carburant, date de commande conseillée + rupture estimée
drop view if exists v_reorder cascade;
create view v_reorder as
with p as (
  select coalesce(delai_livraison_jours,3) as lead, coalesce(jours_securite,2) as secu,
         coalesce(marge_unitaire,25) as marge from settings where id=1
)
select x.* ,
  -- litres seuil = de quoi tenir (délai + sécurité) le temps qu'une commande arrive
  round(x.conso_jour * (x.lead + x.secu)) as seuil_commande_litres,
  -- dans combien de jours faut-il PASSER la commande
  case when x.conso_jour > 0 then greatest(round(x.jours_restant - x.lead - x.secu), 0) end as jours_avant_commande,
  -- date conseillée pour commander
  case when x.conso_jour > 0
    then (current_date + greatest(round(x.jours_restant - x.lead - x.secu), 0) * interval '1 day')::date end as date_commande_conseillee,
  -- date estimée de rupture si on ne commande pas
  case when x.jours_restant is not null then (current_date + round(x.jours_restant) * interval '1 day')::date end as date_rupture_estimee,
  -- faut-il commander MAINTENANT ? (l'autonomie ne couvre plus le délai + sécurité)
  (x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant <= x.lead + x.secu) as commander_maintenant,
  -- manque à gagner estimé si on commande trop tard (jours de rupture avant l'arrivée × conso × marge)
  case when x.jours_restant is not null and x.conso_jour > 0 and x.jours_restant < x.lead
    then round((x.lead - x.jours_restant) * x.conso_jour * (select marge from p)) else 0 end as manque_a_gagner_estime
from (
  select f.station_id, f.nom, 'essence'::text as produit,
         f.ess_stock as stock, f.conso_ess_jour as conso_jour, f.jours_essence as jours_restant,
         (select lead from p) as lead, (select secu from p) as secu
  from v_stock_forecast f
  union all
  select f.station_id, f.nom, 'gasoil',
         f.gas_stock, f.conso_gas_jour, f.jours_gasoil,
         (select lead from p), (select secu from p)
  from v_stock_forecast f
) x;

grant select on v_reorder to authenticated, anon;
-- La recommandation « commander maintenant » est affichée dans une carte dédiée
-- du tableau de bord (🔮 Prévision de commande), pas besoin de toucher v_alerts.

-- 4) ARCHIVAGE — liste des photos archivables selon la politique de rétention.
--    Rétention : preuves comptables (bordereaux, dépenses, réceptions) = 24 mois ;
--    photos de compteurs (preuve de relevé, moins critiques après vérif) = 6 mois.
--    Cette vue ne SUPPRIME rien : elle sert à l'admin (ou à un job) pour purger ensuite.
create or replace view v_attachments_archivables as
select a.id, a.station_id, a.report_date, a.categorie, a.photo_path,
  case when a.categorie = 'compteur' then interval '6 months' else interval '24 months' end as retention
from attachments a
where a.report_date < current_date - (case when a.categorie = 'compteur' then interval '6 months' else interval '24 months' end);

grant select on v_attachments_archivables to authenticated, anon;

-- Fonction de purge (à lancer manuellement ou via pg_cron par un admin) :
--   - supprime les LIGNES attachments archivables.
--   ⚠️ La suppression des FICHIERS du bucket Storage se fait séparément (API Storage /
--   Edge Function), car SQL ne supprime pas les objets de Storage. Voir ARCHIVAGE.md.
create or replace function purge_attachments_archivables() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_admin() then raise exception 'admin uniquement'; end if;
  delete from attachments a using v_attachments_archivables v where a.id = v.id;
  get diagnostics n = row_count;
  return n;
end $$;
