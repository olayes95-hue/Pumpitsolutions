-- ============================================================
--  MIGRATION v33 — Historique cohérent : sur le jour de CLÔTURE d'un
--  versement, afficher la RECETTE CUMULÉE de la période (celle qui sert
--  au calcul de l'écart), pas seulement la recette du jour.
--
--  Avant : « CA Gaz+Lub » = recette du seul jour, alors que l'écart rouge
--  porte sur toute la période → la ligne paraissait incohérente.
--  On expose recette_cloture / depense_cloture dans v_pole_recon_jour ;
--  le front les affiche sur le jour de clôture.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v32).
--  Idempotente (create or replace).
-- ============================================================

create or replace view v_pole_recon_jour as
select r.station_id, r.report_date, r.pole_groupe,
  r.espece, r.depense,
  coalesce((select sum(vr.verse) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date),0) as verse,
  coalesce((select sum(vr.ecart) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date),0) as ecart,
  (select count(*) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date) as nb_cloture,
  exists(select 1 from v_verse_groupe g
    where g.station_id=r.station_id and g.pole_groupe=r.pole_groupe
      and r.report_date between g.periode_debut and g.periode_fin) as couvert,
  -- NOUVEAU (v33) : ajoutées EN FIN de vue (create or replace n'autorise que
  -- l'ajout de colonnes à la fin). Recette / dépense CUMULÉES de la/les
  -- période(s) qui se clôture(nt) ce jour — base réelle de l'écart affiché.
  (select sum(vr.recette_periode) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date) as recette_cloture,
  (select sum(vr.depense_periode) from v_verse_recon vr
    where vr.station_id=r.station_id and vr.pole_groupe=r.pole_groupe and vr.periode_fin=r.report_date) as depense_cloture
from v_recette_groupe_jour r;

grant select on v_pole_recon_jour to authenticated, anon;
