// Centralise les correspondances "type métier" → ton OCTANE (ok/warn/alarm/info)
// pour les systèmes de couleur historiques de l'app (Phase 3 du plan OCTANE).
// Rempli page par page au fur et à mesure de leur conversion.

export const ALERT_TONES = {
  VERSEMENT_MANQUANT: { label: 'Versement manquant', tone: 'alarm' },
  VERSEMENT_INCOMPLET: { label: 'Versement incomplet', tone: 'alarm' },
  ECART_CAISSE: { label: 'Écart de caisse', tone: 'warn' },
  DEPENSE_NON_JUSTIFIEE: { label: 'Dépense non justifiée', tone: 'warn' },
  ECART_COMPTEUR: { label: 'Écart compteur', tone: 'warn' },
  RELEVE_COMPTEUR_MANQUANT: { label: 'Relevé compteur non mis à jour', tone: 'info' },
  DONNEES_INCOHERENTES: { label: 'Données compteur/cuve à vérifier', tone: 'info' },
  STOCK_BAS: { label: 'Stock bas carburant', tone: 'alarm' },
  STOCK_BAS_GAZ: { label: 'Stock bas gaz', tone: 'warn' },
  STOCK_BAS_LUBRIFIANT: { label: 'Stock bas lubrifiant', tone: 'warn' },
  ECART_STOCK: { label: 'Écart de cuve (coulage ?)', tone: 'alarm' },
  PERTE_LIVRAISON: { label: 'Perte livraison > 5%', tone: 'alarm' },
  BONS_INEXPLIQUES: { label: 'Bons disparus (inexpliqué)', tone: 'alarm' },
  ECART_INVENTAIRE: { label: "Écart d'inventaire", tone: 'alarm' },
  POINT_MANQUANT: { label: 'Point du jour manquant', tone: 'info' },
}

export const STOCK_MOVEMENT_TONES = {
  entree: 'ok',
  sortie: 'alarm',
  ajustement: 'warn',
}

// Vocabulaire métier de `stock_movements.source` (texte libre) → label + ton d'affichage.
// `type` (ci-dessus) reste le seul champ qui pilote le signe +/- ; `source` précise juste
// la raison, choisie par l'utilisateur, jamais un signe.
export const STOCK_SOURCE_TONES = {
  achat: { label: 'Achat / livraison', tone: 'ok' },
  reception: { label: 'Réception commande', tone: 'ok' },
  retour_client: { label: 'Retour client', tone: 'ok' },
  vente: { label: 'Vente', tone: 'idle' },
  casse: { label: 'Casse', tone: 'alarm' },
  perte: { label: 'Perte', tone: 'alarm' },
  consommation_interne: { label: 'Consommation interne', tone: 'warn' },
  retour_fournisseur: { label: 'Retour fournisseur', tone: 'warn' },
  inventaire: { label: 'Correction (inventaire)', tone: 'warn' },
  correction_inventaire: { label: "Correction d'inventaire (motif)", tone: 'alarm' },
}

// Orders.jsx a 6 statuts ; Badge OCTANE expose exactement 6 tons (ok/warn/alarm/info/idle/accent) — mapping direct, un ton par statut.
export const ORDER_STATUS_TONES = {
  proposee: { label: 'Proposée', tone: 'warn' },
  validee: { label: 'Validée', tone: 'info' },
  lancee: { label: 'Lancée', tone: 'accent' },
  partielle: { label: 'Partielle', tone: 'idle' },
  recue: { label: 'Reçue', tone: 'ok' },
  annulee: { label: 'Refusée', tone: 'alarm' },
}
