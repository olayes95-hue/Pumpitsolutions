-- ============================================================
--  MIGRATION v142 — Écart de jauge en KPI permanent (Tableau de bord), pas
--  seulement en alerte ponctuelle.
--
--  Aucune nouvelle donnée à saisir : v_stock_recon (migration_v95) calcule
--  déjà, pour chaque jour, l'écart entre le stock de cuve déclaré et le
--  stock théorique (stock de la veille − ventes du jour + réceptions du
--  jour) — c'est exactement la détection de coulage/perte physique en cuve
--  que l'app affiche aujourd'hui uniquement comme alerte ECART_STOCK
--  (migration_v132, seuil 300 L). Cette vue agrège simplement ces écarts
--  par mois, pour un affichage continu sur le Tableau de bord (voir
--  Dashboard.jsx) — là où PetroMaster (concurrent) l'affiche en continu
--  plutôt qu'en alerte isolée.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v141).
-- ============================================================

begin;

create or replace view public.v_ecart_jauge_mensuel as
select station_id, to_char(report_date, 'YYYY-MM') as mois,
  sum(ecart_ess) filter (where ecart_ess is not null) as ecart_ess_cumule,
  sum(ecart_gas) filter (where ecart_gas is not null) as ecart_gas_cumule,
  count(*) filter (where ecart_ess is not null) as nb_jours_ess,
  count(*) filter (where ecart_gas is not null) as nb_jours_gas
from public.v_stock_recon
group by station_id, to_char(report_date, 'YYYY-MM');

alter view public.v_ecart_jauge_mensuel set (security_invoker = on);
grant select on public.v_ecart_jauge_mensuel to authenticated, anon;

commit;
