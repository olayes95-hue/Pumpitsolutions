import { describe, it, expect } from 'vitest'
import { ALERT_TONES, STOCK_MOVEMENT_TONES, ORDER_STATUS_TONES } from '../src/lib/tones.js'

const VALID_TONES = ['ok', 'warn', 'alarm', 'info']
const VALID_BADGE_TONES = ['ok', 'warn', 'alarm', 'info', 'idle', 'accent']

describe('ALERT_TONES', () => {
  it('expose exactement les 15 types d’alerte connus', () => {
    expect(Object.keys(ALERT_TONES)).toHaveLength(15)
  })

  it('inclut les types compteur/cuve ajoutés (v35, v37)', () => {
    expect(ALERT_TONES.RELEVE_COMPTEUR_MANQUANT).toBeDefined()
    expect(ALERT_TONES.RELEVE_COMPTEUR_MANQUANT.label).toMatch(/compteur/i)
    expect(ALERT_TONES.DONNEES_INCOHERENTES).toBeDefined()
    expect(ALERT_TONES.DONNEES_INCOHERENTES.label).toMatch(/vérifier/i)
  })

  it('associe libellé et ton OCTANE valide à chaque type', () => {
    for (const [key, val] of Object.entries(ALERT_TONES)) {
      expect(typeof val.label, key).toBe('string')
      expect(val.label.length, key).toBeGreaterThan(0)
      expect(VALID_TONES, key).toContain(val.tone)
    }
  })

  it('contient les types critiques attendus', () => {
    expect(ALERT_TONES.VERSEMENT_MANQUANT.label).toBe('Versement manquant')
    expect(ALERT_TONES.VERSEMENT_MANQUANT.tone).toBe('alarm')
    expect(ALERT_TONES.STOCK_BAS.label).toBe('Stock bas carburant')
    expect(ALERT_TONES.ECART_STOCK.label).toContain('coulage')
  })
})

describe('STOCK_MOVEMENT_TONES', () => {
  it('associe un ton valide à chaque type de mouvement', () => {
    expect(Object.keys(STOCK_MOVEMENT_TONES)).toEqual(['entree', 'sortie', 'ajustement'])
    for (const tone of Object.values(STOCK_MOVEMENT_TONES)) expect(VALID_TONES).toContain(tone)
  })
})

describe('ORDER_STATUS_TONES', () => {
  it('couvre les 6 statuts de commande avec 6 tons distincts', () => {
    expect(Object.keys(ORDER_STATUS_TONES)).toHaveLength(6)
    const tones = Object.values(ORDER_STATUS_TONES).map(v => v.tone)
    expect(new Set(tones).size).toBe(6)
    for (const tone of tones) expect(VALID_BADGE_TONES).toContain(tone)
  })
})
