-- ============================================================
--  DIAGNOSTIC (lecture seule, aucune modification) — à lancer AVANT de
--  corriger migration_v46 / migration_v44_v47. Sert à connaître l'ordre
--  EXACT des colonnes actuellement exposées par v_report_metrics, pour
--  reconstruire une CREATE OR REPLACE VIEW qui ne déplace aucune colonne
--  existante (Postgres l'interdit — c'est l'erreur "cannot change name
--  of view column" que tu as eue).
-- ============================================================

-- 1) Colonnes de la vue actuelle, dans l'ordre exact.
select ordinal_position, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'v_report_metrics'
order by ordinal_position;

-- 2) Toutes les vues qui dépendent de v_report_metrics (pour être sûr de
--    ne rien casser si jamais il faut passer par un DROP CASCADE).
select distinct dependent_ns.nspname as dependent_schema,
       dependent_view.relname as dependent_view
from pg_depend
join pg_rewrite on pg_depend.objid = pg_rewrite.oid
join pg_class as dependent_view on pg_rewrite.ev_class = dependent_view.oid
join pg_class as source_view on pg_depend.refobjid = source_view.oid
join pg_namespace dependent_ns on dependent_ns.oid = dependent_view.relnamespace
where source_view.relname = 'v_report_metrics'
  and dependent_view.relname != 'v_report_metrics';
