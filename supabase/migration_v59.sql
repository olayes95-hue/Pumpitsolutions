-- ============================================================
--  MIGRATION v59 — Lubrifiants, Phase D : stock théorique vs déclaré.
--
--  Aujourd'hui (v26), le stock gaz/lubrifiant = dernier relevé déclaré
--  par le gérant ; un écart réel (casse, vol, oubli) est invisible,
--  absorbé silencieusement dans v_sorties_deduites. Cette migration
--  ajoute, EN PLUS (v_sorties_deduites n'est ni modifiée ni retirée) :
--
--   - v_stock_theorique : stock reconstruit depuis le dernier relevé
--     déclaré + les mouvements de stock_movements enregistrés depuis.
--     Formule du cahier des charges lubrifiant :
--       théorique = stock de départ + Σ entrées − Σ sorties
--     où "stock de départ" = le dernier stock déclaré (pas besoin
--     d'une nouvelle table d'ancrage, la déclaration quotidienne joue
--     déjà ce rôle).
--   - stock_declarations_snapshot : fige théorique + écart au moment
--     exact où le gérant sauvegarde sa déclaration du jour, sinon
--     l'« écart initial » n'est plus reconstructible une fois que
--     d'autres mouvements sont ajoutés pour justifier l'écart.
--
--  Le trio théorique / physique en cours de saisie / écart (points
--  8-9 du cahier des charges) est calculé côté client (Stock.jsx,
--  Submit.jsx) car une vue ne peut pas voir un formulaire non
--  sauvegardé — cette vue est le primitif SQL réutilisé par ce calcul.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v58). Idempotente.
-- ============================================================

create or replace view v_stock_theorique as
with dernier_declare as (
  select distinct on (station_id, categorie, produit)
    station_id, categorie, produit, report_date as date_declare, q as stock_declare
  from v_stock_declare_jour
  order by station_id, categorie, produit, report_date desc
)
select
  d.station_id, d.categorie, d.produit, d.date_declare, d.stock_declare,
  d.stock_declare + coalesce((
    select sum(case when m.type = 'sortie' then -m.quantite else m.quantite end)
    from stock_movements m
    where m.station_id = d.station_id and m.categorie = d.categorie and m.produit = d.produit
      and m.date_mouvement > d.date_declare
  ), 0) as stock_theorique
from dernier_declare d;

grant select on v_stock_theorique to authenticated, anon;

create table if not exists stock_declarations_snapshot (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  categorie text not null,
  produit text not null,
  report_date date not null,
  stock_theorique_a_la_declaration numeric not null,
  stock_declare numeric not null,
  ecart_initial numeric not null,
  created_at timestamptz default now(),
  unique(station_id, categorie, produit, report_date));

alter table stock_declarations_snapshot enable row level security;
drop policy if exists p_sds_sel on stock_declarations_snapshot;
create policy p_sds_sel on stock_declarations_snapshot for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_sds_ins on stock_declarations_snapshot;
create policy p_sds_ins on stock_declarations_snapshot for insert with check (auth.role() = 'authenticated' and (is_admin() or station_id = public.my_station()));
drop policy if exists p_sds_upd on stock_declarations_snapshot;
create policy p_sds_upd on stock_declarations_snapshot for update using (is_admin() or station_id = public.my_station()) with check (is_admin() or station_id = public.my_station());
grant select, insert, update on stock_declarations_snapshot to authenticated;
