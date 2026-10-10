-- ============================================================
--  MIGRATION v135 — Prix de consigne des bouteilles de gaz, avec la même
--  historisation automatique que prix_achat/prix_vente (voir migration_v101).
--
--  Nouvelle colonne products.consigne_prix (nullable, pertinente seulement
--  pour categorie='gaz') + extension du trigger existant
--  log_product_price_history (le trigger trg_log_product_price_history sur
--  products pointe déjà vers cette fonction, inutile de le recréer).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v134).
-- ============================================================

begin;

alter table public.products add column if not exists consigne_prix numeric;

alter table public.price_history drop constraint if exists price_history_champ_check;
alter table public.price_history add constraint price_history_champ_check
  check (champ in ('prix_achat', 'prix_vente', 'consigne_prix'));

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
  if new.consigne_prix is distinct from old.consigne_prix then
    insert into price_history(organisation_id, scope, categorie, produit, champ, ancienne_valeur, nouvelle_valeur, changed_by)
    values (new.organisation_id, 'produit', new.categorie, new.nom, 'consigne_prix', old.consigne_prix, new.consigne_prix, auth.uid());
  end if;
  return new;
end; $$;

commit;
