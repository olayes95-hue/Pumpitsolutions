-- ============================================================
--  SEED — Prix et conditionnement catalogue lubrifiant (Phase B).
--
--  Upsert sur (categorie, nom) [contrainte unique déjà en place,
--  migration_v21] : si le produit existe déjà (saisi via Products.jsx
--  ou seedé à l'origine depuis lubrifiant_types), ses prix/seuil/actif
--  restent gérés normalement — cette seed ne fait que rafraîchir
--  prix_achat / prix_vente / unite_stock / conditionnement_nom /
--  conditionnement_qte. Les noms REPRENNENT EXACTEMENT ceux déjà
--  utilisés dans la déclaration quotidienne (Submit.jsx / LUB_TYPES)
--  pour ne rien casser dans l'historique déclaré :
--    'Liquide refroid.' (pas 'Liquide refroid. 5L')
--    'Nettoyant injecteur' (pas 'Nettoyant injecteur 1L')
--  '20W50 1L' n'existait pas encore (seul '20W50 5L' était référencé) :
--  nouveau produit.
--
--  ATTENTION avant d'exécuter : dans le tableau fourni, 3 prix de
--  vente unitaires étaient marqués d'un * car INFÉRIEURS au prix
--  d'achat unitaire (vente à perte à l'unité, et même par carton pour
--  le premier) :
--    - 50 SAE 5L     : PA 19 875 / PV 13 875 (carton PA 79 500 / PV 55 500)
--    - 20W50 5L      : PA 14 868 / PV 14 375 (carton PA 59 472 / PV 57 500)
--    - 15W40 5L      : PA 15 678 / PV 15 600 (carton PA 62 712 / PV 62 400)
--  Les valeurs ci-dessous reprennent tel quel ce qui a été donné —
--  à confirmer avant de pousser en prod (voir message du chat).
--
--  À exécuter dans Supabase > SQL Editor > Run (après v58, pour que
--  les colonnes conditionnement existent). Idempotente (upsert).
-- ============================================================

insert into products (categorie, nom, unite, unite_stock, conditionnement_nom, conditionnement_qte, prix_achat, prix_vente, actif, ordre) values
('lubrifiant', '50 SAE 5L',           'bidon', 'bidon', 'carton', 4,  19875, 13875, true, 10),
('lubrifiant', '20W50 5L',            'bidon', 'bidon', 'carton', 4,  14868, 14375, true, 20),
('lubrifiant', '20W50 1L',            'bidon', 'bidon', 'carton', 12, 3425,  3425,  true, 30),
('lubrifiant', '15W40 5L',            'bidon', 'bidon', 'carton', 4,  15678, 15600, true, 40),
('lubrifiant', 'Dexron 1L',           'bidon', 'bidon', 'carton', 12, 4342,  4350,  true, 50),
('lubrifiant', '80W90 1L',            'bidon', 'bidon', 'carton', 12, 4333,  4350,  true, 60),
('lubrifiant', 'Dot4 1L',             'bidon', 'bidon', 'carton', 12, 5868,  5875,  true, 70),
('lubrifiant', '5W30 1L',             'bidon', 'bidon', 'carton', 12, 5258,  5275,  true, 80),
('lubrifiant', '5W30 5L',             'bidon', 'bidon', 'carton', 4,  20466, 20475, true, 90),
('lubrifiant', '5W40 5L',             'bidon', 'bidon', 'carton', 4,  21928, 21950, true, 100),
('lubrifiant', '10W40 5L',            'bidon', 'bidon', 'carton', 4,  17592, 17600, true, 110),
('lubrifiant', 'Liquide refroid.',    'bidon', 'bidon', 'carton', 4,  8275,  8275,  true, 120),
('lubrifiant', 'Nettoyant injecteur', 'bidon', 'bidon', 'carton', 12, 4333,  4350,  true, 130)
on conflict (categorie, nom) do update set
  unite = excluded.unite,
  unite_stock = excluded.unite_stock,
  conditionnement_nom = excluded.conditionnement_nom,
  conditionnement_qte = excluded.conditionnement_qte,
  prix_achat = excluded.prix_achat,
  prix_vente = excluded.prix_vente;

-- ============================================================
--  2e liste — fûts / graisse en vrac / consommables divers.
--  Ajoutés INACTIFS (actif=false) : ne polluent pas la saisie
--  quotidienne du gérant. Deux d'entre eux ("Graisse Lithium EP-2
--  (180)" et "Graisse Lithium EP2 (1)") sont volontairement distincts
--  du produit générique "Graisse" déjà utilisé dans la déclaration
--  quotidienne — celui-ci n'est PAS touché par cette seed.
--  La contenance est mise entre parenthèses dans le nom pour
--  distinguer les 3 déclinaisons de "Huile moteur SAE 15W40" (205L,
--  20L CI-4/SL, 30L CI-4/SL) qui partageraient sinon le même nom.
--  Active-les toi-même depuis Produits quand tu veux les faire
--  apparaître dans la saisie quotidienne.
-- ============================================================

insert into products (categorie, nom, unite, unite_stock, conditionnement_nom, conditionnement_qte, prix_achat, prix_vente, actif, ordre) values
('lubrifiant', 'Huile moteur SAE 15W40 (205L)',         'fût',   'fût',   null,     null, 503700, 503700, false, 200),
('lubrifiant', 'Huile moteur SAE 15W40 CI-4/SL (20L)',  'bidon', 'bidon', null,     null, 55500,  55500,  false, 210),
('lubrifiant', 'Huile hydraulique HLP ISO 68 (205L)',   'fût',   'fût',   null,     null, 582500, 582500, false, 220),
('lubrifiant', 'Graisse Lithium EP-2 (180)',            'fût',   'fût',   null,     null, 744000, 744000, false, 230),
('lubrifiant', 'Nettoyant moteur / Engine Flush (0,25L)','bidon','bidon', 'carton', 12,   4150,   4150,   false, 240),
('lubrifiant', 'Graisse Lithium EP2 (1)',                'unité','unité', 'carton', 12,   5591,   5600,   false, 250),
('lubrifiant', 'Huile pont SAE 80W90 (205L)',            'fût',  'fût',   null,     null, 641000, 641000, false, 260),
('lubrifiant', 'Huile moteur SAE 5W30 (205L)',           'fût',  'fût',   null,     null, 811400, 811400, false, 270),
('lubrifiant', 'Huile compresseur minéral (205L)',       'fût',  'fût',   null,     null, 493800, 493800, false, 280),
('lubrifiant', 'Huile engrenage industriel (205L)',      'fût',  'fût',   null,     null, 579500, 579500, false, 290),
('lubrifiant', 'Huile de frein DOT-5 (0,5L)',            'bidon','bidon', 'carton', 12,   7362,   7375,   false, 300),
('lubrifiant', 'Huile moteur SAE 15W40 CI-4/SL (30L)',   'bidon','bidon', null,     null, 66500,  66500,  false, 310)
on conflict (categorie, nom) do update set
  unite = excluded.unite,
  unite_stock = excluded.unite_stock,
  conditionnement_nom = excluded.conditionnement_nom,
  conditionnement_qte = excluded.conditionnement_qte,
  prix_achat = excluded.prix_achat,
  prix_vente = excluded.prix_vente;
