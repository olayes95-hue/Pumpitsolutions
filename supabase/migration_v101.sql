-- ============================================================
--  MIGRATION v101 — Historique des prix (carburant, gaz, lubrifiant,
--  supérette) consultable par l'admin et le directeur.
--
--  Chaque changement de prix (settings.essence_pv/essence_pa/gasoil_pv/
--  gasoil_pa, products.prix_achat/prix_vente) est journalisé automatiquement
--  par trigger dans price_history — personne ne le remplit à la main,
--  et l'application ne peut pas le modifier après coup (pas de grant
--  insert/update/delete à authenticated, seules les fonctions trigger,
--  security definer, écrivent dedans).
--
--  Nouvelle permission view_price_history (catalogue commun, voir v65) :
--  accordée par défaut au directeur, en plus de l'admin (accès libre
--  comme toujours). Le comptable ne l'a pas par défaut — l'admin peut
--  l'ajouter depuis Stations & équipe → Rôles s'il le souhaite.
-- ============================================================

begin;

create table if not exists price_history (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references organisations(id) default public.current_org_id(),
  scope text not null check (scope in ('carburant', 'produit')),
  categorie text,
  produit text not null,
  champ text not null check (champ in ('prix_achat', 'prix_vente')),
  ancienne_valeur numeric,
  nouvelle_valeur numeric,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);

create index if not exists idx_price_history_org on price_history(organisation_id);
create index if not exists idx_price_history_produit on price_history(organisation_id, produit, changed_at desc);

alter table price_history enable row level security;

drop policy if exists tenant_isolation on price_history;
create policy tenant_isolation on price_history as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));

drop policy if exists p_pricehist_sel on price_history;
create policy p_pricehist_sel on price_history for select using (
  (select public.is_admin()) or (select public.has_permission('view_price_history'))
);
grant select on price_history to authenticated;
-- Pas de grant insert/update/delete à authenticated : seules les fonctions
-- trigger ci-dessous (security definer) écrivent dans cette table.

create or replace function public.log_settings_price_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.essence_pv is distinct from old.essence_pv then
    insert into price_history(organisation_id, scope, categorie, produit, champ, ancienne_valeur, nouvelle_valeur, changed_by)
    values (new.organisation_id, 'carburant', 'essence', 'Essence', 'prix_vente', old.essence_pv, new.essence_pv, auth.uid());
  end if;
  if new.essence_pa is distinct from old.essence_pa then
    insert into price_history(organisation_id, scope, categorie, produit, champ, ancienne_valeur, nouvelle_valeur, changed_by)
    values (new.organisation_id, 'carburant', 'essence', 'Essence', 'prix_achat', old.essence_pa, new.essence_pa, auth.uid());
  end if;
  if new.gasoil_pv is distinct from old.gasoil_pv then
    insert into price_history(organisation_id, scope, categorie, produit, champ, ancienne_valeur, nouvelle_valeur, changed_by)
    values (new.organisation_id, 'carburant', 'gasoil', 'Gasoil', 'prix_vente', old.gasoil_pv, new.gasoil_pv, auth.uid());
  end if;
  if new.gasoil_pa is distinct from old.gasoil_pa then
    insert into price_history(organisation_id, scope, categorie, produit, champ, ancienne_valeur, nouvelle_valeur, changed_by)
    values (new.organisation_id, 'carburant', 'gasoil', 'Gasoil', 'prix_achat', old.gasoil_pa, new.gasoil_pa, auth.uid());
  end if;
  return new;
end; $$;
drop trigger if exists trg_log_settings_price_history on settings;
create trigger trg_log_settings_price_history after update on settings
  for each row execute function public.log_settings_price_history();

create or replace function public.log_product_price_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.prix_achat is distinct from old.prix_achat then
    insert into price_history(organisation_id, scope, categorie, produit, champ, ancienne_valeur, nouvelle_valeur, changed_by)
    values (new.organisation_id, 'produit', new.categorie, new.nom, 'prix_achat', old.prix_achat, new.prix_achat, auth.uid());
  end if;
  if new.prix_vente is distinct from old.prix_vente then
    insert into price_history(organisation_id, scope, categorie, produit, champ, ancienne_valeur, nouvelle_valeur, changed_by)
    values (new.organisation_id, 'produit', new.categorie, new.nom, 'prix_vente', old.prix_vente, new.prix_vente, auth.uid());
  end if;
  return new;
end; $$;
drop trigger if exists trg_log_product_price_history on products;
create trigger trg_log_product_price_history after update on products
  for each row execute function public.log_product_price_history();

-- Vue de confort : nom de la personne qui a changé le prix. security_invoker (toujours — voir
-- les régressions passées sur ce point) : hérite du RLS de price_history ET de profiles.
create or replace view v_price_history as
select ph.*, pr.full_name as changed_by_name
from price_history ph
left join profiles pr on pr.id = ph.changed_by;
grant select on v_price_history to authenticated;
alter view public.v_price_history set (security_invoker = on);

insert into permissions (key, label, category)
select 'view_price_history', 'Historique des prix', 'Pilotage'
where not exists (select 1 from permissions where key = 'view_price_history');

insert into role_permissions (role_key, permission_key)
select 'directeur', 'view_price_history'
where exists (select 1 from roles where key = 'directeur')
  and not exists (select 1 from role_permissions where role_key = 'directeur' and permission_key = 'view_price_history');

commit;
