-- ============================================================
--  MIGRATION v51 — Rapprochement mensuel des bons.
--
--  Constat : les ventes à bon (ess_bon/gas_bon) sont déclarées au jour
--  le jour par le gérant, sans aucune preuve ni recoupement — contrairement
--  aux litres totaux (vérifiés contre les compteurs) ou au cash (vérifié
--  contre les versements). Rien ne confronte ce déclaratif à une source
--  externe, alors que la direction recouvre un montant par litre vendu à
--  bon (ex. le loyer est réglé via les bons, dont le volume fluctue).
--
--  Fix : une table où l'admin saisit, une fois par mois, le montant de
--  bons confirmé par la direction (relevé du système externe) — comparé
--  au total mensuel déclaré par le gérant (déjà disponible via
--  v_ventes_mensuelles.ventes_bon), écart calculé côté app.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v50). Idempotente.
-- ============================================================

create table if not exists finance_bons_reconciliation (
  id bigint generated always as identity primary key,
  station_id bigint references stations(id),
  mois text not null,                 -- 'YYYY-MM'
  montant_direction numeric not null default 0,
  note text,
  created_by uuid references profiles(id),
  updated_at timestamptz default now(),
  unique(station_id, mois));

alter table finance_bons_reconciliation enable row level security;
drop policy if exists p_fbr_sel on finance_bons_reconciliation;
create policy p_fbr_sel on finance_bons_reconciliation for select using (is_admin() or station_id = public.my_station());
drop policy if exists p_fbr_all on finance_bons_reconciliation;
create policy p_fbr_all on finance_bons_reconciliation for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on finance_bons_reconciliation to authenticated;
