-- ============================================================
--  MIGRATION v134 — Suivi des bouteilles de gaz : pleines / vides /
--  consignées (en circulation chez des clients).
--
--  Aujourd'hui, le stock de gaz (daily_reports.gaz_stock_3/6/12/38) est une
--  DÉCLARATION quotidienne du gérant, pas un solde calculé — la consommation
--  est déduite (v_sorties_deduites, migration_v26) par
--  stock(J-1) + entrées(J) − stock(J). stock_movements existe déjà mais, pour
--  le gaz, ne reçoit que des réceptions (type='entree') — aucune sortie n'y
--  est écrite depuis la v26 (retiré intentionnellement). On ne touche à RIEN
--  de ce mécanisme existant (risque de régression sur la commission gaz et
--  tout ce qui en dépend) : gaz_stock_* continue de représenter les PLEINES,
--  inchangé. Vides et consignées sont entièrement nouveaux, alimentés par un
--  journal de mouvements séparé qui ne touche à aucune formule existante.
--
--  Dans le commerce du GPL : une vente "échange" reprend une bouteille vide
--  du client (pas de consigne) ; une vente "consignée" part sans reprise, le
--  client paie une consigne et garde la bouteille jusqu'à un retour éventuel.
--
--  Limite assumée en v1 : le renvoi des bouteilles vides au fournisseur (lors
--  d'une nouvelle commande) n'est pas distingué d'un simple stockage sur site
--  — vides_stock peut donc dériver vers le haut si cette sortie n'est jamais
--  enregistrée. Un type='ajustement' permet de corriger manuellement.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v133).
-- ============================================================

begin;

create table if not exists public.gaz_mouvements_bouteilles (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) default public.current_org_id(),
  station_id bigint not null references public.stations(id),
  report_date date not null default current_date,
  taille text not null,               -- '3 kg' / '6 kg' / '12 kg' / '38 kg' (= products.nom, categorie='gaz')
  type text not null check (type in (
    'vente_echange',              -- vente avec reprise d'une bouteille vide du client (pas de consigne)
    'vente_consigne',             -- vente sans reprise : le client paie une consigne, part avec la bouteille
    'retour_vide',                -- le client rend une bouteille vide (sans remboursement de consigne)
    'retour_consigne_remboursee', -- le client rend une bouteille vide ET la consigne lui est remboursée
    'perte_consigne',             -- bouteille consignée jamais rendue (abandon définitif, sort de la circulation)
    'ajustement'                  -- correction manuelle (admin)
  )),
  quantite int not null check (quantite > 0),
  montant_consigne numeric,            -- F collectés (vente_consigne) ou remboursés (retour_consigne_remboursee)
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_gaz_mvt_bouteilles on public.gaz_mouvements_bouteilles(station_id, taille, report_date);

alter table public.gaz_mouvements_bouteilles enable row level security;

drop trigger if exists trg_set_organisation on public.gaz_mouvements_bouteilles;
create trigger trg_set_organisation before insert on public.gaz_mouvements_bouteilles
  for each row execute function public.set_organisation_id();

drop policy if exists tenant_isolation on public.gaz_mouvements_bouteilles;
create policy tenant_isolation on public.gaz_mouvements_bouteilles as restrictive for all
  using (organisation_id = (select public.current_org_id()))
  with check (organisation_id = (select public.current_org_id()));

-- Même périmètre de lecture que fuel_orders (station propre, ou multi-station avec
-- view_dashboard/view_finance/manage_orders), même écriture que fuel_orders (manage_orders).
drop policy if exists p_gazmvt_sel on public.gaz_mouvements_bouteilles;
create policy p_gazmvt_sel on public.gaz_mouvements_bouteilles for select using (
  is_admin() or station_id = (select public.my_station())
  or (
    array[station_id] && (select public.my_accessible_stations())
    and (select public.my_permissions()) && array['view_dashboard', 'view_finance', 'manage_orders']
  )
);
drop policy if exists p_gazmvt_ins on public.gaz_mouvements_bouteilles;
create policy p_gazmvt_ins on public.gaz_mouvements_bouteilles for insert with check (
  is_admin() or ((select public.my_permissions()) && array['manage_orders'] and station_id = (select public.my_station()))
);
drop policy if exists p_gazmvt_del on public.gaz_mouvements_bouteilles;
create policy p_gazmvt_del on public.gaz_mouvements_bouteilles for delete using (is_admin());
grant select, insert, delete on public.gaz_mouvements_bouteilles to authenticated;

-- Pleines (déclaré, inchangé) / vides / consignées en circulation, par station et taille.
create or replace view public.v_gaz_etats_bouteilles as
select
  s.id as station_id,
  tailles.taille,
  coalesce(ls.pleines_stock, 0) as pleines_stock,
  coalesce(m.vides_stock, 0) as vides_stock,
  coalesce(m.consignees_circulation, 0) as consignees_circulation,
  coalesce(m.consigne_nette_f, 0) as consigne_nette_f
from public.stations s
cross join (values ('3 kg'), ('6 kg'), ('12 kg'), ('38 kg')) as tailles(taille)
left join lateral (
  select case tailles.taille
    when '3 kg' then (select gaz_stock_3 from public.daily_reports r where r.station_id = s.id and r.gaz_stock_3 is not null order by r.report_date desc limit 1)
    when '6 kg' then (select gaz_stock_6 from public.daily_reports r where r.station_id = s.id and r.gaz_stock_6 is not null order by r.report_date desc limit 1)
    when '12 kg' then (select gaz_stock_12 from public.daily_reports r where r.station_id = s.id and r.gaz_stock_12 is not null order by r.report_date desc limit 1)
    when '38 kg' then (select gaz_stock_38 from public.daily_reports r where r.station_id = s.id and r.gaz_stock_38 is not null order by r.report_date desc limit 1)
  end as pleines_stock
) ls on true
left join lateral (
  select
    sum(case when type in ('retour_vide', 'retour_consigne_remboursee') then quantite else 0 end) as vides_stock,
    sum(case when type = 'vente_consigne' then quantite
             when type in ('retour_vide', 'retour_consigne_remboursee', 'perte_consigne') then -quantite
             else 0 end) as consignees_circulation,
    sum(case when type = 'vente_consigne' then coalesce(montant_consigne, 0)
             when type = 'retour_consigne_remboursee' then -coalesce(montant_consigne, 0)
             else 0 end) as consigne_nette_f
  from public.gaz_mouvements_bouteilles gm
  where gm.station_id = s.id and gm.taille = tailles.taille
) m on true;
alter view public.v_gaz_etats_bouteilles set (security_invoker = on);

commit;
