-- ============================================================
--  MIGRATION v155 — Prix d'ACHAT de la consigne gaz, symétrique au prix
--  de vente déjà existant (products.consigne_prix, migration_v135) :
--  jusqu'ici une seule valeur de consigne (ce qui est PERÇU du client à
--  la vente) — rien côté coût (ce que la station PAIE au fournisseur
--  quand elle commande de nouvelles bouteilles, pas un simple échange).
--
--  fuel_orders.avec_consigne (gaz uniquement) : une commande peut porter
--  sur de la recharge seule (échange, coût = prix_achat) OU sur des
--  bouteilles neuves avec consigne (coût = prix_achat + consigne_prix_achat,
--  même logique additive que côté vente : "prix_vente + consigne perçue
--  si pas de vide rendu"). La réception ne change pas (reste un seul
--  quantite_recue — ce qui arrive physiquement est identique, seul le
--  coût facturé diffère).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v154).
-- ============================================================

begin;

alter table public.products add column if not exists consigne_prix_achat numeric;
alter table public.fuel_orders add column if not exists avec_consigne boolean not null default false;

-- log_product_price_history() (dernière version en prod, migration_v135) + consigne_prix_achat.
alter table public.price_history drop constraint if exists price_history_champ_check;
alter table public.price_history add constraint price_history_champ_check
  check (champ in ('prix_achat', 'prix_vente', 'consigne_prix', 'consigne_prix_achat'));

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
  if new.consigne_prix_achat is distinct from old.consigne_prix_achat then
    insert into price_history(organisation_id, scope, categorie, produit, champ, ancienne_valeur, nouvelle_valeur, changed_by)
    values (new.organisation_id, 'produit', new.categorie, new.nom, 'consigne_prix_achat', old.consigne_prix_achat, new.consigne_prix_achat, auth.uid());
  end if;
  return new;
end; $$;

-- product_price_requests (migration_v139) : consigne_prix_achat rejoint les champs proposables
-- par le chef de piste (comme consigne_prix) — même workflow d'approbation.
alter table public.product_price_requests drop constraint if exists product_price_requests_champ_check;
alter table public.product_price_requests add constraint product_price_requests_champ_check
  check (champ in ('prix_achat', 'prix_vente', 'consigne_prix', 'consigne_prix_achat'));

create or replace function public.apply_price_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'validee' and old.statut is distinct from 'validee' then
    if new.champ = 'prix_vente' then update public.products set prix_vente = new.prix_demande where id = new.product_id;
    elsif new.champ = 'consigne_prix' then update public.products set consigne_prix = new.prix_demande where id = new.product_id;
    elsif new.champ = 'consigne_prix_achat' then update public.products set consigne_prix_achat = new.prix_demande where id = new.product_id;
    else update public.products set prix_achat = new.prix_demande where id = new.product_id;
    end if;
  end if;
  return new;
end; $$;

commit;
