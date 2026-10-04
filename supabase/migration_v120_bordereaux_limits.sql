-- ============================================================
--  MIGRATION v120 — Limites d'upload sur le bucket bordereaux (checklist Go-Live, item A).
--
--  Jusqu'ici seul `accept="image/*"` côté formulaire limitait le type de fichier — une
--  simple suggestion du navigateur, pas une vraie barrière : un appel direct à l'API Storage
--  (hors de l'app, ou un navigateur qui ignore `accept`) pouvait envoyer n'importe quel type
--  ou poids de fichier dans ce bucket. Le bucket est privé depuis la v98 (public=false) ;
--  cette migration ajoute les deux limites manquantes, appliquées par Storage lui-même.
--
--  Taille : 10 Mo, généreux pour une photo déjà compressée côté client (lib/image.js) avant
--  envoi — couvre aussi le cas où la compression échoue silencieusement sur un vieux téléphone.
--  Types : uniquement les formats réellement utilisés (photos de compteurs/dépenses/
--  versements/pièces jointes assistance — jamais de CSV ni d'autre document dans ce bucket,
--  voir BankRecon.jsx qui lit son CSV uniquement côté client, sans upload Storage).
-- ============================================================

update storage.buckets
set file_size_limit = 10485760,  -- 10 Mo
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']  -- gif inclus : lib/image.js ne compresse jamais les GIF (animation préservée), envoyés tels quels
where id = 'bordereaux';
