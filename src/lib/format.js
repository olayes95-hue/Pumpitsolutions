export const fcfa = (n) =>
  (n === null || n === undefined || n === '' || isNaN(n))
    ? '—'
    : Math.round(Number(n)).toLocaleString('fr-FR') + ' F'

export const num = (n) =>
  (n === null || n === undefined || n === '' || isNaN(n))
    ? '—'
    : Number(n).toLocaleString('fr-FR')

export const today = () => new Date().toISOString().slice(0, 10)

// Dernier jour d'un mois "YYYY-MM" (ex. lastDayOfMonth('2026-09') -> '2026-09-30') — en arithmétique
// pure, sans passer par un objet Date (un aller-retour par Date().toISOString() peut décaler le
// résultat d'un jour selon le fuseau horaire du navigateur). Un mois filtré avec un simple
// `yyyy-mm-31` codé en dur (bug réel repéré, plusieurs pages) est une date INVALIDE pour tout mois
// à moins de 31 jours (avril, juin, septembre, novembre, et février) — Postgres la rejette, la
// requête échoue silencieusement (data devient null, jamais vérifié), et l'écran affiche 0.
export function lastDayOfMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number)
  const days = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return `${yyyyMm}-${String(days[m - 1]).padStart(2, '0')}`
}

// Normalise un nombre saisi "à la française" : le point = séparateur de milliers (ignoré),
// l'espace = séparateur de milliers (ignoré), la virgule = décimale.
// Ex : "527.966" -> 527966 · "4.277.213" -> 4277213 · "10,5" -> 10.5
export const numFR = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'))
  return isNaN(n) ? null : n
}

export const frDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Reformate un nombre saisi "à la française" en insérant des espaces séparateurs de
// milliers, pour la lisibilité — pas pour le calcul (numFR reste la fonction qui compte).
// Ex : "5580591" -> "5 580 591" · "12,5" -> "12,5" · idempotent (re-formater ne change rien).
export const formatThousands = (v) => {
  if (v === '' || v === null || v === undefined) return v
  const s = String(v).replace(/\s/g, '')
  const neg = s.startsWith('-') ? '-' : ''
  const body = neg ? s.slice(1) : s
  const parts = body.replace(/\./g, '').split(',')
  const intDigits = (parts[0] || '').replace(/\D/g, '')
  if (!intDigits) return v
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return neg + grouped + (parts.length > 1 ? ',' + parts.slice(1).join('') : '')
}

