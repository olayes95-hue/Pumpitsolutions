import { supabase } from '../lib/supabase'
import { today } from '../lib/format'
import { etatAbonnement } from '../lib/formules'

// État affiché d'un client, du plus grave au plus bénin : suspendu, essai terminé,
// en retard de paiement, en essai, actif. `rang` colore la ligne du tableau.
export function etatClient(o, reglages) {
  const a = etatAbonnement(o, reglages, today())
  if (a.motif === 'suspendu') return { label: 'Suspendu', tone: 'alarm', rang: 'alarm', cle: 'suspendu' }
  if (a.essaiTermine) return { label: a.bloque ? 'Essai terminé' : 'Essai terminé (accès maintenu)', tone: 'alarm', rang: 'alarm', cle: 'essai_termine' }
  if (a.enEssai) return { label: `Essai (${a.joursRestants} j)`, tone: 'info', rang: null, cle: 'essai' }
  if (o.abonnement_jusqu_au && o.abonnement_jusqu_au < today()) return { label: 'En retard', tone: 'warn', rang: 'warn', cle: 'retard' }
  return { label: 'Actif', tone: 'ok', rang: null, cle: 'actif' }
}

// « Ouvrir » un client : l'administrateur de la plateforme passe dans cette organisation,
// puis l'application est rechargée entièrement pour ne garder aucune donnée du client précédent.
export async function ouvrirClient(id) {
  const { error } = await supabase.rpc('switch_organisation', { p_org: id })
  if (error) throw error
  window.location.assign('/')
}

export const il_y_a = (iso) => {
  if (!iso) return 'Jamais'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return "À l'instant"
  if (min < 60) return `Il y a ${min} min`
  if (min < 1440) return `Il y a ${Math.round(min / 60)} h`
  return `Il y a ${Math.round(min / 1440)} j`
}

// Mois « AAAA-MM » d'une date ISO, et libellé court (« oct. 26 »).
export const moisDe = (iso) => String(iso || '').slice(0, 7)
export const libelleMois = (aaaamm) => {
  const [a, m] = aaaamm.split('-').map(Number)
  return new Date(a, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short' }) + ' ' + String(a).slice(2)
}
// Les n derniers mois, du plus ancien au plus récent.
export function derniersMois(n) {
  const d = new Date(); const out = []
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')) }
  return out
}
