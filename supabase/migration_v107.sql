-- ============================================================
--  MIGRATION v107 — Rapprochement bancaire : catégories paramétrables,
--  débits conservés, rapprochement persistant.
--
--  1) bank_line_categories : catalogue admin-gérable (comme
--     expense_categories) — à quelle catégorie appartient une ligne de
--     relevé, par mots-clés dans sa description. Catégories système de
--     départ : versement gérant, virement fournisseur, frais bancaire,
--     chèque commande, autre (catch-all, jamais supprimable). L'admin
--     peut en créer d'autres (ex. "Remise de chèque").
--
--  2) bank_lines : + type (credit/debit — jusqu'ici seuls les crédits
--     étaient gardés), categorie_id, et deux liens de rapprochement
--     PERSISTANTS (matched_deposit_id, matched_mouvement_id) — pour un
--     rapprochement manuel qui ne se recalcule plus différemment à
--     chaque chargement de page.
-- ============================================================

begin;

create table if not exists bank_line_categories (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references organisations(id) default public.current_org_id(),
  key text not null,
  label text not null,
  mots_cles text[] not null default '{}',
  is_system boolean not null default false,
  actif boolean not null default true,
  ordre int not null default 100,
  created_at timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'bank_line_categories'::regclass and conname = 'bank_line_categories_org_key_key'
  ) then
    alter table bank_line_categories add constraint bank_line_categories_org_key_key unique (organisation_id, key);
  end if;
end $$;

insert into bank_line_categories (organisation_id, key, label, mots_cles, is_system, ordre)
select o.id, c.key, c.label, c.mots_cles, true, c.ordre
from organisations o
cross join (values
  ('versement_gerant', 'Versement gérant', array['VERSEMENT ESPECES', 'VERSEMENT ESPECE'], 10),
  ('virement_fournisseur', 'Virement fournisseur', array['VIR.RECU', 'VIREMENT RECU'], 20),
  ('frais_bancaire', 'Frais bancaire', array['TAXE', 'COMMISSION', 'FRAIS TENUE'], 30),
  ('cheque_commande', 'Chèque commande', array['CHEQUE', 'PAIEMENT CHQ'], 40),
  ('autre', 'Autre', array[]::text[], 999)
) as c(key, label, mots_cles, ordre)
where not exists (
  select 1 from bank_line_categories bc where bc.organisation_id = o.id and bc.key = c.key
);

create index if not exists idx_bank_line_categories_org on bank_line_categories(organisation_id);

alter table bank_line_categories enable row level security;

drop trigger if exists trg_set_organisation on bank_line_categories;
create trigger trg_set_organisation before insert on bank_line_categories
  for each row execute function public.set_organisation_id();

drop policy if exists tenant_isolation on bank_line_categories;
create policy tenant_isolation on bank_line_categories as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));

drop policy if exists p_banklinecat_sel on bank_line_categories;
create policy p_banklinecat_sel on bank_line_categories for select using (auth.role() = 'authenticated');
drop policy if exists p_banklinecat_ins on bank_line_categories;
create policy p_banklinecat_ins on bank_line_categories for insert with check (is_admin());
drop policy if exists p_banklinecat_upd on bank_line_categories;
create policy p_banklinecat_upd on bank_line_categories for update using (is_admin()) with check (is_admin());
drop policy if exists p_banklinecat_del on bank_line_categories;
create policy p_banklinecat_del on bank_line_categories for delete using (is_admin() and not is_system);
grant select, insert, update, delete on bank_line_categories to authenticated;

create or replace function public.prevent_system_banklinecat_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.is_system and current_user = 'authenticated' then
    raise exception 'Catégorie système : suppression interdite (%).', old.key;
  end if;
  return old;
end; $$;
drop trigger if exists trg_prevent_system_banklinecat_delete on bank_line_categories;
create trigger trg_prevent_system_banklinecat_delete before delete on bank_line_categories
  for each row execute function public.prevent_system_banklinecat_delete();

-- ------------------------------------------------------------
-- bank_lines : type, catégorie, rapprochement persistant
-- ------------------------------------------------------------
alter table bank_lines add column if not exists type text not null default 'credit';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'bank_lines'::regclass and conname = 'bank_lines_type_check') then
    alter table bank_lines add constraint bank_lines_type_check check (type in ('credit', 'debit'));
  end if;
end $$;

alter table bank_lines add column if not exists categorie_id bigint references bank_line_categories(id);
alter table bank_lines add column if not exists matched_deposit_id bigint references deposits(id) on delete set null;
alter table bank_lines add column if not exists matched_mouvement_id bigint references compte_bancaire_mouvements(id) on delete set null;

-- Lignes déjà importées/saisies (toutes des crédits, voir migration_v4) : rattachées à la
-- catégorie "versement_gerant" de leur organisation — c'était leur seul usage jusqu'ici.
update bank_lines bl set categorie_id = bc.id
from bank_line_categories bc
where bl.categorie_id is null and bc.organisation_id = bl.organisation_id and bc.key = 'versement_gerant';

create index if not exists idx_bank_lines_categorie on bank_lines(categorie_id);

commit;
