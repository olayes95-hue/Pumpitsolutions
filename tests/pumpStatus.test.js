import { describe, it, expect } from 'vitest'
import { pumpStatus } from '../src/pages/Journal.jsx'

describe('pumpStatus', () => {
  it('renvoie null quand il y a moins de N relevés non nuls', () => {
    const rows = [{ e1: 100 }, { e1: 99 }, { e1: null }]
    expect(pumpStatus(rows, 'e1', 3)).toBeNull()
  })

  it('renvoie "inactive" quand les N derniers relevés non nuls sont identiques', () => {
    const rows = [{ e1: 500 }, { e1: 500 }, { e1: 500 }, { e1: 480 }]
    expect(pumpStatus(rows, 'e1', 3)).toBe('inactive')
  })

  it('renvoie "active" dès que les N derniers relevés non nuls varient', () => {
    const rows = [{ e1: 520 }, { e1: 500 }, { e1: 480 }]
    expect(pumpStatus(rows, 'e1', 3)).toBe('active')
  })

  it('ignore les relevés nuls (jour sans saisie) pour compter les N valeurs', () => {
    const rows = [{ e1: 500 }, { e1: null }, { e1: 500 }, { e1: null }, { e1: 500 }]
    expect(pumpStatus(rows, 'e1', 3)).toBe('inactive')
  })

  it("s'arrête aux N premières valeurs non nulles, ignore l'historique plus ancien", () => {
    // Les 3 dernières valeurs bougent (active), même si une valeur plus ancienne stagnait.
    const rows = [{ e1: 530 }, { e1: 510 }, { e1: 500 }, { e1: 500 }, { e1: 500 }]
    expect(pumpStatus(rows, 'e1', 3)).toBe('active')
  })
})
