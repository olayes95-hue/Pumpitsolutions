-- ============================================================
--  MIGRATION v124 — Réconciliation versements : une seule logique, celle du
--  Tableau de bord (mois civil, sans déduire les dépenses cash), partout.
--
--  Jusqu'ici, Tableau de bord (v_ventes_mensuelles : espèces du mois civil
--  moins versé du mois civil, tous pôles confondus, dépenses jamais
--  déduites) et Historique/Alertes (v_verse_recon : par PÉRIODE de
--  versement déclarée, dépenses cash déduites pour le carburant) donnaient
--  deux chiffres différents pour "l'écart" — repéré en expliquant un cas
--  réel (écart mensuel affiché 49 780 F au Tableau de bord, introuvable en
--  additionnant la colonne Écart d'Historique). Décision explicite : la
--  logique du Tableau de bord fait référence partout ; Historique et
--  l'alerte "versement incomplet" s'alignent dessus.
--
--  Conserve la séparation PAR PÔLE qu'avait Historique (utile pour savoir
--  OÙ regarder) — contrairement à v_ventes_mensuelles qui les combine tous.
--
--  N'ACCORDE PLUS AUCUNE DÉDUCTION DE DÉPENSES CASH NULLE PART dans ce
--  calcul (même pour le carburant, qui en bénéficiait avant) : un gérant
--  qui a une grosse dépense cash justifiée verra désormais un écart plus
--  élevé qu'avant pour le pôle carburant — c'est le choix explicitement
--  fait ici, pas un oubli.
--
--  v_alerts (ci-dessous) ne touche QUE la branche VERSEMENT_INCOMPLET —
--  les 9 autres branches sont recopiées À L'IDENTIQUE de la définition
--  actuelle (migration_v93) : un `create or replace view` remplace TOUTE
--  la vue, donc omettre une branche existante la supprimerait en silence.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Recette espèces par pôle, par MOIS CIVIL (report_date).
-- ------------------------------------------------------------
create or replace view public.v_recette_mensuelle_pole as
select station_id, pole_groupe, to_char(report_date, 'YYYY-MM') as mois, sum(espece) as espece
from public.v_recette_groupe_jour
group by 1, 2, 3;

grant select on public.v_recette_mensuelle_pole to authenticated, anon;

-- ------------------------------------------------------------
-- 2. Versé par pôle, par MOIS CIVIL — même repli de date que
--    v_ventes_mensuelles (coalesce periode_fin, deposit_date, report_date),
--    donc un versement sans période déclarée compte désormais aussi (avant,
--    v_verse_groupe l'ignorait purement et simplement : where periode_fin
--    is not null).
-- ------------------------------------------------------------
create or replace view public.v_verse_mensuel_pole as
select station_id,
  case when pole = 'carburant' then 'carburant'
       when pole in ('gaz', 'lubrifiant', 'gaz_lubrifiant') then 'gaz_lub'
       else 'superette' end as pole_groupe,
  to_char(coalesce(periode_fin, deposit_date, report_date), 'YYYY-MM') as mois,
  sum(montant) as verse
from public.deposits
group by 1, 2, 3;

grant select on public.v_verse_mensuel_pole to authenticated, anon;

-- ------------------------------------------------------------
-- 3. Réconciliation mensuelle par pôle — même formule que le Tableau de
--    bord (espèces − versé, rien d'autre), juste déclinée par pôle au lieu
--    d'un seul total. Remplace v_verse_recon / v_pole_recon_jour comme
--    source de vérité pour "l'écart".
-- ------------------------------------------------------------
create or replace view public.v_pole_recon_mois as
select r.station_id, r.pole_groupe, r.mois, r.espece,
  coalesce(v.verse, 0) as verse,
  r.espece - coalesce(v.verse, 0) as ecart,
  case when r.espece > 0 then round(100.0 * coalesce(v.verse, 0) / r.espece) else null end as couverture_pct
from public.v_recette_mensuelle_pole r
left join public.v_verse_mensuel_pole v
  on v.station_id = r.station_id and v.pole_groupe = r.pole_groupe and v.mois = r.mois;

grant select on public.v_pole_recon_mois to authenticated, anon;

-- ------------------------------------------------------------
-- 4. v_alerts — recopie exacte de migration_v93, seule la branche
--    VERSEMENT_INCOMPLET change (v_verse_recon → v_pole_recon_mois).
-- ------------------------------------------------------------
create or replace view v_alerts as
select station_id,
  least((date_trunc('month', (mois || '-01')::date) + interval '1 month' - interval '1 day')::date, current_date) as report_date,
  'VERSEMENT_INCOMPLET'::text as type, 'haute'::text as gravite,
  pole_groupe || ' (' || mois || ') : espèces ' || round(espece) || ' F ≠ versé ' || round(verse) || ' F → écart ' || round(ecart) || ' F'
    as detail
from v_pole_recon_mois where ecart > 1000
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
-- g) point du jour manquant — "renseigné" = au moins un relevé compteur réel (pas juste une
-- ligne daily_reports quelconque, qui peut être un stub créé par une réception de commande).
select s.id as station_id, d::date as report_date, 'POINT_MANQUANT','moyenne',
  'Aucun point saisi ce jour-là' as detail
from stations s
cross join generate_series(current_date - interval '14 day', current_date - interval '1 day', interval '1 day') d
where not exists (
    select 1 from daily_reports r
    where r.station_id = s.id and r.report_date = d::date
      and (r.e1_m is not null or r.g1_m is not null or r.e1 is not null or r.g1 is not null
        or r.e2_m is not null or r.g2_m is not null or r.e2 is not null or r.g2 is not null
        or r.e3_m is not null or r.g3_m is not null or r.e3 is not null or r.g3 is not null
        or r.e4_m is not null or r.g4_m is not null or r.e4 is not null or r.g4 is not null
        or r.e5_m is not null or r.g5_m is not null or r.e5 is not null or r.g5 is not null
        or r.e6_m is not null or r.g6_m is not null or r.e6 is not null or r.g6 is not null
        or r.e7_m is not null or r.g7_m is not null or r.e7 is not null or r.g7 is not null
        or r.e8_m is not null or r.g8_m is not null or r.e8 is not null or r.g8 is not null
        or r.e9_m is not null or r.g9_m is not null or r.e9 is not null or r.g9 is not null
        or r.e10_m is not null or r.g10_m is not null or r.e10 is not null or r.g10 is not null)
  )
  and exists (
    select 1 from profiles p
    where p.approved and p.role in ('gerant','pompiste','vendeuse') and p.created_at < d
      and (p.station_id = s.id or exists (
        select 1 from profile_stations ps where ps.profile_id = p.id and ps.station_id = s.id))
  );

alter view public.v_alerts set (security_invoker = on);
grant select on v_alerts to authenticated, anon;
