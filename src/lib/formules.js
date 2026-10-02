// Formules d'abonnement PumpIT (docs/PLAN_COMMERCIAL.md, §5).
// Chaque formule contient la précédente. Les prix sont dans la table `formules`.
//
//   Essentiel : saisie quotidienne, stock et autonomie, commandes et réceptions,
//               alertes de caisse et de versement, historique.
//   Pro       : + alertes anti-fraude complètes (coulage, écart compteur…),
//               + prévision de commande.
//   Complet   : + point financier et rapprochement bancaire, vérification des
//               bordereaux, export et journal d'audit.
//
// Ce filtrage est fait dans l'interface (menus, écrans, boutons). La séparation des
// DONNÉES entre clients, elle, est faite par la base.

export const FORMULES = ['essentiel', 'pro', 'complet']
const RANG = { essentiel: 1, pro: 2, complet: 3 }

// Fonction -> formule minimale.
export const FONCTIONS = {
  alertes_completes: 'pro',
  prevision: 'pro',
  finance: 'complet',
  bordereaux: 'complet',
  export: 'complet',
  audit: 'complet',
}

export const LIBELLE_FONCTION = {
  alertes_completes: 'Alertes anti-fraude complètes',
  prevision: 'Prévision de commande',
  finance: 'Point financier et rapprochement bancaire',
  bordereaux: 'Vérification des bordereaux',
  export: 'Export des données',
  audit: "Journal d'audit",
}

// Formule inconnue (base pas encore migrée) : tout reste ouvert, comme avant.
export function inclut(formule, fonction) {
  const mini = FONCTIONS[fonction]
  if (!mini || !RANG[formule]) return true
  return RANG[formule] >= RANG[mini]
}

// Alertes réservées à la formule Pro et au-delà. Les autres (versement manquant ou
// incomplet, écart de caisse, stock bas, point manquant…) sont dans toutes les formules.
const ALERTES_PRO = new Set([
  'ECART_COMPTEUR', 'ECART_STOCK', 'PERTE_LIVRAISON', 'BONS_INEXPLIQUES',
  'ECART_INVENTAIRE', 'DONNEES_INCOHERENTES', 'DEPENSE_NON_JUSTIFIEE',
])

export function filtrerAlertes(alertes, formule) {
  if (inclut(formule, 'alertes_completes')) return alertes || []
  return (alertes || []).filter(a => !ALERTES_PRO.has(a.type))
}
