-- ============================================================
--  MIGRATION v126 — Choix du portefeuille (pôle) pour les dépenses + système
--  CALENDAIRE de "manque à verser" pour Journal de bord / Tableau de bord.
--
--  Contexte : toute dépense cash est aujourd'hui supposée sortir de la caisse
--  carburant (câblé en dur depuis la migration v36, v_recette_groupe_jour) —
--  gaz_lub et supérette n'ont jamais aucune dépense déduite. Le gérant choisit
--  désormais explicitement de quel(s) pôle(s) une dépense sort.
--
--  Par ailleurs, Journal.jsx/Dashboard.jsx passent d'un calcul PAR PÉRIODE
--  (bordereau de versement, qui peut repousser une dépense au mois où SON
--  bordereau se clôture) à un calcul CALENDAIRE (recette − dépense − versé du
--  mois civil, pôle par pôle) — demande explicite : voir toutes les charges
--  déclarées un mois donné reflétées ce même mois, même sans bordereau clos.
--
--  ATTENTION — précédent (migration_v124, annulée par v125) : cette tentative
--  avait échoué car elle avait réécrit v_alerts lui-même et ne déduisait aucune
--  dépense. Cette fois-ci, AUCUNE vue existante n'est modifiée : v_alerts,
--  v_verse_recon, v_pole_recon_jour, v_verse_groupe, v_recette_groupe_jour
--  restent À L'IDENTIQUE — Historique.jsx et Alerts.jsx continuent de lire
--  exactement les mêmes vues, donc d'afficher le chiffre par période déjà
--  vérifié. Seuls Journal.jsx et Dashboard.jsx basculent sur les 2 nouvelles
--  vues ci-dessous, suffixées "_calendaire" pour qu'il n'y ait jamais
--  d'ambiguïté sur quel système une requête utilise. Conséquence assumée :
--  Historique/Alertes et Journal/Tableau de bord peuvent désormais afficher
--  des montants différents pour le même mois — volontaire, documenté.
-- ============================================================

-- ── 1. Colonne poles sur expenses ───────────────────────────
-- [{"pole":"carburant","montant":30000}, ...] — mêmes valeurs que
-- deposits.pole (carburant/gaz/lubrifiant/gaz_lubrifiant/superette), même
-- règle de regroupement en pole_groupe que les versements. '[]' (toute ligne
-- antérieure à cette migration) = non taguée : repli géré par la vue
-- v_depense_pole_jour_calendaire (section 3), jamais par un UPDATE en masse —
-- réversible, l'historique n'est jamais touché physiquement.
alter table public.expenses
  add column if not exists poles jsonb not null default '[]'::jsonb;

comment on column public.expenses.poles is
  'Répartition de la dépense cash entre pôles : [{"pole":"carburant","montant":30000}, ...]. '
  'pole ∈ mêmes valeurs que deposits.pole. poles=''[]'' = non tagué (tout l''historique '
  'avant migration v126) : repli dans v_depense_pole_jour_calendaire (SUPERETTE -> superette, '
  'sinon -> carburant), identique au hardcode historique de v_recette_groupe_jour (v36). '
  'Les vues PAR PÉRIODE (v_recette_groupe_jour, v_verse_recon, v_pole_recon_jour, v_alerts) '
  'ne lisent jamais cette colonne et restent inchangées.';

-- ── 2. RPC enregistrer_saisie_jour : accepte le champ poles ──
-- Pas de changement de signature (poles voyage dans p_expenses, déjà jsonb ;
-- la signature des paramètres de la fonction reste identique à migration_v122
-- — p_superette_cogs numeric, pas jsonb — sinon "create or replace" crée une
-- 2e fonction en surcharge au lieu de remplacer l'existante). Corps recopié
-- À L'IDENTIQUE de migration_v122 — seul le bloc "expenses" change (ajout de
-- la colonne poles à l'insert, 2 lignes).
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

  -- Dépenses : delete + insert, AVEC poles (SEUL changement de ce bloc vs v122)
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

-- ── 3. Vues CALENDAIRES (nouvelles, distinctes du système par période) ──

-- Dépense cash par jour et par pole_groupe, répartie selon expenses.poles.
-- Repli pour les lignes sans tag (poles='[]') : categorie='SUPERETTE' ->
-- superette, sinon -> carburant — identique au hardcode actuel de
-- v_recette_groupe_jour (migration_v36), pour que les mois passés ne changent
-- pas de valeur tant qu'aucune dépense n'est explicitement taguée.
create or replace view v_depense_pole_jour_calendaire as
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
group by 1, 2, 3;

grant select on v_depense_pole_jour_calendaire to authenticated, anon;

-- Vue mensuelle calendaire par pôle : recette (v_recette_groupe_jour,
-- INCHANGÉE), dépense (vue ci-dessus, tag-aware), versé (deposits, attribué
-- au mois réel du versement — même chaîne de repli que v_ventes_mensuelles et
-- v_report_metrics : coalesce(periode_fin, deposit_date, report_date)).
-- solde = recette - dépense - versé, peut être négatif un mois donné sans
-- que ce soit un bug (cash payé ce mois-ci depuis une caisse accumulée un
-- mois précédent) — voir le commentaire en tête de fichier.
create or replace view v_pole_mois_calendaire as
select r.station_id, r.mois, r.pole_groupe,
  r.recette,
  coalesce(d.depense, 0) as depense,
  coalesce(v.verse, 0) as verse,
  r.recette - coalesce(d.depense, 0) - coalesce(v.verse, 0) as solde
from (
  select station_id, to_char(report_date, 'YYYY-MM') as mois, pole_groupe, sum(espece) as recette
  from public.v_recette_groupe_jour
  group by 1, 2, 3
) r
left join (
  select station_id, to_char(report_date, 'YYYY-MM') as mois, pole_groupe, sum(depense) as depense
  from v_depense_pole_jour_calendaire
  group by 1, 2, 3
) d on d.station_id = r.station_id and d.mois = r.mois and d.pole_groupe = r.pole_groupe
left join (
  select station_id,
    to_char(coalesce(periode_fin, deposit_date, report_date), 'YYYY-MM') as mois,
    case when pole = 'carburant' then 'carburant'
         when pole in ('gaz', 'lubrifiant', 'gaz_lubrifiant') then 'gaz_lub'
         else 'superette' end as pole_groupe,
    sum(montant) as verse
  from public.deposits
  group by 1, 2, 3
) v on v.station_id = r.station_id and v.mois = r.mois and v.pole_groupe = r.pole_groupe;

grant select on v_pole_mois_calendaire to authenticated, anon;
