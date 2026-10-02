-- ============================================================
--  v98 : LE BUCKET DES PHOTOS DEVIENT PRIVÉ
-- ============================================================
--  Après ce script, une photo n'est plus lisible par simple lien : il faut
--  être connecté et avoir le droit de la voir (règle posée par la v97).
--
--  À exécuter EN DERNIER, une fois que :
--    1) la v97 est appliquée ;
--    2) la nouvelle application PumpIT est en ligne (elle utilise des liens
--       signés, valables une heure) ;
--    3) l'ancienne application est arrêtée : elle affiche les photos par
--       lien public et ne les afficherait plus.
--
--  Retour arrière immédiat si besoin :
--    update storage.buckets set public = true where id = 'bordereaux';
-- ============================================================
do $$ begin
  if to_regprocedure('public.can_read_photo(text)') is null then
    raise exception 'Exécutez d''abord migration_v97_abonnements_photos.sql.';
  end if;
end $$;

update storage.buckets set public = false where id = 'bordereaux';
