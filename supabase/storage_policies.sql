-- ============================================================
--  Politiques de stockage pour le bucket "bordereaux"
--  (photos : compteurs, bordereaux, fiches ANM, stock).
--  À exécuter dans Supabase > SQL Editor > Run.
--  Permet aux utilisateurs CONNECTÉS de lire/uploader les photos,
--  même si le bucket n'est PAS public (URLs signées) — plus sûr.
-- ============================================================

-- Lecture (nécessaire pour afficher / URLs signées)
drop policy if exists "bordereaux_read" on storage.objects;
create policy "bordereaux_read" on storage.objects
  for select to authenticated using (bucket_id = 'bordereaux');

-- Upload
drop policy if exists "bordereaux_insert" on storage.objects;
create policy "bordereaux_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'bordereaux');

-- (Option) mettre le bucket en PRIVÉ pour plus de sécurité :
-- update storage.buckets set public = false where id = 'bordereaux';
-- L'app utilise des URLs signées, donc l'affichage continue de fonctionner.
