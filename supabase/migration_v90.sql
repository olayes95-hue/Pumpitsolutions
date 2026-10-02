-- ============================================================
--  MIGRATION v90 — Le solde bancaire ne décrémentait que les chèques
--  CARBURANT (fuel_orders.cheque_montant). Les commandes gaz/lubrifiant/
--  supérette payées par chèque (mode_paiement = 'cheque', montant dans
--  montant_paiement — voir migration_v22.sql) n'étaient jamais comptées :
--  ces 2 façons de représenter un paiement par chèque coexistent sur
--  fuel_orders selon la catégorie (carburant vs gaz/lubrifiant/superette),
--  et seule la première alimentait v_compte_bancaire.
--
--  Fix : la CTE `cheques` de v_compte_bancaire additionne maintenant les
--  deux — même déclencheur qu'avant (date_lancement renseigné, donc
--  décompte au moment où la commande est LANCÉE, pas juste validée),
--  même exclusion des commandes annulées.
--
--  Note (leçon de v87/v89) : un CREATE OR REPLACE VIEW ne conserve pas
--  l'option security_invoker — réappliquée explicitement ci-dessous.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v89). Idempotente.
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
  select o.station_id,
    sum(case
      when coalesce(o.categorie, 'carburant') = 'carburant' then coalesce(o.cheque_montant, 0)
      when o.mode_paiement = 'cheque' then coalesce(o.montant_paiement, 0)
      else 0
    end) as total_cheques
  from fuel_orders o join si on si.station_id = o.station_id
  where o.statut <> 'annulee' and o.date_lancement is not null and o.date_lancement > si.date_solde
  group by o.station_id
),
virements as (
  select m.station_id, sum(m.montant) as total_virements
  from compte_bancaire_mouvements m join si on si.station_id = m.station_id
  where m.type = 'virement_bons' and m.date_mouvement > si.date_solde
  group by m.station_id
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

alter view public.v_compte_bancaire set (security_invoker = on);

grant select on v_compte_bancaire to authenticated, anon;
