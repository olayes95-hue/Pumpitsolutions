-- ============================================================
--  MIGRATION v108 — Ajustements du catalogue de catégories du relevé
--  bancaire, suite à un test sur un vrai relevé.
--
--  1) "PAIEMENT CHQ" retiré des mots-clés de "Chèque commande" : ce
--     préfixe apparaît aussi bien sur un chèque fournisseur que sur un
--     salaire ou un prélèvement du gérant — impossible de les distinguer
--     par mot-clé seul. "CHEQUE" reste (il suffit pour les vrais
--     chèques fournisseur, ex. "CHEQUE NO ... FAVEUR ...").
--
--  2) Deux nouvelles catégories système, SANS mot-clé automatique
--     (ambiguïté ci-dessus) : "Salaire" et "Prélèvement gérant" — les
--     lignes "PAIEMENT CHQ ... PAR CAISSE ..." correspondantes se
--     classent désormais dans "Autre" par défaut, à reclasser à la main
--     ligne par ligne (menu déroulant Catégorie, écran Rapprochement).
-- ============================================================

begin;

update bank_line_categories
set mots_cles = array_remove(mots_cles, 'PAIEMENT CHQ')
where key = 'cheque_commande';

insert into bank_line_categories (organisation_id, key, label, mots_cles, is_system, ordre)
select o.id, c.key, c.label, c.mots_cles, true, c.ordre
from organisations o
cross join (values
  ('salaire', 'Salaire', array[]::text[], 50),
  ('prelevement_gerant', 'Prélèvement gérant', array[]::text[], 60)
) as c(key, label, mots_cles, ordre)
where not exists (
  select 1 from bank_line_categories bc where bc.organisation_id = o.id and bc.key = c.key
);

commit;
