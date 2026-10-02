-- Fix perf : is_admin()/my_station() etaient evalues UNE FOIS PAR LIGNE SCANNEE
-- dans les sous-requetes correlees de v_report_metrics (jusqu'a ~212 000 appels
-- cumules pour 463 lignes daily_reports x 459 lignes deposits), causant les
-- timeouts 57014 sur Historique/Dashboard/Alertes (tous comptes, admin inclus).
--
-- Confirme via EXPLAIN ANALYZE (transaction annulee, sans risque) :
--   - avant : 17 701 ms, Seq Scan on deposits reevalue is_admin()/my_station()
--     sur chacune des 459 lignes, a chacune des 463 iterations.
--   - RLS desactive sur deposits (test de controle) : 604 ms.
--   - apres ce fix (is_admin()/my_station() enveloppes en sous-requetes
--     scalaires) : 549 ms, resultat identique, RLS toujours actif.
--
-- Le predicat est strictement le meme (is_admin() OR station_id = my_station()) :
-- ce n'est pas un elargissement d'acces, uniquement une reecriture pour que
-- Postgres evalue ces fonctions stables une seule fois (InitPlan) au lieu
-- d'une fois par ligne.

drop policy if exists p_dep_sel on deposits;
create policy p_dep_sel on deposits for select using (
  (select is_admin()) or station_id = (select public.my_station())
);

drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (
  (select is_admin()) or station_id = (select public.my_station())
);

drop policy if exists p_deliv_sel on deliveries;
create policy p_deliv_sel on deliveries for select using (
  (select is_admin()) or station_id = (select public.my_station())
);
