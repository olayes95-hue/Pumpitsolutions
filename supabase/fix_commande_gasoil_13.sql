-- ============================================================
--  CORRECTIF PONCTUEL — commande gasoil #13 (6000 L commandés).
--  La quantité déclarée à la réception (6000 L) était en fait la
--  commande ENTIÈRE, pas ce qui a réellement été livré. La cuve
--  (cuve_après − cuve_avant) montre 4000 L reçus → il reste 2000 L
--  à recevoir sur cette commande. Ce n'est PAS une perte.
--
--  Ce script :
--   1. Corrige la réception existante : quantite_recue 6000 → 4000.
--   2. Repasse la commande en statut « partielle » (reste 2000 L à
--      recevoir) et corrige son montant sur la base des 4000 L réels.
--
--  VÉRIFIE avant d'exécuter que c'est toujours l'ID 13 et que
--  4000 L / 2000 L restent les bons chiffres (si une nouvelle
--  réception a eu lieu entre-temps, ne lance pas ce script tel quel).
-- ============================================================

update order_receptions
set quantite_recue = 4000
where order_id = 13;

update fuel_orders
set statut = 'partielle',
    montant = 4000 * coalesce(prix_achat, 0)
where id = 13;

-- Vérification après exécution : doit montrer quantite_recue_total=4000,
-- reste=2000, complet=false.
-- select * from v_order_reception where order_id = 13;
