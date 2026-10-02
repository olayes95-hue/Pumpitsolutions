-- ============================================================
--  MIGRATION v62 — Brouillon (Étape 1/2) : versions optimisées de
--  v_verse_recon et v_pole_recon_jour, sous des noms temporaires
--  ("_v2"), N'ALTÈRE RIEN d'existant. À comparer aux originales
--  avant tout remplacement (voir diagnostic_compare_v62.sql).
--
--  Cause de la lenteur (confirmée via pg_get_viewdef) : v_pole_recon_jour
--  relance 5 sous-requêtes corrélées séparées vers v_verse_recon pour
--  chaque ligne (verse, ecart, nb_cloture, recette_cloture,
--  depense_cloture) ; v_verse_recon relance elle-même 2 sous-requêtes
--  corrélées vers v_recette_groupe_jour (recette_periode,
--  depense_periode) par ligne. Remplacer chaque groupe de
--  sous-requêtes indépendantes-sur-le-même-prédicat par UNE seule
--  jointure + GROUP BY est une transformation algébriquement
--  équivalente (même prédicat, pas de risque de doublons croisés
--  puisque toutes les agrégations viennent de la MÊME jointure) —
--  mais donnée financière sensible (écarts de versement), donc
--  vérification empirique avant remplacement, comme demandé.
--
--  Détails de parité volontairement préservés à l'identique :
--   - v_verse_recon : recette_periode/depense_periode restent à 0
--     (pas NULL) quand aucune ligne ne correspond, via COALESCE —
--     identique à l'original.
--   - v_pole_recon_jour : verse/ecart restent à 0 (COALESCE) quand
--     aucune clôture ; nb_cloture à 0 naturellement (count() sur
--     colonne, jamais NULL) ; recette_cloture/depense_cloture restent
--     NULL quand aucune clôture (PAS de COALESCE) — comme l'original,
--     ce n'est pas "corrigé" ici pour ne rien changer de comportement.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v61). Idempotente.
-- ============================================================

create or replace view v_verse_recon_v2 as
select
  g.station_id, g.pole_groupe, g.periode_debut, g.periode_fin, g.verse, g.nb_bordereaux,
  coalesce(sum(r.espece), 0::numeric) as recette_periode,
  coalesce(sum(r.depense), 0::numeric) as depense_periode,
  coalesce(sum(r.espece), 0::numeric) - coalesce(sum(r.depense), 0::numeric) - g.verse as ecart
from v_verse_groupe g
left join v_recette_groupe_jour r
  on r.station_id = g.station_id and r.pole_groupe = g.pole_groupe
  and r.report_date >= g.periode_debut and r.report_date <= g.periode_fin
group by g.station_id, g.pole_groupe, g.periode_debut, g.periode_fin, g.verse, g.nb_bordereaux;

grant select on v_verse_recon_v2 to authenticated, anon;

create or replace view v_pole_recon_jour_v2 as
select
  r.station_id, r.report_date, r.pole_groupe, r.espece, r.depense,
  coalesce(sum(vr.verse), 0::numeric) as verse,
  coalesce(sum(vr.ecart), 0::numeric) as ecart,
  count(vr.periode_fin) as nb_cloture,
  exists(
    select 1 from v_verse_groupe g
    where g.station_id = r.station_id and g.pole_groupe = r.pole_groupe
      and r.report_date >= g.periode_debut and r.report_date <= g.periode_fin
  ) as couvert,
  sum(vr.recette_periode) as recette_cloture,
  sum(vr.depense_periode) as depense_cloture
from v_recette_groupe_jour r
left join v_verse_recon_v2 vr
  on vr.station_id = r.station_id and vr.pole_groupe = r.pole_groupe and vr.periode_fin = r.report_date
group by r.station_id, r.report_date, r.pole_groupe, r.espece, r.depense;

grant select on v_pole_recon_jour_v2 to authenticated, anon;
