-- ============================================================
--  MIGRATION v92 — « Vérif bordereaux » : validation visuelle manuelle,
--  sans passer par l'OCR (l'admin/directeur regarde la photo à l'œil et
--  confirme que le montant déclaré correspond), en plus de l'analyse IA
--  déjà existante — avec validation par lot (plusieurs bordereaux d'un coup).
--
--  Aucune colonne de ce type n'existait sur `deposits` : `verifie` est un
--  constat humain, distinct de `montant_ocr`/`ocr_ecart` (lecture IA).
--
--  RLS : deposits n'avait AUCUNE policy UPDATE jusqu'ici (seulement
--  select/insert/delete — l'analyse OCR écrit via la fonction edge, qui
--  utilise la clé service_role et contourne RLS). Ajoutée ici avec le même
--  motif que v77/v83/v88/v90/v91. Pas de risque d'auto-validation par le
--  gérant qui a saisi le bordereau : gérant/pompiste/vendeuse n'ont pas la
--  permission view_ocr_check (page même pas visible pour eux) — seuls
--  admin et un profil explicitement habilité (ex. comptable) y accèdent.
-- ============================================================

alter table deposits add column if not exists verifie boolean not null default false;
alter table deposits add column if not exists verifie_par uuid references profiles(id);
alter table deposits add column if not exists verifie_at timestamptz;

drop policy if exists p_dep_upd on deposits;
create policy p_dep_upd on deposits for update using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_ocr_check'))
  )
) with check (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('view_ocr_check'))
  )
);
