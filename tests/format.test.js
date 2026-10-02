import { describe, it, expect } from 'vitest'
import {
  fcfa,
  num,
  today,
  numFR,
  frDate,
  formatThousands,
  lastDayOfMonth,
} from '../src/lib/format.js'

// toLocaleString('fr-FR') utilise un espace insécable (U+00A0/U+202F) comme
// séparateur de milliers selon la version d'ICU. On normalise pour des
// assertions stables quel que soit le runtime.
const norm = (s) => s.replace(/[\u00A0\u202F ]/g, ' ')

describe('fcfa', () => {
  it('retourne le tiret cadratin pour les valeurs vides/invalides', () => {
    expect(fcfa(null)).toBe('—')
    expect(fcfa(undefined)).toBe('—')
    expect(fcfa('')).toBe('—')
    expect(fcfa(NaN)).toBe('—')
    expect(fcfa('abc')).toBe('—')
  })

  it('formate zéro sans le confondre avec une valeur vide', () => {
    expect(fcfa(0)).toBe('0 F')
  })

  it('arrondit à l’entier le plus proche', () => {
    expect(norm(fcfa(1234.6))).toBe('1 235 F')
    expect(norm(fcfa(1234.4))).toBe('1 234 F')
  })

  it('ajoute des séparateurs de milliers et le suffixe F', () => {
    expect(norm(fcfa(1000000))).toBe('1 000 000 F')
    expect(fcfa(500)).toMatch(/ F$/)
  })

  it('accepte les chaînes numériques', () => {
    expect(norm(fcfa('4277213'))).toBe('4 277 213 F')
  })
})

describe('num', () => {
  it('retourne le tiret pour les valeurs vides/invalides', () => {
    expect(num(null)).toBe('—')
    expect(num(undefined)).toBe('—')
    expect(num('')).toBe('—')
    expect(num(NaN)).toBe('—')
  })

  it('formate zéro', () => {
    expect(num(0)).toBe('0')
  })

  it('utilise la virgule décimale française', () => {
    expect(num(10.5)).toBe('10,5')
  })

  it('n’arrondit pas et met des séparateurs de milliers', () => {
    expect(norm(num(1234))).toBe('1 234')
    expect(norm(num(1234.56))).toBe('1 234,56')
  })
})

describe('today', () => {
  it('retourne une date ISO courte YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today()).toBe(new Date().toISOString().slice(0, 10))
  })
})

describe('lastDayOfMonth', () => {
  it('gère les mois à 30 jours (le bug réel : "-31" codé en dur était invalide)', () => {
    expect(lastDayOfMonth('2026-09')).toBe('2026-09-30')
    expect(lastDayOfMonth('2026-04')).toBe('2026-04-30')
    expect(lastDayOfMonth('2026-06')).toBe('2026-06-30')
    expect(lastDayOfMonth('2026-11')).toBe('2026-11-30')
  })

  it('gère les mois à 31 jours', () => {
    expect(lastDayOfMonth('2026-01')).toBe('2026-01-31')
    expect(lastDayOfMonth('2026-12')).toBe('2026-12-31')
  })

  it('gère février bissextile et non bissextile', () => {
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29')   // bissextile
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28')   // non bissextile
    expect(lastDayOfMonth('2000-02')).toBe('2000-02-29')   // divisible par 400 -> bissextile
    expect(lastDayOfMonth('1900-02')).toBe('1900-02-28')   // divisible par 100 mais pas 400 -> non bissextile
  })
})

describe('numFR', () => {
  it('retourne null pour vide/null/undefined', () => {
    expect(numFR('')).toBeNull()
    expect(numFR(null)).toBeNull()
    expect(numFR(undefined)).toBeNull()
  })

  it('traite le point comme séparateur de milliers (ignoré)', () => {
    expect(numFR('527.966')).toBe(527966)
    expect(numFR('4.277.213')).toBe(4277213)
    // conséquence : "10.5" est lu comme 105 (le point n’est PAS une décimale)
    expect(numFR('10.5')).toBe(105)
  })

  it('traite la virgule comme séparateur décimal', () => {
    expect(numFR('10,5')).toBe(10.5)
    expect(numFR('0,25')).toBe(0.25)
  })

  it('ignore les espaces (séparateur de milliers)', () => {
    expect(numFR('1 234')).toBe(1234)
    expect(numFR('1 234,5')).toBe(1234.5)
  })

  it('gère le format français complet milliers + décimale', () => {
    expect(numFR('4.277.213,50')).toBe(4277213.5)
  })

  it('retourne null pour du texte non numérique', () => {
    expect(numFR('abc')).toBeNull()
    expect(numFR('12abc')).toBeNull()
  })

  it('gère zéro et les négatifs', () => {
    expect(numFR('0')).toBe(0)
    expect(numFR('-5')).toBe(-5)
  })

  it('une chaîne composée uniquement d’espaces donne 0', () => {
    // "   " n’est pas === '' donc passe le garde-fou, puis Number('') === 0
    expect(numFR('   ')).toBe(0)
  })

  it('accepte une entrée déjà numérique', () => {
    expect(numFR(42)).toBe(42)
  })
})

describe('frDate', () => {
  it('retourne le tiret pour une entrée vide', () => {
    expect(frDate(null)).toBe('—')
    expect(frDate(undefined)).toBe('—')
    expect(frDate('')).toBe('—')
  })

  it('convertit ISO -> JJ/MM/AAAA', () => {
    expect(frDate('2026-07-13')).toBe('13/07/2026')
    expect(frDate('2026-01-05')).toBe('05/01/2026')
  })
})

describe('formatThousands', () => {
  it('laisse passer les valeurs vides telles quelles', () => {
    expect(formatThousands('')).toBe('')
    expect(formatThousands(null)).toBe(null)
    expect(formatThousands(undefined)).toBe(undefined)
  })

  it('insère des espaces séparateurs de milliers', () => {
    expect(formatThousands('5580591')).toBe('5 580 591')
    expect(formatThousands('1000')).toBe('1 000')
    expect(formatThousands('999')).toBe('999')
  })

  it('conserve la partie décimale après la virgule', () => {
    expect(formatThousands('12345,5')).toBe('12 345,5')
    expect(formatThousands('12,5')).toBe('12,5')
  })

  it('est idempotent (re-formater un résultat déjà formaté ne change rien)', () => {
    expect(formatThousands(formatThousands('5580591'))).toBe('5 580 591')
  })

  it('gère les nombres négatifs', () => {
    expect(formatThousands('-4442194')).toBe('-4 442 194')
  })

  it('ignore les points déjà présents comme séparateur (convention numFR)', () => {
    expect(formatThousands('4.277.213')).toBe('4 277 213')
  })

  it('renvoie la valeur telle quelle si aucun chiffre exploitable', () => {
    expect(formatThousands('-')).toBe('-')
  })
})
