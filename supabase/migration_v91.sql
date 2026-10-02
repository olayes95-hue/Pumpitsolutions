-- ============================================================
--  MIGRATION v91 — Une station fraîchement onboardée (gérant approuvé et
--  assigné, mais qui n'a encore JAMAIS envoyé un seul point) ne déclenchait
--  AUCUNE alerte ni notification, même après plusieurs jours à zéro saisie.
--
--  Cause : POINT_MANQUANT (v_alerts) et notify_missing() (notifications
--  9h/17h) exigent tous les deux qu'il existe DÉJÀ au moins un daily_reports
--  antérieur pour la station, pour éviter de signaler des jours d'avant
--  l'arrivée de l'app. Ce garde-fou, correct pour éviter du bruit sur
--  l'historique, empêche structurellement toute alerte tant qu'AUCUN
--  premier point n'a jamais été envoyé — exactement le cas d'un gérant
--  qui vient d'être validé et n'envoie encore rien.
--
--  Fix : remplace ce garde-fou par « un compte gérant/pompiste/vendeuse
--  approuvé est assigné à cette station depuis avant ce jour-là » — signal
--  disponible dès la validation du compte (migration_v84), indépendant de
--  toute saisie déjà faite.
--
--  Fix additionnel (même motif que v77/v83/v88, jamais traité pour cette
--  table) : `notifications` était restée sur is_admin() or station_id =
--  my_station() — jamais lisible par le directeur/comptable (station via
--  profile_stations, pas profiles.station_id). Élargie sur view_alerts.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v90). Idempotente.
-- ============================================================

-- ── notify_missing() : même fix de garde-fou que v_alerts ci-dessous ──
create or replace function public.notify_missing(p_moment text)
returns void language plpgsql security definer set search_path = public as $$
declare msg text;
begin
  msg := case p_moment
    when 'matin' then '⏰ 9h — Point du matin non reçu (stock + relevés d''ouverture). À envoyer rapidement.'
    when 'apres-midi' then '⏰ 17h — Relevés 16h non reçus. À envoyer rapidement.'
    else '⏰ Information manquante.' end;
  insert into notifications(station_id, type, message)
  select s.id, 'MANQUE_' || p_moment, msg
  from stations s
  where exists (
      select 1 from profiles p
      where p.approved and p.role in ('gerant','pompiste','vendeuse') and p.created_at < current_date
        and (p.station_id = s.id or exists (
          select 1 from profile_stations ps where ps.profile_id = p.id and ps.station_id = s.id))
    )
    and not exists (select 1 from submissions sub where sub.station_id = s.id and sub.report_date = current_date and sub.moment = p_moment)
    and not exists (select 1 from notifications n where n.station_id = s.id and n.type = 'MANQUE_' || p_moment and n.created_at::date = current_date);
end; $$;

-- ── v_alerts : clause POINT_MANQUANT (g) reconstruite avec le nouveau garde-fou, reste identique sinon ──
create or replace view v_alerts as
select station_id, periode_fin as report_date, 'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  case when pole_groupe='carburant'
    then 'carburant : (espèce '||round(recette_periode)||' − dépenses '||round(depense_periode)||') ≠ versé '||round(verse)||' → écart '||round(ecart)||' F'
    else pole_groupe||' : recette '||round(recette_periode)||' ≠ versé '||round(verse)||' → écart '||round(ecart)||' F' end as detail
from v_verse_recon where ecart > 1000
union all
select r.station_id, r.report_date, 'VERSEMENT_MANQUANT', 'haute',
  'Recette '||r.pole_groupe||' '||round(r.espece)||' F non versée (aucune période ne la couvre, > 3 j)'
from v_recette_groupe_jour r
where r.espece > 1000 and r.report_date < current_date - 3
  and not exists (select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin)
union all
select e.station_id, e.report_date, 'DEPENSE_NON_JUSTIFIEE','moyenne',
  'Dépense '||e.categorie||' '||round(e.montant)||' F sans justificatif/motif'
from expenses e where e.justificatif = false or e.motif is null or e.motif=''
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Essence: compteurs '||round(ess_mouvement)||' L vs déclaré '||round(ess_litres)||' L'
from v_stock_recon
where ess_mouvement is not null and ess_litres is not null and abs(ess_mouvement - ess_litres) > 100
union all
select station_id, report_date, 'ECART_COMPTEUR','moyenne',
  'Gasoil: compteurs '||round(gas_mouvement)||' L vs déclaré '||round(gas_litres)||' L'
from v_stock_recon
where gas_mouvement is not null and gas_litres is not null and abs(gas_mouvement - gas_litres) > 100
union all
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur essence du '||to_char(report_date,'DD/MM')||' non mis à jour (index identique à la veille) — impossible de vérifier les '||round(ess_litres)||' L déclarés'
from v_stock_recon
where prev_date = report_date - 1 and ess_litres is not null and ess_litres > 100 and coalesce(e_open,0) <= coalesce(e_open_prev,0)
union all
select station_id, report_date, 'RELEVE_COMPTEUR_MANQUANT','moyenne',
  'Relevé compteur gasoil du '||to_char(report_date,'DD/MM')||' non mis à jour (index identique à la veille) — impossible de vérifier les '||round(gas_litres)||' L déclarés'
from v_stock_recon
where prev_date = report_date - 1 and gas_litres is not null and gas_litres > 100 and coalesce(g_open,0) <= coalesce(g_open_prev,0)
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Essence: '||round(coalesce(l.ess_stock,0))||' L (~'||coalesce(f.jours_essence,0)||' j) < seuil '||round(l.seuil_essence)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.ess_stock is not null and l.ess_stock < l.seuil_essence
union all
select f.station_id, l.derniere_date, 'STOCK_BAS','haute',
  'Gasoil: '||round(coalesce(l.gas_stock,0))||' L (~'||coalesce(f.jours_gasoil,0)||' j) < seuil '||round(l.seuil_gasoil)||' L'
from v_stock_forecast f join v_latest_stock l on l.station_id=f.station_id
where l.gas_stock is not null and l.gas_stock < l.seuil_gasoil
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Essence: cuve déclarée '||round(ess_stock)||' L vs attendue '||round(ess_attendu)||' L → écart '||round(ecart_ess)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_ess is not null and abs(ecart_ess) > 300
  and ess_attendu >= 0 and ess_stock >= 0 and coalesce(ess_retenu,0) <= 30000 and abs(ecart_ess) <= 20000
union all
select station_id, report_date, 'ECART_STOCK','haute',
  'Gasoil: cuve déclarée '||round(gas_stock)||' L vs attendue '||round(gas_attendu)||' L → écart '||round(ecart_gas)||' L (fuite/vol ?)'
from v_stock_recon
where ecart_gas is not null and abs(ecart_gas) > 300
  and gas_attendu >= 0 and gas_stock >= 0 and coalesce(gas_retenu,0) <= 30000 and abs(ecart_gas) <= 20000
union all
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Essence: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — ventes '||round(coalesce(ess_retenu,0))||' L, cuve attendue '||round(ess_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_ess is not null and (ess_attendu < 0 or coalesce(ess_retenu,0) > 30000 or abs(ecart_ess) > 20000)
union all
select station_id, report_date, 'DONNEES_INCOHERENTES','moyenne',
  'Gasoil: relevés compteur/cuve incohérents le '||to_char(report_date,'DD/MM')||' — ventes '||round(coalesce(gas_retenu,0))||' L, cuve attendue '||round(gas_attendu)||' L. Vérifie les index compteurs et la cuve (ce n''est pas une fuite).'
from v_stock_recon
where ecart_gas is not null and (gas_attendu < 0 or coalesce(gas_retenu,0) > 30000 or abs(ecart_gas) > 20000)
union all
-- g) point du jour manquant — garde-fou basé sur un compte opérationnel approuvé et assigné
--    (plus sur « au moins un daily_reports déjà envoyé », qui ne peut jamais être vrai pour
--    une station dont le gérant vient d'être validé et n'a encore rien envoyé)
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (select 1 from daily_reports r where r.station_id=s.id and r.report_date = d::date)
  and exists (
    select 1 from profiles p
    where p.approved and p.role in ('gerant','pompiste','vendeuse') and p.created_at < d
      and (p.station_id = s.id or exists (
        select 1 from profile_stations ps where ps.profile_id = p.id and ps.station_id = s.id))
  );

alter view public.v_alerts set (security_invoker = on);
grant select on v_alerts to authenticated, anon;

-- ── notifications : RLS élargie pour directeur/comptable (même motif que v77/v83/v88) ──
drop policy if exists p_notif_sel on notifications;
create policy p_notif_sel on notifications for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_alerts'))
  )
);

drop policy if exists p_notif_upd on notifications;
create policy p_notif_upd on notifications for update using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_alerts'))
  )
);
