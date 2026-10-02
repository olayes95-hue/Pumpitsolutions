-- ============================================================
--  MIGRATION v61 — Fix sécurité : vues SECURITY DEFINER (linter Supabase).
--
--  Par défaut en Postgres, une vue s'exécute avec les droits de son
--  créateur (comportement "definer"), pas ceux de l'utilisateur qui
--  l'interroge — ce qui contourne les policies RLS posées sur les
--  tables sous-jacentes (daily_reports, stock_movements, fuel_orders…
--  toutes en `is_admin() or station_id = my_station()`). Combiné à
--  `grant select ... to anon` sur beaucoup de ces vues, un utilisateur
--  non authentifié pouvait potentiellement lire des données toutes
--  stations confondues via ces vues.
--
--  Fix : `security_invoker = on` (Postgres 15+, disponible sur
--  Supabase) fait exécuter la vue avec les droits de l'appelant — les
--  RLS des tables sous-jacentes s'appliquent alors normalement.
--  Vérifié sans risque : is_admin()/my_station() restent des
--  FONCTIONS security definer (le bon pattern, non concerné par ce
--  fix), et chaque table lue par ces vues a déjà une policy SELECT
--  pour `authenticated` cohérente avec ce que la vue est censée
--  montrer — aucune régression de visibilité attendue pour un
--  utilisateur légitime.
--
--  Idempotente, sans risque de perte de données (ne touche aucune
--  définition de vue, juste une option). À exécuter dans Supabase >
--  SQL Editor > Run (après v60). Relance le linter Database ensuite
--  pour confirmer que les 28 alertes "Security Definer View"
--  disparaissent.
-- ============================================================

do $$
declare v text;
begin
  foreach v in array array[
    'v_pertes_livraison','v_stock_declare_jour','v_sorties_deduites','v_bons_baisses','v_bons_hausses',
    'v_recette_groupe_jour','v_verse_groupe','v_verse_recon','v_delai_moyen','v_stock_produits',
    'v_stock_valeur','v_pole_recon_jour','v_order_lead','v_order_reception','v_attachments_archivables',
    'v_superette_sales','v_order_livraison','v_stock_recon','v_alerts','v_stock_forecast',
    'v_latest_stock','v_reorder','v_pertes_mensuelles','v_ventes_mensuelles','v_report_metrics',
    'v_stock_theorique','v_compte_bancaire','v_reorder_lubrifiant'
  ]
  loop
    if exists (select 1 from information_schema.views where table_schema = 'public' and table_name = v) then
      execute format('alter view public.%I set (security_invoker = on)', v);
    end if;
  end loop;
end $$;
