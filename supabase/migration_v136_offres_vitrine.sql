-- ============================================================
--  MIGRATION v136 — Contenu marketing des offres (points forts, mise en
--  avant) + vue publique pour que le site vitrine affiche automatiquement
--  les prix et le contenu réglés dans le back-office (Offres.jsx), sans
--  redéploiement du site vitrine à chaque changement.
--
--  formules contient aussi des clés internes (fonctions[], activites[] —
--  permissions techniques de l'app) qui ne sont PAS le contenu marketing
--  affiché publiquement. Plutôt que d'ouvrir `formules` entière à anon
--  (qui n'a aujourd'hui aucune policy de lecture dessus, voir v97), une
--  vue dédiée ne projette que les colonnes déjà destinées à être
--  publiques — même séparation que vitrine_contenu vs plateforme_reglages
--  (v133).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v135).
-- ============================================================

begin;

alter table public.formules add column if not exists points_forts_vitrine text[] not null default '{}';
alter table public.formules add column if not exists mise_en_avant_vitrine boolean not null default false;

-- Vue PUBLIQUE volontairement SANS security_invoker (à l'inverse de la convention du
-- reste du projet) : formules est un catalogue commun à tous les clients, pas une donnée
-- par organisation — aucun cloisonnement tenant à respecter ici. Cette vue ne projette que
-- des colonnes déjà publiques par nature (prix affichés publiquement, contenu marketing) —
-- jamais fonctions/activites (détail technique interne).
create or replace view public.v_formules_publiques as
select key, label, prix_mensuel, description, points_forts_vitrine, mise_en_avant_vitrine, ordre
from public.formules
where actif = true
order by ordre, prix_mensuel;
grant select on public.v_formules_publiques to anon, authenticated;

commit;
