import { describe, it, expect } from 'vitest'
import { parseCsv, detectColumns, parseMontant, parseDateFR, buildBankLines } from '../src/lib/bankImport.js'

describe('parseCsv', () => {
  it('détecte le séparateur point-virgule et découpe les lignes', () => {
    const { headers, rows } = parseCsv('Date opération;Description;Débit;Crédit\n01/03/2026;Dépôt caisse;;150000\n')
    expect(headers).toEqual(['Date opération', 'Description', 'Débit', 'Crédit'])
    expect(rows).toEqual([['01/03/2026', 'Dépôt caisse', '', '150000']])
  })
  it('gère les champs entre guillemets contenant le séparateur', () => {
    const { rows } = parseCsv('A;B\n"1;2";3\n')
    expect(rows).toEqual([['1;2', '3']])
  })
  it('détecte la virgule comme séparateur si plus fréquente', () => {
    const { headers } = parseCsv('Date,Montant,Ref\n01/01/2026,100,x\n')
    expect(headers).toEqual(['Date', 'Montant', 'Ref'])
  })
})

describe('detectColumns', () => {
  it('reconnaît les en-têtes français avec accents', () => {
    const cols = detectColumns(['Date opération', 'Date validation', 'Description', 'Référence', 'Débit', 'Crédit', 'Solde'])
    expect(cols).toEqual({ date: 0, description: 2, reference: 3, debit: 4, credit: 5 })
  })
  it('renvoie -1 pour une colonne absente', () => {
    const cols = detectColumns(['Date', 'Montant'])
    expect(cols.credit).toBe(-1)
    expect(cols.description).toBe(-1)
  })
})

describe('parseMontant', () => {
  it('lit un format français avec espace milliers et virgule décimale', () => {
    expect(parseMontant('150 000,50')).toBe(150000.5)
  })
  it('lit un format avec point milliers et virgule décimale', () => {
    expect(parseMontant('1.234.567,00')).toBe(1234567)
  })
  it('lit un format simple sans séparateur', () => {
    expect(parseMontant('5000')).toBe(5000)
  })
  it('renvoie null pour une valeur vide', () => {
    expect(parseMontant('')).toBeNull()
    expect(parseMontant(null)).toBeNull()
  })
})

describe('parseDateFR', () => {
  it('convertit JJ/MM/AAAA en ISO', () => {
    expect(parseDateFR('05/03/2026')).toBe('2026-03-05')
  })
  it('convertit JJ-MM-AAAA en ISO', () => {
    expect(parseDateFR('5-3-2026')).toBe('2026-03-05')
  })
  it('laisse passer une date déjà ISO', () => {
    expect(parseDateFR('2026-03-05')).toBe('2026-03-05')
  })
  it('renvoie null si illisible', () => {
    expect(parseDateFR('n/a')).toBeNull()
  })
})

describe('buildBankLines', () => {
  const cols = { date: 0, description: 1, reference: 2, debit: 3, credit: 4 }
  it('ne garde que les lignes avec un crédit positif', () => {
    const rows = [
      ['01/03/2026', 'Dépôt', 'REF1', '', '150000'],
      ['02/03/2026', 'Frais tenue de compte', '', '2000', ''],
      ['', '', '', '', ''],
      ['Totaux', '', '', '2000', '150000'],
    ]
    const lines = buildBankLines(rows, cols)
    expect(lines).toEqual([{ date_operation: '2026-03-01', montant: 150000, reference: 'Dépôt — REF1' }])
  })
  it('ignore une ligne sans date valide même avec un crédit', () => {
    const rows = [['Totaux', '', '', '', '150000']]
    expect(buildBankLines(rows, cols)).toEqual([])
  })
})
