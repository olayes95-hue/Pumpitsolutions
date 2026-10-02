import { supabase } from '../lib/supabase'
import { today } from '../lib/format'

// État affiché d'un client : la suspension prime, puis le retard de paiement.
export function etatClient(o) {
  if (o.statut === 'suspendu') return { label: 'Suspendu', tone: 'alarm', rang: 'alarm' }
  if (o.abonnement_jusqu_au && o.abonnement_jusqu_au < today()) return { label: 'En retard', tone: 'warn', rang: 'warn' }
  return { label: 'Actif', tone: 'ok', rang: null }
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
