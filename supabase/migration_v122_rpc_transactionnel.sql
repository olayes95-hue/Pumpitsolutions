-- ============================================================
--  MIGRATION v122 — Opérations critiques stock/finance rendues transactionnelles.
--
--  Checklist Go-Live, item A9/A10 et action prioritaire #6 : jusqu'ici, la réception de
--  commande, la saisie quotidienne du gérant et la saisie vendeuse écrivaient dans plusieurs
--  tables via des appels PostgREST séparés depuis le navigateur (pas de transaction) — un
--  timeout, une coupure réseau ou un échec RLS silencieux entre deux de ces appels pouvait
--  laisser une incohérence (ex. argent/réception enregistrés, stock jamais mis à jour). Le
--  commentaire déjà présent dans orderReception.js (ligne ~127) documente un cas réel observé
--  en production exactement de cette nature.
--
--  Les 3 fonctions ci-dessous regroupent chaque séquence d'écritures dans UNE SEULE fonction
--  Postgres = UNE SEULE transaction : soit tout est écrit, soit rien ne l'est.
--
--  Choix délibéré : SECURITY INVOKER (comportement par défaut, pas "security definer"). La
--  fonction s'exécute avec les droits de l'appelant — exactement les mêmes policies RLS
--  qu'aujourd'hui s'appliquent à chaque écriture, sans aucune logique d'autorisation à
--  dupliquer ici (donc aucun risque d'un nouveau trou d'autorisation introduit par cette
--  migration). Seul bénéfice recherché : l'atomicité de la séquence, pas un contournement RLS.
--
--  Toute la VALIDATION MÉTIER (avertissements d'écart cuve, doublons de versement, champs
--  obligatoires, photos requises...) reste côté application — c'est de la logique d'interface
--  (messages à l'utilisateur, désignation du champ en cause pour faire défiler l'écran), pas
--  de l'intégrité transactionnelle, et la dupliquer ici serait un risque de divergence sans
--  bénéfice. Ces fonctions reçoivent des valeurs déjà validées et ne font qu'écrire.
--
--  IMPORTANT : le code frontend (src/lib/orderReception.js, src/pages/Submit.jsx) doit être
--  mis à jour pour appeler supabase.rpc(...) à la place des séquences actuelles de
--  supabase.from(...).insert/update/delete — voir le commit associé à cette migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Recalcul du stock cuve (helper, même logique que recomputeDailyStock côté JS) :
--    MAX de toutes les "cuve après" du jour pour ce produit, jamais un simple écrasement —
--    insensible à l'ordre de saisie de plusieurs livraisons le même jour, et ne fait jamais
--    baisser une valeur déjà enregistrée plus haute.
-- ------------------------------------------------------------
create or replace function public.recompute_daily_stock(p_station_id bigint, p_produit text, p_report_date date)
returns void language plpgsql set search_path = public as $$
declare v_champ text; v_max numeric; v_actuel numeric;
begin
  v_champ := case when p_produit = 'gasoil' then 'gas_stock' else 'ess_stock' end;
  select max(r.cuve_apres) into v_max
    from order_receptions r
    join fuel_orders o on o.id = r.order_id
    where r.station_id = p_station_id and r.report_date = p_report_date
      and o.station_id = p_station_id and o.produit = p_produit and r.cuve_apres is not null;
  if v_max is null then return; end if;

  if v_champ = 'gas_stock' then
    select gas_stock into v_actuel from public.daily_reports where station_id = p_station_id and report_date = p_report_date;
    if v_actuel is not null and v_actuel >= v_max then return; end if;
    insert into public.daily_reports (station_id, report_date, gas_stock) values (p_station_id, p_report_date, v_max)
      on conflict (station_id, report_date) do update set gas_stock = greatest(coalesce(public.daily_reports.gas_stock, v_max), v_max);
  else
    select ess_stock into v_actuel from public.daily_reports where station_id = p_station_id and report_date = p_report_date;
    if v_actuel is not null and v_actuel >= v_max then return; end if;
    insert into public.daily_reports (station_id, report_date, ess_stock) values (p_station_id, p_report_date, v_max)
      on conflict (station_id, report_date) do update set ess_stock = greatest(coalesce(public.daily_reports.ess_stock, v_max), v_max);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 2. Réception d'une commande (carburant ou gaz/lubrifiant/supérette) — remplace la séquence
--    de src/lib/orderReception.js receptionner() (order_receptions → fuel_orders →
--    recompute_daily_stock → stock_movements → attachments).
-- ------------------------------------------------------------
create or replace function public.receptionner_commande(
  p_order_id bigint, p_station_id bigint, p_report_date date, p_categorie text, p_produit text,
  p_quantite_recue numeric, p_cuve_avant numeric, p_cuve_apres numeric, p_order_cuve_avant numeric,
  p_prix_achat numeric, p_total numeric, p_complet boolean, p_photo_path text, p_quantite_commandee numeric,
  p_qte_saisie numeric default null, p_unite_saisie text default null, p_facteur_conversion numeric default null,
  p_detail_saisie text default null, p_montant_paiement numeric default null
) returns void language plpgsql set search_path = public as $$
declare v_statut text;
begin
  v_statut := case when p_complet then 'recue' else 'partielle' end;

  if p_categorie = 'carburant' then
    insert into public.order_receptions (order_id, station_id, report_date, quantite_recue, cuve_avant, cuve_apres, prix_achat, montant, photo_path, created_by)
      values (p_order_id, p_station_id, p_report_date, p_quantite_recue, p_cuve_avant, p_cuve_apres, p_prix_achat, p_quantite_recue * p_prix_achat, p_photo_path, auth.uid());
    update public.fuel_orders set
      statut = v_statut,
      cuve_avant = coalesce(p_order_cuve_avant, p_cuve_avant),
      cuve_apres = p_cuve_apres, report_date = p_report_date, prix_achat = p_prix_achat,
      montant = p_total * p_prix_achat, recu_by = auth.uid(), recu_at = now()
      where id = p_order_id;
    perform public.recompute_daily_stock(p_station_id, p_produit, p_report_date);
  else
    insert into public.order_receptions (order_id, station_id, report_date, quantite_recue, photo_path, created_by)
      values (p_order_id, p_station_id, p_report_date, p_quantite_recue, p_photo_path, auth.uid());
    update public.fuel_orders set statut = v_statut, report_date = p_report_date, recu_by = auth.uid(), recu_at = now()
      where id = p_order_id;
    insert into public.stock_movements (station_id, categorie, type, source, ref, date_mouvement, created_by, produit, quantite, qte_saisie, unite_saisie, facteur_conversion, detail_saisie, valeur)
      values (p_station_id, p_categorie, 'entree', 'reception', 'CMD#' || p_order_id, p_report_date, auth.uid(),
        case when p_categorie <> 'superette' then p_produit end,
        case when p_categorie <> 'superette' then p_quantite_recue end,
        p_qte_saisie, p_unite_saisie, p_facteur_conversion, p_detail_saisie,
        case when p_categorie = 'superette' then p_montant_paiement end);
  end if;

  if p_photo_path is not null then
    insert into public.attachments (station_id, report_date, categorie, note, photo_path, created_by)
      values (p_station_id, p_report_date, 'reception',
        coalesce(p_produit, p_categorie) || ' — reçu ' || p_quantite_recue || ' / ' || coalesce(p_quantite_commandee, 0),
        p_photo_path, auth.uid());
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3. Saisie quotidienne du gérant — remplace la séquence de src/pages/Submit.jsx save()
--    (daily_reports → stock_declarations_snapshot → expenses → deliveries → deposits →
--    nettoyage + sortie coût de revient supérette dans stock_movements → submissions).
--    NE COUVRE PAS l'envoi des photos-preuves (newPhotos) : Storage n'est pas transactionnel
--    avec SQL, ça reste un appel séparé côté client, APRÈS cet appel RPC (si cette étape
--    échoue, la saisie financière est déjà enregistrée en sécurité — comportement voulu,
--    cohérent avec "les photos sont recommandées mais jamais bloquantes" déjà en vigueur).
--
--    p_payload : objet JSON avec les mêmes clés que NUMFIELDS côté JS (Submit.jsx) +
--    lubrifiant_stock, lubrifiant_vendu, note. p_set_matin : vrai seulement quand
--    moment==='matin'||showAll (ess_stock_matin/gas_stock_matin ne sont alors touchés QUE
--    dans ce cas, exactement comme le upsert partiel actuel via PostgREST qui n'envoyait ces
--    deux colonnes que dans ce même cas — sinon elles restent inchangées).
-- ------------------------------------------------------------
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
    station_id,
    report_date,
    created_by,
    lubrifiant_stock,
    lubrifiant_vendu,
    note,
    ess_litres,
    ess_pu,
    ess_bon,
    ess_espece,
    gas_litres,
    gas_pu,
    gas_bon,
    gas_espece,
    gaz_espece,
    superette_espece,
    lubrifiant_espece,
    e1, e2, e3, e4, e5, e6, e7, e8, e9, e10,
    g1, g2, g3, g4, g5, g6, g7, g8, g9, g10,
    e1_m, e2_m, e3_m, e4_m, e5_m, e6_m, e7_m, e8_m, e9_m, e10_m,
    g1_m, g2_m, g3_m, g4_m, g5_m, g6_m, g7_m, g8_m, g9_m, g10_m,
    total_bon_cumul,
    ess_stock,
    gas_stock,
    gaz_stock_3,
    gaz_stock_6,
    gaz_stock_12,
    gaz_stock_38,
    gaz_vendu_3,
    gaz_vendu_6,
    gaz_vendu_12,
    gaz_vendu_38,
    ess_stock_matin,
    gas_stock_matin
  ) values (
    v_row.station_id,
    v_row.report_date,
    v_row.created_by,
    v_row.lubrifiant_stock,
    v_row.lubrifiant_vendu,
    v_row.note,
    v_row.ess_litres,
    v_row.ess_pu,
    v_row.ess_bon,
    v_row.ess_espece,
    v_row.gas_litres,
    v_row.gas_pu,
    v_row.gas_bon,
    v_row.gas_espece,
    v_row.gaz_espece,
    v_row.superette_espece,
    v_row.lubrifiant_espece,
    v_row.e1, v_row.e2, v_row.e3, v_row.e4, v_row.e5, v_row.e6, v_row.e7, v_row.e8, v_row.e9, v_row.e10,
    v_row.g1, v_row.g2, v_row.g3, v_row.g4, v_row.g5, v_row.g6, v_row.g7, v_row.g8, v_row.g9, v_row.g10,
    v_row.e1_m, v_row.e2_m, v_row.e3_m, v_row.e4_m, v_row.e5_m, v_row.e6_m, v_row.e7_m, v_row.e8_m, v_row.e9_m, v_row.e10_m,
    v_row.g1_m, v_row.g2_m, v_row.g3_m, v_row.g4_m, v_row.g5_m, v_row.g6_m, v_row.g7_m, v_row.g8_m, v_row.g9_m, v_row.g10_m,
    v_row.total_bon_cumul,
    v_row.ess_stock,
    v_row.gas_stock,
    v_row.gaz_stock_3,
    v_row.gaz_stock_6,
    v_row.gaz_stock_12,
    v_row.gaz_stock_38,
    v_row.gaz_vendu_3,
    v_row.gaz_vendu_6,
    v_row.gaz_vendu_12,
    v_row.gaz_vendu_38,
    v_row.ess_stock_matin,
    v_row.gas_stock_matin
  )
  on conflict (station_id, report_date) do update set
    created_by = excluded.created_by,
    lubrifiant_stock = excluded.lubrifiant_stock,
    lubrifiant_vendu = excluded.lubrifiant_vendu,
    note = excluded.note,
    ess_litres = excluded.ess_litres,
    ess_pu = excluded.ess_pu,
    ess_bon = excluded.ess_bon,
    ess_espece = excluded.ess_espece,
    gas_litres = excluded.gas_litres,
    gas_pu = excluded.gas_pu,
    gas_bon = excluded.gas_bon,
    gas_espece = excluded.gas_espece,
    gaz_espece = excluded.gaz_espece,
    superette_espece = excluded.superette_espece,
    lubrifiant_espece = excluded.lubrifiant_espece,
    e1 = excluded.e1, e2 = excluded.e2, e3 = excluded.e3, e4 = excluded.e4, e5 = excluded.e5,
    e6 = excluded.e6, e7 = excluded.e7, e8 = excluded.e8, e9 = excluded.e9, e10 = excluded.e10,
    g1 = excluded.g1, g2 = excluded.g2, g3 = excluded.g3, g4 = excluded.g4, g5 = excluded.g5,
    g6 = excluded.g6, g7 = excluded.g7, g8 = excluded.g8, g9 = excluded.g9, g10 = excluded.g10,
    e1_m = excluded.e1_m, e2_m = excluded.e2_m, e3_m = excluded.e3_m, e4_m = excluded.e4_m, e5_m = excluded.e5_m,
    e6_m = excluded.e6_m, e7_m = excluded.e7_m, e8_m = excluded.e8_m, e9_m = excluded.e9_m, e10_m = excluded.e10_m,
    g1_m = excluded.g1_m, g2_m = excluded.g2_m, g3_m = excluded.g3_m, g4_m = excluded.g4_m, g5_m = excluded.g5_m,
    g6_m = excluded.g6_m, g7_m = excluded.g7_m, g8_m = excluded.g8_m, g9_m = excluded.g9_m, g10_m = excluded.g10_m,
    total_bon_cumul = excluded.total_bon_cumul,
    ess_stock = excluded.ess_stock,
    gas_stock = excluded.gas_stock,
    gaz_stock_3 = excluded.gaz_stock_3,
    gaz_stock_6 = excluded.gaz_stock_6,
    gaz_stock_12 = excluded.gaz_stock_12,
    gaz_stock_38 = excluded.gaz_stock_38,
    gaz_vendu_3 = excluded.gaz_vendu_3,
    gaz_vendu_6 = excluded.gaz_vendu_6,
    gaz_vendu_12 = excluded.gaz_vendu_12,
    gaz_vendu_38 = excluded.gaz_vendu_38,
    ess_stock_matin = case when p_set_matin then excluded.ess_stock_matin else public.daily_reports.ess_stock_matin end,
    gas_stock_matin = case when p_set_matin then excluded.gas_stock_matin else public.daily_reports.gas_stock_matin end;

  -- Fige théorique + écart lubrifiant au moment de la déclaration (uniquement matin/showAll,
  -- comme côté JS — p_snapshot est '[]' sinon et cette étape est un no-op naturel).
  insert into public.stock_declarations_snapshot (station_id, categorie, produit, report_date, stock_theorique_a_la_declaration, stock_declare, ecart_initial)
  select p_station_id, 'lubrifiant', x.produit, p_report_date, x.stock_theorique_a_la_declaration, x.stock_declare, x.ecart_initial
  from jsonb_to_recordset(p_snapshot) as x(produit text, stock_theorique_a_la_declaration numeric, stock_declare numeric, ecart_initial numeric)
  on conflict (station_id, categorie, produit, report_date) do update set
    stock_theorique_a_la_declaration = excluded.stock_theorique_a_la_declaration,
    stock_declare = excluded.stock_declare,
    ecart_initial = excluded.ecart_initial;

  delete from public.expenses where report_date = p_report_date and station_id = p_station_id;
  insert into public.expenses (report_date, station_id, categorie, montant, motif, justificatif, photo_path, non_cash, created_by)
  select p_report_date, p_station_id, coalesce(x.categorie, 'AUTRE'), x.montant, x.motif, true, x.photo_path, coalesce(x.non_cash, false), auth.uid()
  from jsonb_to_recordset(p_expenses) as x(categorie text, montant numeric, motif text, photo_path text, non_cash boolean);

  delete from public.deliveries where report_date = p_report_date and station_id = p_station_id;
  insert into public.deliveries (report_date, station_id, type, quantite, unite, pu_achat, montant, fournisseur, supplier_id, note, created_by)
  select p_report_date, p_station_id, coalesce(x.type, 'autre'), x.quantite, x.unite, x.pu_achat, x.montant, x.fournisseur, x.supplier_id, x.note, auth.uid()
  from jsonb_to_recordset(p_deliveries) as x(type text, quantite numeric, unite text, pu_achat numeric, montant numeric, fournisseur text, supplier_id bigint, note text);

  delete from public.deposits where report_date = p_report_date and station_id = p_station_id;
  insert into public.deposits (report_date, station_id, pole, montant, periode_debut, periode_fin, deposit_date, photo_path, created_by)
  select p_report_date, p_station_id, coalesce(x.pole, 'carburant'), x.montant, x.periode_debut, x.periode_fin, x.periode_fin, x.photo_path, auth.uid()
  from jsonb_to_recordset(p_deposits) as x(pole text, montant numeric, periode_debut date, periode_fin date, photo_path text);

  -- Plus de sortie automatique gaz/lubrifiant (stock déclaré, sortie déduite par
  -- v_sorties_deduites) — nettoie d'éventuelles anciennes sorties auto (doublons).
  delete from public.stock_movements
    where station_id = p_station_id and date_mouvement = p_report_date and source = 'vente' and categorie in ('gaz', 'lubrifiant');

  -- Supérette suivie en valeur (coût de revient) tant que la commission réelle par article
  -- n'est pas activée (voir migration_v119) — remplacée à chaque enregistrement.
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

-- ------------------------------------------------------------
-- 4. Saisie vendeuse du jour (vendu/reçu/périmé) — remplace la séquence de
--    src/pages/Submit.jsx saveVendeuse() (daily_reports → superette_sales → stock_movements
--    → submissions).
-- ------------------------------------------------------------
create or replace function public.enregistrer_vente_superette_jour(
  p_station_id bigint, p_report_date date, p_superette_espece numeric,
  p_sales jsonb default '[]'::jsonb, p_mouvements jsonb default '[]'::jsonb, p_ref text default null
) returns void language plpgsql set search_path = public as $$
begin
  insert into public.daily_reports (station_id, report_date, superette_espece, created_by)
    values (p_station_id, p_report_date, p_superette_espece, auth.uid())
    on conflict (station_id, report_date) do update set
      superette_espece = excluded.superette_espece, created_by = excluded.created_by;

  delete from public.superette_sales where station_id = p_station_id and report_date = p_report_date;
  insert into public.superette_sales (station_id, report_date, product_id, nom, quantite, prix_vente, montant, created_by)
  select p_station_id, p_report_date, (x.product_id)::bigint, x.nom, x.quantite, x.prix_vente, x.montant, auth.uid()
  from jsonb_to_recordset(p_sales) as x(product_id bigint, nom text, quantite numeric, prix_vente numeric, montant numeric);

  delete from public.stock_movements where station_id = p_station_id and categorie = 'superette' and ref = p_ref;
  insert into public.stock_movements (station_id, categorie, type, source, produit, quantite, note, ref, date_mouvement, created_by)
  select p_station_id, 'superette', x.type, x.source, x.produit, x.quantite, x.note, p_ref, p_report_date, auth.uid()
  from jsonb_to_recordset(p_mouvements) as x(type text, source text, produit text, quantite numeric, note text);

  insert into public.submissions (report_date, station_id, moment, created_by)
    values (p_report_date, p_station_id, 'superette', auth.uid());
end;
$$;

revoke execute on function public.recompute_daily_stock(bigint, text, date) from anon;
revoke execute on function public.receptionner_commande(bigint, bigint, date, text, text, numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, numeric, numeric, text, numeric, text, numeric) from anon;
revoke execute on function public.enregistrer_saisie_jour(bigint, date, text, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, numeric) from anon;
revoke execute on function public.enregistrer_vente_superette_jour(bigint, date, numeric, jsonb, jsonb, text) from anon;
