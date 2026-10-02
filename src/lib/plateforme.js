import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Réglages de la plateforme PumpIT (émetteur des factures, numéros d'assistance).
// Une seule ligne, lisible par tout compte connecté ; mise en cache pour la session.
let cache = null
export function usePlateforme() {
  const [p, setP] = useState(cache)
  useEffect(() => {
    if (cache) return
    supabase.from('plateforme_reglages').select('*').eq('id', 1).maybeSingle()
      .then(({ data }) => { cache = data || {}; setP(cache) })
  }, [])
  return p || {}
}
export function oublierPlateforme() { cache = null }

export const STATUT_DEMANDE = {
  ouverte: { label: 'Ouverte', tone: 'warn' },
  en_cours: { label: 'En cours', tone: 'info' },
  resolue: { label: 'Résolue', tone: 'ok' },
}

export const STATUT_FACTURE = {
  emise: { label: 'À régler', tone: 'warn' },
  payee: { label: 'Payée', tone: 'ok' },
  annulee: { label: 'Annulée', tone: 'idle' },
}

// Lien WhatsApp : chiffres uniquement, avec l'indicatif du pays.
export const lienWhatsApp = (numero) => 'https://wa.me/' + String(numero || '').replace(/\D/g, '')
export const lienTel = (numero) => 'tel:' + String(numero || '').replace(/[^\d+]/g, '')

export const dateHeure = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
