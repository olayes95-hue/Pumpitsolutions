-- Permet a l'admin de corriger une reception de commande saisie par le gerant
-- (quantite recue, cuve avant/apres, date) quand il se trompe. Jusqu'ici
-- order_receptions n'avait NI policy UPDATE (aucune, meme pour l'admin) ni UI
-- d'edition : seule une suppression totale de la commande existait.

create policy p_recept_upd on order_receptions for update
  using (is_admin())
  with check (is_admin());
