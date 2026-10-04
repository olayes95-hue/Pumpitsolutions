-- ============================================================
--  MIGRATION v112 — Frais bancaires aussi depuis le relevé importé
--  (même traitement que virement_fournisseur en v111).
--
--  total_frais venait d'une saisie manuelle (compte_bancaire_mouvements,
--  type='frais_bancaire') — vient désormais de bank_lines (catégorie
--  frais_bancaire, débit), la source la plus fiable. Avec v111, plus
--  aucun mouvement manuel n'est nécessaire dans Trésorerie : le compte
--  bancaire se suit entièrement depuis le relevé importé/classé dans
--  Rapprochement. L'historique des anciens mouvements saisis à la main
--  reste visible (lecture) pour l'audit, mais le formulaire d'ajout
--  disparaît côté front (voir Finance.jsx).
-- ============================================================

create or replace view v_compte_bancaire as
with si as (
  select station_id, date_solde, montant as solde_initial
  from compte_bancaire_solde_initial
),
depots as (
  select d.station_id, sum(d.montant) as total_depots
  from deposits d join si on si.station_id = d.station_id
  where d.report_date > si.date_solde
  group by d.station_id
),
cheques as (
  select o.station_id, sum(coalesce(o.cheque_montant,0)) as total_cheques
  from fuel_orders o join si on si.station_id = o.station_id
  where o.statut <> 'annulee' and o.date_lancement is not null and o.date_lancement > si.date_solde
  group by o.station_id
),
virements as (
  select b.station_id, sum(b.montant) as total_virements
  from bank_lines b
  join bank_line_categories bc on bc.id = b.categorie_id and bc.key = 'virement_fournisseur'
  join si on si.station_id = b.station_id
  where b.type = 'credit' and b.date_operation > si.date_solde
  group by b.station_id
),
frais as (
  select b.station_id, sum(b.montant) as total_frais
  from bank_lines b
  join bank_line_categories bc on bc.id = b.categorie_id and bc.key = 'frais_bancaire'
  join si on si.station_id = b.station_id
  where b.type = 'debit' and b.date_operation > si.date_solde
  group by b.station_id
)
select si.station_id, si.date_solde, si.solde_initial,
  coalesce(dp.total_depots,0) as total_depots,
  coalesce(ch.total_cheques,0) as total_cheques,
  coalesce(vi.total_virements,0) as total_virements,
  coalesce(fr.total_frais,0) as total_frais,
  si.solde_initial + coalesce(dp.total_depots,0) - coalesce(ch.total_cheques,0)
    + coalesce(vi.total_virements,0) - coalesce(fr.total_frais,0) as solde_actuel
from si
left join depots dp on dp.station_id = si.station_id
left join cheques ch on ch.station_id = si.station_id
left join virements vi on vi.station_id = si.station_id
left join frais fr on fr.station_id = si.station_id;

grant select on v_compte_bancaire to authenticated, anon;
alter view public.v_compte_bancaire set (security_invoker = on);
