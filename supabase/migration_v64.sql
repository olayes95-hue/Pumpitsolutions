-- ============================================================
--  MIGRATION v64 — Fix sécurité (linter Supabase, niveau WARN) :
--  fonctions SECURITY DEFINER exposées en RPC public + bucket
--  bordereaux listable toutes stations confondues.
--
--  1) Fonctions SECURITY DEFINER inutilement exposées via /rest/v1/rpc :
--     - audit_trigger() / handle_new_user() : fonctions TRIGGER,
--       Postgres refuse déjà leur exécution hors contexte de
--       déclencheur (RETURNS TRIGGER) — non exploitables, mais on
--       ferme l'endpoint RPC par hygiène. Aucun impact : les triggers
--       eux-mêmes ne passent pas par ce GRANT/REVOKE pour s'exécuter.
--     - notify_missing(text) : appelée uniquement par pg_cron
--       (migration_v9, jobs 'notif-matin-9h'/'notif-16h-17h', qui
--       tournent avec leur propre rôle, pas authenticated) — jamais
--       par le frontend (confirmé : aucun .rpc() dans src/). Le grant
--       à `authenticated` (v9) était superflu.
--     - purge_attachments_archivables() : déjà protégée en interne
--       (`if not is_admin() then raise exception`), donc pas
--       exploitable même publique — fermeture par précaution
--       supplémentaire, c'est une fonction de suppression.
--     is_admin()/my_station()/my_role()/jours_correction_gerant()/
--     mois_verrouille() ne sont PAS touchées : nécessaires aux
--     policies RLS de tout le reste de l'app (authenticated doit
--     garder EXECUTE dessus), et sans risque réel (infos sur
--     l'utilisateur courant uniquement).
--
--  2) Bucket bordereaux : la policy de lecture actuelle
--     (storage_policies.sql) autorise TOUT utilisateur connecté à
--     lister/lire les fichiers de TOUTES les stations. Or chaque
--     chemin de fichier commence systématiquement par
--     `${stationId}/...` (vérifié dans tout le code : Submit.jsx,
--     Finance.jsx, Inspections.jsx, orderReception.js) — on restreint
--     donc lecture ET upload à la station de l'utilisateur (ou admin),
--     même pattern RLS que le reste de l'app.
--     Note : le bucket reste "public" au sens Supabase (l'app utilise
--     getPublicUrl() pour l'affichage) — un chemin connu reste donc
--     accessible sans authentification via l'URL publique, comme
--     avant. Ce correctif ferme uniquement le LISTING/l'énumération
--     via l'API authentifiée, qui est ce que le linter signalait.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v61). Idempotente.
-- ============================================================

revoke execute on function public.audit_trigger() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.notify_missing(text) from anon, authenticated;
revoke execute on function public.purge_attachments_archivables() from anon, authenticated;

drop policy if exists "bordereaux_read" on storage.objects;
create policy "bordereaux_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'bordereaux' and (is_admin() or (storage.foldername(name))[1] = my_station()::text));

drop policy if exists "bordereaux_insert" on storage.objects;
create policy "bordereaux_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bordereaux' and (is_admin() or (storage.foldername(name))[1] = my_station()::text));
