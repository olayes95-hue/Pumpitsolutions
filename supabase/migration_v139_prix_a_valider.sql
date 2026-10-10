-- ============================================================
--  MIGRATION v139 — Le chef de piste (gérant) peut proposer un changement
--  de prix depuis Produits & prix (gaz/lubrifiant/supérette/autre), mais
--  ne peut jamais l'appliquer directement : sa hiérarchie (admin/directeur)
--  est notifiée et doit valider avant que le nouveau prix ne devienne réel.
--
--  Réutilise product_price_requests (migration_v94), jusqu'ici limité à
--  prix_achat et utilisé seulement depuis Orders.jsx (correction pendant
--  une commande) — généralisé à prix_vente/consigne_prix et à un usage
--  direct depuis Produits & prix. Le trigger apply_price_request() reste
--  security definer : le chef de piste n'a toujours aucun droit
--  d'écriture direct sur `products`.
--
--  Hors périmètre : l'onglet Carburant (prix essence/gasoil, table
--  settings) n'est pas couvert — structure différente, pas de table de
--  demandes. Le chef de piste n'y a pas accès.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v138).
-- ============================================================

begin;

alter table public.product_price_requests add column if not exists champ text not null default 'prix_achat'
  check (champ in ('prix_achat', 'prix_vente', 'consigne_prix'));

create or replace function public.apply_price_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'validee' and old.statut is distinct from 'validee' then
    if new.champ = 'prix_vente' then update public.products set prix_vente = new.prix_demande where id = new.product_id;
    elsif new.champ = 'consigne_prix' then update public.products set consigne_prix = new.prix_demande where id = new.product_id;
    else update public.products set prix_achat = new.prix_demande where id = new.product_id;
    end if;
  end if;
  return new;
end; $$;

insert into public.permissions (key, label, category)
select 'propose_prices', 'Produits & prix (proposer, validation requise)', 'Administration'
where not exists (select 1 from public.permissions where key = 'propose_prices');

insert into public.role_permissions (role_key, permission_key)
select 'gerant', 'propose_prices'
where exists (select 1 from public.roles where key = 'gerant')
  and not exists (select 1 from public.role_permissions where role_key = 'gerant' and permission_key = 'propose_prices');

insert into public.notification_rules (trigger_key, nom, destinataires, sujet, corps_html, actif)
select * from (values
  ('prix_a_valider', 'Prix à valider',
    '{"type":"roles_client","roles":["admin","directeur"]}'::jsonb,
    'Prix à valider — {{station}}',
    '{{gerant}} propose de changer le {{champ_label}} de {{produit}} : {{prix_actuel}} F → {{prix_demande}} F.<br><br>Validez ou refusez depuis Produits & prix.',
    false),
  ('prix_statut', 'Proposition de prix traitée',
    '{"type":"evenement","champ":"email_proposeur"}'::jsonb,
    'Votre proposition de prix a été {{statut}}',
    '{{produit}} — {{champ_label}} : {{prix_demande}} F a été {{statut}} par {{valideur}}.',
    false)
) as v(trigger_key, nom, destinataires, sujet, corps_html, actif)
where not exists (select 1 from public.notification_rules r where r.trigger_key = v.trigger_key);

commit;
