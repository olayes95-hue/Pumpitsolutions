-- ============================================================
--  MIGRATION v145 — Module RH léger : contrat, CNSS, assurance maladie,
--  visite médicale par employé (profiles).
--
--  Pas de nouvelle table : 6 colonnes sur profiles, dans le même esprit que
--  le reste du suivi RH simple de l'app (approved, role...). Le calcul de
--  statut (à jour / en retard) reste côté front (voir etatVisiteMedicale/
--  etatContrat, src/lib/formules.js), comme etatAbonnement().
--
--  À exécuter dans Supabase > SQL Editor > Run (après v144).
-- ============================================================

begin;

alter table public.profiles add column if not exists contrat_type text check (contrat_type in ('cdi', 'cdd', 'essai', 'prestataire'));
alter table public.profiles add column if not exists contrat_fin date;                          -- null si CDI
alter table public.profiles add column if not exists cnss_declare boolean;                      -- null = non renseigné, pas "non"
alter table public.profiles add column if not exists assurance_maladie_fin date;
alter table public.profiles add column if not exists visite_medicale_le date;                    -- dernière visite faite
alter table public.profiles add column if not exists visite_medicale_mois int not null default 12;  -- périodicité, réglable

-- Garde-fou : la policy UPDATE de profiles autorise déjà id = auth.uid() (pour que chacun
-- puisse éditer son propre profil, ex. son nom) — sans ce trigger, un employé pourrait
-- avancer sa propre date de visite médicale ou se déclarer "CNSS = oui". Même mécanique que
-- prevent_approval_self_grant (migration_v84) : seul un admin ou un manage_team peut changer
-- ces 6 champs, même sur SA PROPRE ligne.
create or replace function public.prevent_rh_self_edit()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() = old.id and not (public.is_admin() or (select public.my_permissions()) && array['manage_team']) then
    if new.contrat_type is distinct from old.contrat_type
       or new.contrat_fin is distinct from old.contrat_fin
       or new.cnss_declare is distinct from old.cnss_declare
       or new.assurance_maladie_fin is distinct from old.assurance_maladie_fin
       or new.visite_medicale_le is distinct from old.visite_medicale_le
       or new.visite_medicale_mois is distinct from old.visite_medicale_mois then
      raise exception 'Champs RH réservés à la direction (manage_team).';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_prevent_rh_self_edit on public.profiles;
create trigger trg_prevent_rh_self_edit before update on public.profiles
  for each row execute function public.prevent_rh_self_edit();

-- Déclencheurs notification-poller (voir supabase/functions/notification-poller/index.ts),
-- INACTIFS par défaut comme toute nouvelle règle dans ce projet (migration_v114) — à activer
-- depuis Notifications une fois relus.
insert into notification_rules (trigger_key, nom, destinataires, sujet, corps_html, actif)
select * from (values
  ('visite_medicale_retard', 'Visite médicale en retard',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Visite médicale en retard — {{employe}}',
    '{{employe}} a une visite médicale en retard (dernière visite le {{derniere_visite}}).<br><br>Merci de programmer une nouvelle visite et de mettre à jour sa fiche RH.',
    false),
  ('contrat_echeance', 'Contrat à échéance',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Contrat à échéance dans 30 jours — {{employe}}',
    'Le contrat de {{employe}} arrive à échéance le {{date_fin}}.<br><br>Pensez à anticiper son renouvellement ou sa fin.',
    false)
) as v(trigger_key, nom, destinataires, sujet, corps_html, actif)
where not exists (select 1 from notification_rules r where r.trigger_key = v.trigger_key);

commit;
