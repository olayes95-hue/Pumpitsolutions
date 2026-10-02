import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('⚠️ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants. Copie .env.example en .env.')
}

// PAS de `lock` personnalisé ici : ça ferait basculer le SDK sur son ancien chemin de
// verrouillage déprécié (qui enveloppe CHAQUE opération d'auth dans le lock fourni). Testé
// et ça a cassé le chargement en prod (tout restait bloqué indéfiniment) — la version actuelle
// du SDK gère déjà les rafraîchissements sans ce verrou par défaut (chemin "lockless").
export const supabase = createClient(url || 'http://localhost', key || 'anon')
export const BORDEREAUX_BUCKET = 'bordereaux'
