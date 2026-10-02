-- ============================================================
--  MIGRATION v94 — Commandes gaz/lubrifiant : montant calculé automatiquement
--  (quantité × prix d'achat catalogue) au lieu d'être tapé à la main, avec un
--  circuit de demande de correction du prix d'achat si le gérant le trouve faux
--  — validée par le directeur (permission validate_orders, déjà accordée à ce
--  rôle) ou l'admin, avant que le prix catalogue ne change réellement.
--
--  `products` reste modifiable en écriture directe seulement par l'admin
--  (p_products_all, inchangée) — un directeur qui valide une demande ne peut
--  donc pas écrire prix_achat lui-même ; le trigger ci-dessous (security
--  definer) applique le changement à sa place UNIQUEMENT quand une demande
--  passe à 'validee', jamais autrement — pas d'élargissement de l'accès en
--  écriture à `products` en général.
-- ============================================================

create table if not exists product_price_requests (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete cascade,
  station_id bigint references stations(id),   -- station du demandeur (scoping RLS)
  prix_actuel numeric,
  prix_demande numeric not null,
  motif text,
  statut text not null default 'en_attente',   -- en_attente / validee / refusee
  demande_par uuid references profiles(id),
  demande_at timestamptz default now(),
  traite_par uuid references profiles(id),
  traite_at timestamptz,
  note_traitement text
);

alter table product_price_requests enable row level security;

drop policy if exists p_ppr_sel on product_price_requests;
create policy p_ppr_sel on product_price_requests for select using (
  (select is_admin())
  or station_id = (select public.my_station())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('validate_orders'))
  )
);

drop policy if exists p_ppr_ins on product_price_requests;
create policy p_ppr_ins on product_price_requests for insert with check (
  (select is_admin()) or station_id = (select public.my_station())
);

-- Validation/refus : admin, ou profil habilité à valider les commandes (directeur) sur une
-- station à laquelle il a accès — même permission que l'écran Commandes utilise déjà pour
-- Valider/Refuser une proposition, cohérent avec "validé par le directeur ou l'admin".
drop policy if exists p_ppr_upd on product_price_requests;
create policy p_ppr_upd on product_price_requests for update using (
  (select is_admin())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('validate_orders'))
  )
) with check (
  (select is_admin())
  or (
    (array[station_id] && (select public.my_accessible_stations()))
    and (select public.has_permission('validate_orders'))
  )
);

grant select, insert, update on product_price_requests to authenticated;

-- Applique le nouveau prix au catalogue au moment précis où une demande passe à 'validee' —
-- avec les droits du créateur de la fonction (security definer), pas ceux de l'appelant, donc
-- un directeur (sans accès direct en écriture à `products`) peut valider une demande sans qu'on
-- lui ouvre `products` en général.
create or replace function public.apply_price_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'validee' and old.statut is distinct from 'validee' then
    update products set prix_achat = new.prix_demande where id = new.product_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_apply_price_request on product_price_requests;
create trigger trg_apply_price_request
  after update on product_price_requests
  for each row execute function public.apply_price_request();
