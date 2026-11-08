// Offres PumpIT et fonctions incluses.
//
// Depuis la v100, la liste des fonctions de chaque offre est réglée dans le back-office
// (table `formules`, colonne `fonctions`) : rien n'est figé ici. Ce fichier ne garde que
//   - la répartition d'origine, utilisée tant que la base n'a pas la v100 ;
//   - la liste des alertes rattachées à la fonction « alertes_completes ».
//
// Ce filtrage est fait dans l'interface (menus, écrans, boutons). La séparation des
// DONNÉES entre clients, elle, est faite par la base.

const ORIGINE = {
  essentiel: [],
  pro: ['alertes_completes', 'prevision'],
  complet: ['alertes_completes', 'prevision', 'finance', 'bordereaux', 'export', 'audit'],
}

// Fonctions de l'offre `cle`. `formules` = lignes de la table (peut être vide).
// Renvoie null quand l'offre est inconnue : tout reste alors ouvert, comme avant.
export function fonctionsDe(formules, cle) {
  const ligne = (formules || []).find(f => f.key === cle)
  if (ligne && Array.isArray(ligne.fonctions)) return ligne.fonctions
  return ORIGINE[cle] || null
}

// Activités de l'offre `cle` (carburant, lubrifiant, gaz, superette).
// Renvoie null quand elles ne sont pas connues : toutes les activités restent alors ouvertes.
export const ACTIVITES = [['carburant', 'Carburant'], ['lubrifiant', 'Lubrifiants'], ['gaz', 'Gaz'], ['superette', 'Supérette']]
export function activitesDe(formules, cle) {
  const ligne = (formules || []).find(f => f.key === cle)
  return ligne && Array.isArray(ligne.activites) ? ligne.activites : null
}

// État de l'essai et de l'accès d'un client. Même règle que organisation_accessible() côté base.
export function etatAbonnement(org, reglages, aujourdhui) {
  if (!org) return { enEssai: false, essaiTermine: false, bloque: false, motif: null, joursRestants: null }
  const essai = org.essai_jusqu_au || null
  const enEssai = !!essai && essai >= aujourdhui
  const regle = !!org.abonnement_jusqu_au && org.abonnement_jusqu_au >= aujourdhui
  const essaiTermine = !!essai && !enEssai && !regle
  const bloqueEssai = essaiTermine && reglages?.suspendre_fin_essai !== false
  const suspendu = org.statut === 'suspendu'
  const joursRestants = enEssai ? Math.round((new Date(essai) - new Date(aujourdhui)) / 86400000) : null
  return { enEssai, essaiTermine, bloque: suspendu || bloqueEssai, motif: suspendu ? 'suspendu' : bloqueEssai ? 'essai' : null, joursRestants }
}

// État de la visite médicale d'un employé (module RH léger, migration_v145). Même logique de
// date que etatAbonnement() : une périodicité en mois, appliquée à la dernière visite faite.
// jamaisFaite = aucune visite_medicale_le renseignée — distinct de enRetard (une visite existe
// mais la prochaine est dépassée), pour ne pas confondre "jamais fait" et "en retard".
export function etatVisiteMedicale(profile, aujourdhui) {
  const le = profile?.visite_medicale_le || null
  const periodicite = profile?.visite_medicale_mois || 12
  if (!le) return { aJour: false, enRetard: false, jamaisFaite: true, prochaineDate: null, joursRetard: null }
  const prochaine = new Date(le); prochaine.setMonth(prochaine.getMonth() + periodicite)
  const prochaineDate = prochaine.toISOString().slice(0, 10)
  const enRetard = prochaineDate < aujourdhui
  const joursRetard = enRetard ? Math.round((new Date(aujourdhui) - prochaine) / 86400000) : null
  return { aJour: !enRetard, enRetard, jamaisFaite: false, prochaineDate, joursRetard }
}

// État du contrat d'un employé : approche d'échéance (CDD/essai/prestataire — un CDI n'a pas
// de contrat_fin et n'est jamais "à échéance"). seuilJours = fenêtre d'alerte avant l'échéance.
export function etatContrat(profile, aujourdhui, seuilJours = 30) {
  const fin = profile?.contrat_fin || null
  if (!fin || profile?.contrat_type === 'cdi') return { echeanceProche: false, expire: false, joursRestants: null }
  const joursRestants = Math.round((new Date(fin) - new Date(aujourdhui)) / 86400000)
  return { echeanceProche: joursRestants >= 0 && joursRestants <= seuilJours, expire: joursRestants < 0, joursRestants }
}

// Alertes rattachées à la fonction « alertes_completes ». Les autres (versement manquant ou
// incomplet, écart de caisse, stock bas, point manquant…) sont dans toutes les offres.
const ALERTES_COMPLETES = new Set([
  'ECART_COMPTEUR', 'ECART_STOCK', 'PERTE_LIVRAISON', 'BONS_INEXPLIQUES',
  'ECART_INVENTAIRE', 'DONNEES_INCOHERENTES', 'DEPENSE_NON_JUSTIFIEE',
])

// `has` = la fonction has() fournie par useAuth().
export function filtrerAlertes(alertes, has) {
  if (has('alertes_completes')) return alertes || []
  return (alertes || []).filter(a => !ALERTES_COMPLETES.has(a.type))
}
