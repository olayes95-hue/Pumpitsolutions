-- ============================================================
--  MIGRATION v111 — v_compte_bancaire : virements reçus (bons) depuis le
--  relevé réel importé, plus de double saisie.
--
--  Jusqu'ici "Virements bons reçus" venait d'une saisie manuelle dans
--  Trésorerie (compte_bancaire_mouvements, type='virement_bons') — en
--  double avec les lignes "virement_fournisseur" du relevé bancaire
--  importé et classées dans Rapprochement. Le relevé réel est la
--  source la plus fiable (c'est la banque elle-même) : total_virements
--  vient maintenant de bank_lines (catégorie virement_fournisseur,
--  crédit), plus besoin de le ressaisir à la main.
--
--  frais_bancaire n'est PAS touché ici (hors périmètre de la demande) —
--  reste sur compte_bancaire_mouvements, saisie manuelle inchangée.
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
  select m.station_id, sum(m.montant) as total_frais
  from compte_bancaire_mouvements m join si on si.station_id = m.station_id
  where m.type = 'frais_bancaire' and m.date_mouvement > si.date_solde
  group by m.station_id
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
