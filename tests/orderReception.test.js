import { describe, it, expect } from 'vitest'
import { N, prixAchat, ecartWarning } from '../src/lib/orderReception'

describe('N', () => {
  it('convertit une chaîne numérique', () => { expect(N('1 234')).toBe(1234) })
  it('renvoie 0 pour une valeur vide', () => { expect(N('')).toBe(0) })
  it('renvoie 0 pour null/undefined', () => { expect(N(null)).toBe(0); expect(N(undefined)).toBe(0) })
})

describe('prixAchat', () => {
  it('utilise le prix gasoil pour le produit gasoil', () => {
    expect(prixAchat('gasoil', { essence_pa: 705, gasoil_pa: 730 })).toBe(730)
  })
  it('utilise le prix essence pour tout autre produit', () => {
    expect(prixAchat('essence', { essence_pa: 705, gasoil_pa: 730 })).toBe(705)
  })
  it('retombe sur les valeurs par défaut si absentes des réglages', () => {
    expect(prixAchat('gasoil', {})).toBe(730)
    expect(prixAchat('essence', {})).toBe(705)
  })
})

describe('ecartWarning', () => {
  it('ne renvoie rien quand cuve après−avant correspond à la quantité déclarée', () => {
    expect(ecartWarning({ recu: 5000, cuveAvant: 1000, cuveApres: 6000, tauxPerteAcceptable: 5 })).toBeNull()
  })
  it('renvoie un message quand l\'écart dépasse le seuil', () => {
    const msg = ecartWarning({ recu: 5000, cuveAvant: 1000, cuveApres: 5500, tauxPerteAcceptable: 5 })
    expect(msg).toContain('Déclaré reçu')
    expect(msg).toMatch(/5\D*000\D*L/)
    expect(msg).toMatch(/4\D*500\D*L/)
  })
  it('ignore l\'écart quand force=true, même énorme', () => {
    expect(ecartWarning({ recu: 5000, cuveAvant: 1000, cuveApres: 1000, tauxPerteAcceptable: 5, force: true })).toBeNull()
  })
  it('applique un seuil plancher de 50 L même pour de petites quantités', () => {
    // 100 L déclarés, taux 5% -> seuil théorique 5 L, mais plancher 50 L : un écart de 40 L doit passer
    expect(ecartWarning({ recu: 100, cuveAvant: 0, cuveApres: 60, tauxPerteAcceptable: 5 })).toBeNull()
  })
})
