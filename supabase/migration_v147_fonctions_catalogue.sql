-- ============================================================
--  MIGRATION v147 — Les chantiers livrés cette session (écart de jauge,
--  clients à crédit, RH léger) rejoignent le catalogue de fonctions
--  activables par offre (fonctions_catalogue / back-office > Offres),
--  au lieu d'être ouverts à tout le monde par défaut. gaz_promo est ajouté
--  en même temps (dépôt-vente gaz, voir migration_v148).
--
--  Comportement : une fois ces lignes insérées, has('ecart_jauge') etc.
--  renverra FALSE pour toute offre qui n'a pas explicitement la fonction
--  cochée (fonctionsDe() ne retombe sur "tout ouvert" que si l'offre est
--  inconnue ou fonctions=null) — ces fonctions deviennent donc invisibles
--  tant qu'un admin plateforme ne les active pas dans Offres. C'est le but
--  demandé : contrôle explicite par option, pas un défaut ouvert.
--
--  À exécuter dans Supabase > SQL Editor > Run (après v146).
-- ============================================================

begin;

insert into public.fonctions_catalogue (key, label, description, ordre) values
  ('ecart_jauge', 'Écart de jauge', 'Écart cuve déclarée / stock théorique, cumulé par mois, en KPI permanent sur le Tableau de bord.', 7),
  ('clients_credit', 'Clients à crédit', 'Dépense non-cash attribuable à un client/société à recouvrer, avec solde dû et remboursements.', 8),
  ('rh_leger', 'Module RH léger', 'Contrat, CNSS, assurance maladie et visite médicale par employé, avec alertes de retard.', 9),
  ('gaz_promo', 'Gaz en dépôt-vente (promo)', 'Bouteilles reçues sans commande à prix promotionnel, stock suivi séparément du gaz normal.', 10)
on conflict (key) do nothing;

commit;
