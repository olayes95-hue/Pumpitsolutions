-- ============================================================
--  MIGRATION v133 — Contenu du site vitrine éditable depuis le backoffice.
--
--  Le site vitrine (pumpit-vitrine, repo séparé, aucune base de données
--  propre) a des contenus figés dans le code : mentions légales et
--  politique de confidentialité avec des placeholders "[à compléter]",
--  téléphone/email de contact, 2 photos de témoignage jamais fournies, et
--  toutes les autres photos (hero, "saisie du jour") codées en dur. Pour
--  que l'admin plateforme puisse tout ça modifier SANS redéployer, le
--  site vitrine doit lire une vraie source de contenu — cette table,
--  en lecture publique (clé anon), éditée depuis Reglages.jsx.
--
--  Table dédiée, SÉPARÉE de plateforme_reglages : cette dernière contient
--  coordonnees_bancaires (jamais exposée à anon, voir
--  migration_v97_abonnements_photos.sql:195-205) — on ne doit jamais
--  élargir ses droits. vitrine_contenu ne contient QUE des informations
--  déjà destinées à être publiques.
-- ============================================================

create table if not exists public.vitrine_contenu (
  id int primary key default 1 check (id = 1),
  -- Identité légale (mentions légales + confidentialité)
  raison_sociale text,
  forme_juridique text,
  capital_social text,
  siege_social text,
  rccm_siret text,
  tva_intracom text,
  directeur_publication text,
  email_contact text,
  telephone_contact text,
  whatsapp_contact text,
  duree_conservation_demo text,
  -- Photos : chemin dans le bucket storage "vitrine" (null = pas encore
  -- remplacé par l'admin, le site retombe alors sur le fichier statique
  -- déjà commité dans pumpit-vitrine/public/photos — jamais de casse).
  photo_hero text,
  photo_pompe text,
  avis1_photo text,
  avis2_photo text,
  -- Témoignages (Avis.jsx)
  avis1_citation text,
  avis1_nom text,
  avis1_role text,
  avis2_citation text,
  avis2_nom text,
  avis2_role text,
  updated_at timestamptz default now()
);
insert into public.vitrine_contenu (id) values (1) on conflict (id) do nothing;

alter table public.vitrine_contenu enable row level security;
grant select on public.vitrine_contenu to anon, authenticated;
grant insert, update on public.vitrine_contenu to authenticated;

drop policy if exists p_vitrine_sel on public.vitrine_contenu;
create policy p_vitrine_sel on public.vitrine_contenu for select to anon, authenticated using (true);
drop policy if exists p_vitrine_write on public.vitrine_contenu;
create policy p_vitrine_write on public.vitrine_contenu for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ── Bucket Storage "vitrine" (public) pour les photos ci-dessus ──
insert into storage.buckets (id, name, public) values ('vitrine', 'vitrine', true)
  on conflict (id) do nothing;

drop policy if exists vitrine_read on storage.objects;
create policy vitrine_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'vitrine');
drop policy if exists vitrine_write on storage.objects;
create policy vitrine_write on storage.objects for insert to authenticated
  with check (bucket_id = 'vitrine' and public.is_platform_admin());
drop policy if exists vitrine_update on storage.objects;
create policy vitrine_update on storage.objects for update to authenticated
  using (bucket_id = 'vitrine' and public.is_platform_admin());
drop policy if exists vitrine_delete on storage.objects;
create policy vitrine_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vitrine' and public.is_platform_admin());
