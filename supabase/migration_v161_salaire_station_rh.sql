-- ============================================================
--  MIGRATION v161 — Salaire mensuel dans la Fiche RH des employés de station.
--
--  profiles.salaire_mensuel existe déjà (migration_v153, pour les agents
--  PumpIT du back-office) — même colonne, réutilisée ici pour les employés
--  de station (gérant/pompiste/vendeuse) : utilisée comme référence par
--  l'administrateur pour la charge SALAIRES de Point financier (saisie
--  manuelle, pas d'automatisation ici — juste la valeur de référence).
--
--  Garde-fou : prevent_rh_self_edit() (migration_v143) protège déjà
--  contrat_type/contrat_fin/cnss_declare/assurance_maladie_fin/
--  visite_medicale_* contre l'auto-modification par l'employé lui-même —
--  étendu à salaire_mensuel pour la même raison (donnée RH réservée à
--  manage_team/admin).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v160).
-- ============================================================

begin;

create or replace function public.prevent_rh_self_edit()
returns trigger language plpgsql as $$
begin
  if auth.uid() = old.id and not (public.is_admin() or (select public.my_permissions()) && array['manage_team']) then
    if new.contrat_type is distinct from old.contrat_type
       or new.contrat_fin is distinct from old.contrat_fin
       or new.cnss_declare is distinct from old.cnss_declare
       or new.assurance_maladie_fin is distinct from old.assurance_maladie_fin
       or new.visite_medicale_le is distinct from old.visite_medicale_le
       or new.visite_medicale_mois is distinct from old.visite_medicale_mois
       or new.salaire_mensuel is distinct from old.salaire_mensuel then
      raise exception 'Champs RH réservés à la direction (manage_team).';
    end if;
  end if;
  return new;
end; $$;

commit;
