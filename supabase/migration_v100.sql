-- ============================================================
--  MIGRATION v100 — Saisie du jour : réglages admin supplémentaires
--
--  1) settings.photo_obligatoire : quand l'admin l'active, les photos
--     (compteurs, justificatif de dépense, bordereau de versement)
--     deviennent bloquantes à l'envoi — par défaut (false), comportement
--     actuel inchangé : recommandées, jamais bloquantes.
--
--  2) stations.suivi_lub_gaz : choix admin, PAR STATION, entre déclarer
--     le STOCK (relevé du matin, pour la réconciliation/anti-coulage),
--     la quantité VENDUE (16h, pour la commission réelle — voir
--     migration_v85), ou les deux ('les_deux', valeur par défaut :
--     comportement actuel inchangé pour toutes les stations existantes).
--
--  3) expense_categories : catalogue de libellés de dépense (Saisie du
--     jour → « Dépenses en espèces »), modifiable par l'admin — remplace
--     la liste figée dans le code (SBEE/SUPERETTE/CARBURANT/AUTRE) et
--     ajoute SONEB. Catalogue PAR ORGANISATION (comme products) : les
--     4 catégories historiques sont protégées (is_system, non
--     supprimables), les nouvelles sont librement créées/désactivées
--     par l'admin de chaque client.
-- ============================================================

begin;

alter table settings add column if not exists photo_obligatoire boolean not null default false;

alter table stations add column if not exists suivi_lub_gaz text not null default 'les_deux';
alter table stations drop constraint if exists stations_suivi_lub_gaz_check;
alter table stations add constraint stations_suivi_lub_gaz_check check (suivi_lub_gaz in ('stock', 'vendu', 'les_deux'));

create table if not exists expense_categories (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references organisations(id) default public.current_org_id(),
  key text not null,
  label text not null,
  non_cash boolean not null default false,
  is_system boolean not null default false,
  actif boolean not null default true,
  ordre int not null default 100,
  created_at timestamptz default now()
);

-- Garanti explicitement par son nom (plutôt que "unique (...)" inline dans le create table) :
-- si la table existait déjà sans cette contrainte (ex. tentative précédente interrompue avant
-- d'arriver ici), le create table if not exists ci-dessus ne l'aurait pas ajoutée.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'expense_categories'::regclass and conname = 'expense_categories_org_key_key'
  ) then
    alter table expense_categories add constraint expense_categories_org_key_key unique (organisation_id, key);
  end if;
end $$;

-- "where not exists" plutôt que "on conflict" : fonctionne même si la ligne précédente n'a pas
-- pu créer la contrainte pour une raison imprévue (jamais d'erreur bloquante sur ce seed).
insert into expense_categories (organisation_id, key, label, non_cash, is_system, ordre)
select o.id, c.key, c.label, c.non_cash, true, c.ordre
from organisations o
cross join (values
  ('SBEE', 'SBEE', false, 10),
  ('SONEB', 'SONEB', false, 20),
  ('SUPERETTE', 'SUPERETTE', false, 30),
  ('CARBURANT', 'Carburant / déplacement (propriétaire)', true, 40),
  ('AUTRE', 'AUTRE', false, 50)
) as c(key, label, non_cash, ordre)
where not exists (
  select 1 from expense_categories ec where ec.organisation_id = o.id and ec.key = c.key
);

create index if not exists idx_expense_categories_org on expense_categories(organisation_id);

alter table expense_categories enable row level security;

drop trigger if exists trg_set_organisation on expense_categories;
create trigger trg_set_organisation before insert on expense_categories
  for each row execute function public.set_organisation_id();

-- Restrictive : cloisonnement par client, même modèle que toutes les autres tables métier (v96).
drop policy if exists tenant_isolation on expense_categories;
create policy tenant_isolation on expense_categories as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));

-- Permissive : lecture pour tout le monde (gérant en a besoin dans la liste déroulante),
-- écriture réservée à l'admin du client.
drop policy if exists p_expcat_sel on expense_categories;
create policy p_expcat_sel on expense_categories for select using (auth.role() = 'authenticated');
drop policy if exists p_expcat_ins on expense_categories;
create policy p_expcat_ins on expense_categories for insert with check (is_admin());
drop policy if exists p_expcat_upd on expense_categories;
create policy p_expcat_upd on expense_categories for update using (is_admin()) with check (is_admin());
drop policy if exists p_expcat_del on expense_categories;
create policy p_expcat_del on expense_categories for delete using (is_admin() and not is_system);
grant select, insert, update, delete on expense_categories to authenticated;

-- Même garde-fou que les rôles système : une catégorie historique ne peut jamais être
-- supprimée, pour ne jamais laisser une dépense déjà enregistrée référencer une catégorie
-- qui a disparu du catalogue.
create or replace function public.prevent_system_expcat_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.is_system and current_user = 'authenticated' then
    raise exception 'Catégorie système : suppression interdite (%).', old.key;
  end if;
  return old;
end; $$;
drop trigger if exists trg_prevent_system_expcat_delete on expense_categories;
create trigger trg_prevent_system_expcat_delete before delete on expense_categories
  for each row execute function public.prevent_system_expcat_delete();

commit;
