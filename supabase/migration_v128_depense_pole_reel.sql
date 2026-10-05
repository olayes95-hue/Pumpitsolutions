-- ============================================================
--  MIGRATION v128 — Choix réel du portefeuille (pôle) pour les dépenses.
--
--  Contexte : toute dépense cash est aujourd'hui supposée sortir de la caisse
--  carburant (câblé en dur depuis la migration v36, dans v_recette_groupe_jour)
--  — gaz_lub et supérette n'ont jamais aucune dépense déduite, même quand une
--  charge est en réalité payée depuis leur propre caisse. Le gérant choisit
--  désormais explicitement de quel(s) pôle(s) une dépense sort (carburant,
--  gaz, lubrifiant, supérette, ou une combinaison), et CE CHOIX CHANGE LE
--  CALCUL RÉEL du manque à verser — Historique, Alertes, Journal de bord,
--  Tableau de bord en profitent tous automatiquement, puisqu'ils reposent
--  tous (directement ou via v_verse_recon/v_pole_recon_jour) sur
--  v_recette_groupe_jour, modifiée ici.
--
--  Portée volontairement étroite : seul QUEL PÔLE porte une dépense change.
--  Le principe du calcul (par période, bordereau de versement — déjà
--  vérifié, 149 780 F pour Beaurivage/septembre) reste À L'IDENTIQUE. Rien
--  à voir avec la tentative calendaire (migration_v126, annulée) : aucune
--  notion de mois civil introduite ici.
--
--  Garantie de non-régression : une dépense non taguée (poles = '[]', donc
--  TOUTE dépense existante avant cette migration, et toute dépense future
--  tant que le gérant n'a pas touché la sélection) retombe exactement sur
--  l'ancien comportement câblé en dur (categorie='SUPERETTE' -> superette,
--  sinon -> carburant) — calcul inchangé tant que personne ne tague
--  explicitement un pôle différent.
--
--  Idempotente et rejouable (sûre que la v126/v127 aient déjà été appliquées
--  ou non sur cette base — toutes les étapes sont IF NOT EXISTS / CREATE OR
--  REPLACE / DROP IF EXISTS).
-- ============================================================

-- ── 1. Colonne poles sur expenses ───────────────────────────
alter table public.expenses
  add column if not exists poles jsonb not null default '[]'::jsonb;

comment on column public.expenses.poles is
  'Répartition de la dépense cash entre pôles : [{"pole":"carburant","montant":30000}, ...]. '
  'pole ∈ mêmes valeurs que deposits.pole (carburant/gaz/lubrifiant/gaz_lubrifiant/superette). '
  'poles=''[]'' (toute dépense non taguée) = repli sur l''ancien comportement câblé en dur '
  '(categorie=SUPERETTE -> superette, sinon -> carburant), géré dans v_recette_groupe_jour.';

-- ── 2. Nettoyage d'un éventuel résidu de la tentative calendaire (v126) ──
drop view if exists v_pole_mois_calendaire;
drop view if exists v_depense_pole_jour_calendaire;

-- ── 3. v_recette_groupe_jour : dépense attribuée par pôle réel ──────────
-- Remplace le câblage en dur "toute dépense cash = carburant" par une
-- lecture de expenses.poles, avec repli identique à l'ancien comportement
-- pour toute dépense non taguée. espece (CA déclaré par pôle) ne change pas.
create or replace view v_recette_groupe_jour as
with depense_pole as (
  with tagged as (
    select e.station_id, e.report_date,
      case when x.pole = 'carburant' then 'carburant'
           when x.pole in ('gaz', 'lubrifiant', 'gaz_lubrifiant') then 'gaz_lub'
           else 'superette' end as pole_groupe,
      x.montant
    from public.expenses e
    cross join lateral jsonb_to_recordset(e.poles) as x(pole text, montant numeric)
    where coalesce(e.non_cash, false) = false
  ),
  fallback as (
    select e.station_id, e.report_date,
      case when upper(coalesce(e.categorie, '')) = 'SUPERETTE' then 'superette' else 'carburant' end as pole_groupe,
      e.montant
    from public.expenses e
    where coalesce(e.non_cash, false) = false
      and (e.poles is null or jsonb_array_length(e.poles) = 0)
  )
  select station_id, report_date, pole_groupe, sum(montant) as depense
  from (select * from tagged union all select * from fallback) u
  group by 1, 2, 3
)
select d.station_id, d.report_date, 'carburant'::text as pole_groupe,
       coalesce(d.ess_espece, 0) + coalesce(d.gas_espece, 0) as espece,
       coalesce(dp.depense, 0) as depense
from public.daily_reports d
left join depense_pole dp on dp.station_id = d.station_id and dp.report_date = d.report_date and dp.pole_groupe = 'carburant'
union all
select d.station_id, d.report_date, 'gaz_lub',
       coalesce(d.gaz_espece, 0) + coalesce(d.lubrifiant_espece, 0),
       coalesce(dp.depense, 0)
from public.daily_reports d
left join depense_pole dp on dp.station_id = d.station_id and dp.report_date = d.report_date and dp.pole_groupe = 'gaz_lub'
union all
select d.station_id, d.report_date, 'superette',
       coalesce(d.superette_espece, 0),
       coalesce(dp.depense, 0)
from public.daily_reports d
left join depense_pole dp on dp.station_id = d.station_id and dp.report_date = d.report_date and dp.pole_groupe = 'superette';

grant select on v_recette_groupe_jour to authenticated, anon;

-- ── 4. RPC enregistrer_saisie_jour : accepte et persiste poles ──────────
-- Même signature que migration_v122 (poles voyage dans p_expenses, déjà
-- jsonb) — seul le bloc "expenses" change (colonne poles ajoutée à l'insert).
create or replace function public.enregistrer_saisie_jour(
  p_station_id bigint, p_report_date date, p_moment text, p_payload jsonb, p_set_matin boolean,
  p_snapshot jsonb default '[]'::jsonb, p_expenses jsonb default '[]'::jsonb,
  p_deliveries jsonb default '[]'::jsonb, p_deposits jsonb default '[]'::jsonb,
  p_superette_cogs numeric default null
) returns void language plpgsql set search_path = public as $$
declare v_row public.daily_reports%rowtype; v_full jsonb;
begin
  v_full := p_payload || jsonb_build_object('station_id', p_station_id, 'report_date', p_report_date, 'created_by', auth.uid());
  v_row := jsonb_populate_record(null::public.daily_reports, v_full);

  insert into public.daily_reports (
    station_id, report_date, created_by, lubrifiant_stock, lubrifiant_vendu, note,
    ess_litres, ess_pu, ess_bon, ess_espece, gas_litres, gas_pu, gas_bon, gas_espece,
    gaz_espece, superette_espece, lubrifiant_espece,
    e1, e2, e3, e4, e5, e6, e7, e8, e9, e10,
    g1, g2, g3, g4, g5, g6, g7, g8, g9, g10,
    e1_m, e2_m, e3_m, e4_m, e5_m, e6_m, e7_m, e8_m, e9_m, e10_m,
    g1_m, g2_m, g3_m, g4_m, g5_m, g6_m, g7_m, g8_m, g9_m, g10_m,
    total_bon_cumul, ess_stock, gas_stock,
    gaz_stock_3, gaz_stock_6, gaz_stock_12, gaz_stock_38,
    gaz_vendu_3, gaz_vendu_6, gaz_vendu_12, gaz_vendu_38,
    ess_stock_matin, gas_stock_matin
  ) values (
    v_row.station_id, v_row.report_date, v_row.created_by, v_row.lubrifiant_stock, v_row.lubrifiant_vendu, v_row.note,
    v_row.ess_litres, v_row.ess_pu, v_row.ess_bon, v_row.ess_espece, v_row.gas_litres, v_row.gas_pu, v_row.gas_bon, v_row.gas_espece,
    v_row.gaz_espece, v_row.superette_espece, v_row.lubrifiant_espece,
    v_row.e1, v_row.e2, v_row.e3, v_row.e4, v_row.e5, v_row.e6, v_row.e7, v_row.e8, v_row.e9, v_row.e10,
    v_row.g1, v_row.g2, v_row.g3, v_row.g4, v_row.g5, v_row.g6, v_row.g7, v_row.g8, v_row.g9, v_row.g10,
    v_row.e1_m, v_row.e2_m, v_row.e3_m, v_row.e4_m, v_row.e5_m, v_row.e6_m, v_row.e7_m, v_row.e8_m, v_row.e9_m, v_row.e10_m,
    v_row.g1_m, v_row.g2_m, v_row.g3_m, v_row.g4_m, v_row.g5_m, v_row.g6_m, v_row.g7_m, v_row.g8_m, v_row.g9_m, v_row.g10_m,
    v_row.total_bon_cumul, v_row.ess_stock, v_row.gas_stock,
    v_row.gaz_stock_3, v_row.gaz_stock_6, v_row.gaz_stock_12, v_row.gaz_stock_38,
    v_row.gaz_vendu_3, v_row.gaz_vendu_6, v_row.gaz_vendu_12, v_row.gaz_vendu_38,
    v_row.ess_stock_matin, v_row.gas_stock_matin
  )
  on conflict (station_id, report_date) do update set
    created_by = excluded.created_by,
    lubrifiant_stock = excluded.lubrifiant_stock,
    lubrifiant_vendu = excluded.lubrifiant_vendu,
    note = excluded.note,
    ess_litres = excluded.ess_litres, ess_pu = excluded.ess_pu, ess_bon = excluded.ess_bon, ess_espece = excluded.ess_espece,
    gas_litres = excluded.gas_litres, gas_pu = excluded.gas_pu, gas_bon = excluded.gas_bon, gas_espece = excluded.gas_espece,
    gaz_espece = excluded.gaz_espece, superette_espece = excluded.superette_espece, lubrifiant_espece = excluded.lubrifiant_espece,
    e1 = excluded.e1, e2 = excluded.e2, e3 = excluded.e3, e4 = excluded.e4, e5 = excluded.e5,
    e6 = excluded.e6, e7 = excluded.e7, e8 = excluded.e8, e9 = excluded.e9, e10 = excluded.e10,
    g1 = excluded.g1, g2 = excluded.g2, g3 = excluded.g3, g4 = excluded.g4, g5 = excluded.g5,
    g6 = excluded.g6, g7 = excluded.g7, g8 = excluded.g8, g9 = excluded.g9, g10 = excluded.g10,
    e1_m = excluded.e1_m, e2_m = excluded.e2_m, e3_m = excluded.e3_m, e4_m = excluded.e4_m, e5_m = excluded.e5_m,
    e6_m = excluded.e6_m, e7_m = excluded.e7_m, e8_m = excluded.e8_m, e9_m = excluded.e9_m, e10_m = excluded.e10_m,
    g1_m = excluded.g1_m, g2_m = excluded.g2_m, g3_m = excluded.g3_m, g4_m = excluded.g4_m, g5_m = excluded.g5_m,
    g6_m = excluded.g6_m, g7_m = excluded.g7_m, g8_m = excluded.g8_m, g9_m = excluded.g9_m, g10_m = excluded.g10_m,
    total_bon_cumul = excluded.total_bon_cumul,
    ess_stock = excluded.ess_stock, gas_stock = excluded.gas_stock,
    gaz_stock_3 = excluded.gaz_stock_3, gaz_stock_6 = excluded.gaz_stock_6, gaz_stock_12 = excluded.gaz_stock_12, gaz_stock_38 = excluded.gaz_stock_38,
    gaz_vendu_3 = excluded.gaz_vendu_3, gaz_vendu_6 = excluded.gaz_vendu_6, gaz_vendu_12 = excluded.gaz_vendu_12, gaz_vendu_38 = excluded.gaz_vendu_38,
    ess_stock_matin = case when p_set_matin then excluded.ess_stock_matin else public.daily_reports.ess_stock_matin end,
    gas_stock_matin = case when p_set_matin then excluded.gas_stock_matin else public.daily_reports.gas_stock_matin end;

  insert into public.stock_declarations_snapshot (station_id, categorie, produit, report_date, stock_theorique_a_la_declaration, stock_declare, ecart_initial)
  select p_station_id, 'lubrifiant', x.produit, p_report_date, x.stock_theorique_a_la_declaration, x.stock_declare, x.ecart_initial
  from jsonb_to_recordset(p_snapshot) as x(produit text, stock_theorique_a_la_declaration numeric, stock_declare numeric, ecart_initial numeric)
  on conflict (station_id, categorie, produit, report_date) do update set
    stock_theorique_a_la_declaration = excluded.stock_theorique_a_la_declaration,
    stock_declare = excluded.stock_declare,
    ecart_initial = excluded.ecart_initial;

  delete from public.expenses where report_date = p_report_date and station_id = p_station_id;
  insert into public.expenses (report_date, station_id, categorie, montant, motif, justificatif, photo_path, non_cash, poles, created_by)
  select p_report_date, p_station_id, coalesce(x.categorie, 'AUTRE'), x.montant, x.motif, true, x.photo_path,
    coalesce(x.non_cash, false), coalesce(x.poles, '[]'::jsonb), auth.uid()
  from jsonb_to_recordset(p_expenses) as x(categorie text, montant numeric, motif text, photo_path text, non_cash boolean, poles jsonb);

  delete from public.deliveries where report_date = p_report_date and station_id = p_station_id;
  insert into public.deliveries (report_date, station_id, type, quantite, unite, pu_achat, montant, fournisseur, supplier_id, note, created_by)
  select p_report_date, p_station_id, coalesce(x.type, 'autre'), x.quantite, x.unite, x.pu_achat, x.montant, x.fournisseur, x.supplier_id, x.note, auth.uid()
  from jsonb_to_recordset(p_deliveries) as x(type text, quantite numeric, unite text, pu_achat numeric, montant numeric, fournisseur text, supplier_id bigint, note text);

  delete from public.deposits where report_date = p_report_date and station_id = p_station_id;
  insert into public.deposits (report_date, station_id, pole, montant, periode_debut, periode_fin, deposit_date, photo_path, created_by)
  select p_report_date, p_station_id, coalesce(x.pole, 'carburant'), x.montant, x.periode_debut, x.periode_fin, x.periode_fin, x.photo_path, auth.uid()
  from jsonb_to_recordset(p_deposits) as x(pole text, montant numeric, periode_debut date, periode_fin date, photo_path text);

  delete from public.stock_movements
    where station_id = p_station_id and date_mouvement = p_report_date and source = 'vente' and categorie in ('gaz', 'lubrifiant');

  delete from public.stock_movements
    where station_id = p_station_id and date_mouvement = p_report_date and source = 'vente' and categorie = 'superette';
  if p_superette_cogs is not null and p_superette_cogs <> 0 then
    insert into public.stock_movements (station_id, categorie, type, valeur, source, note, date_mouvement, created_by)
      values (p_station_id, 'superette', 'sortie', p_superette_cogs, 'vente', 'coût de revient', p_report_date, auth.uid());
  end if;

  insert into public.submissions (report_date, station_id, moment, created_by)
    values (p_report_date, p_station_id, p_moment, auth.uid());
end;
$$;

revoke execute on function public.enregistrer_saisie_jour(bigint, date, text, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, numeric) from anon;
