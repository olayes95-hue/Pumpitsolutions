-- ============================================================
--  MIGRATION v165 — Réception de gaz promo (dépôt-vente) + suivi NCE.
--
--  Le gaz promo est vendu en dépôt-vente : une partie de l'argent doit
--  retourner au fournisseur, prélevée sur le compte de la station par
--  note de crédit (NCE) à une échéance connue dès la réception. Le chef
--  de piste déclare chaque réception (jour, type, quantité, valeur) ;
--  le montant à retourner et son échéance sont saisis à la main (NCE
--  réelle du fournisseur) ; une pièce jointe (photo du bon/NCE) peut
--  être associée. Finance suit ensuite les NCE dues/échues comme les
--  charges à payer.
--
--  RLS calquée sur deliveries (même famille d'écran opérationnel) :
--  insertion par qui a manage_orders sur sa station, lecture élargie à
--  view_finance/view_dashboard/view_history, mise à jour (marquer
--  réglée) réservée à manage_finance/admin.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v164).
-- ============================================================

begin;

create table public.gaz_promo_receptions (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) default public.current_org_id(),
  station_id bigint not null references public.stations(id),
  report_date date not null default current_date,
  taille text not null check (taille in ('3', '6', '12', '38')),
  quantite numeric not null check (quantite > 0),
  prix_vente_unitaire numeric not null check (prix_vente_unitaire >= 0),
  montant_retour_fournisseur numeric not null check (montant_retour_fournisseur >= 0),
  date_echeance date not null,
  statut text not null default 'a_regler' check (statut in ('a_regler', 'regle')),
  regle_le date,
  photo_path text,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index idx_gpr_station_date on public.gaz_promo_receptions(station_id, report_date desc);
create index idx_gpr_echeance on public.gaz_promo_receptions(station_id, date_echeance) where statut = 'a_regler';

alter table public.gaz_promo_receptions enable row level security;

create policy tenant_isolation on public.gaz_promo_receptions as restrictive for all
  using (organisation_id = public.current_org_id())
  with check (organisation_id = public.current_org_id());

create trigger trg_set_organisation before insert on public.gaz_promo_receptions
  for each row execute function public.set_organisation_id();

create policy p_gpr_ins on public.gaz_promo_receptions for insert
  with check (public.is_admin() or ((select public.my_permissions()) && array['manage_orders'] and station_id = public.my_station()));

create policy p_gpr_sel on public.gaz_promo_receptions for select
  using (
    public.is_admin()
    or station_id = public.my_station()
    or ((array[station_id] && public.my_accessible_stations())
        and ((select public.has_permission('view_dashboard')) or (select public.has_permission('view_history')) or (select public.has_permission('view_finance'))))
  );

create policy p_gpr_upd on public.gaz_promo_receptions for update
  using (public.is_admin() or ((select public.my_permissions()) && array['manage_finance']))
  with check (public.is_admin() or ((select public.my_permissions()) && array['manage_finance']));

create policy p_gpr_del on public.gaz_promo_receptions for delete
  using (public.is_admin());

commit;
