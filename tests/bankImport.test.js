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
  it('convertit JJ/MM/AA (année sur 2 chiffres, export BOA réel) en ISO', () => {
    expect(parseDateFR('30/09/26')).toBe('2026-09-30')
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
  const CATS = [
    { id: 1, key: 'versement_gerant', mots_cles: ['DEPOT', 'VERSEMENT ESPECES'] },
    { id: 2, key: 'frais_bancaire', mots_cles: ['FRAIS', 'TAXE', 'COMMISSION'] },
    { id: 3, key: 'autre', mots_cles: [] },
  ]
  it('garde les lignes crédit ET débit, avec leur type', () => {
    const rows = [
      ['01/03/2026', 'Dépôt', 'REF1', '', '150000'],
      ['02/03/2026', 'Frais tenue de compte', '', '2000', ''],
      ['', '', '', '', ''],
      ['Totaux', '', '', '2000', '150000'],
    ]
    const lines = buildBankLines(rows, cols, CATS)
    expect(lines).toEqual([
      { date_operation: '2026-03-01', montant: 150000, reference: 'Dépôt — REF1', type: 'credit', categorie_id: 1 },
      { date_operation: '2026-03-02', montant: 2000, reference: 'Frais tenue de compte', type: 'debit', categorie_id: 2 },
    ])
  })
  it('classe en "autre" quand aucun mot-clé ne correspond', () => {
    const rows = [['01/03/2026', 'Virement inconnu', '', '', '500']]
    expect(buildBankLines(rows, cols, CATS)[0].categorie_id).toBe(3)
  })
  it('ignore une ligne sans date valide même avec un crédit', () => {
    const rows = [['Totaux', '', '', '', '150000']]
    expect(buildBankLines(rows, cols, CATS)).toEqual([])
  })

  it('import bout en bout sur le format d\'un export réel (BOA, année sur 2 chiffres) — données anonymisées', () => {
    const csv = [
      'Date op.,Numéro du compte,Description,Référence,Date valeur,Devise,Débit,Crédit,Solde courant',
      '30/09/26,XX0000000000000000000000,TAXE SUR Commission de mouvements,Frais,30/09/26,XOF,-45.0,,498637.0',
      '29/09/26,XX0000000000000000000000,VERSEMENT ESPECES GERANT TEST/STATION TEST,ACX0001,29/09/26,XOF,,5200.0,510800.0',
      '29/09/26,XX0000000000000000000000,VERSEMENT ESPECES GERANT TEST/STATION TEST,ACX0002,29/09/26,XOF,,99900.0,505600.0',
    ].join('\n')
    const { headers, rows } = parseCsv(csv)
    const detected = detectColumns(headers)
    expect(detected).toEqual({ date: 0, description: 2, reference: 3, debit: 6, credit: 7 })
    const lines = buildBankLines(rows, detected, CATS)
    expect(lines).toEqual([
      { date_operation: '2026-09-30', montant: 45, reference: 'TAXE SUR Commission de mouvements — Frais', type: 'debit', categorie_id: 2 },
      { date_operation: '2026-09-29', montant: 5200, reference: 'VERSEMENT ESPECES GERANT TEST/STATION TEST — ACX0001', type: 'credit', categorie_id: 1 },
      { date_operation: '2026-09-29', montant: 99900, reference: 'VERSEMENT ESPECES GERANT TEST/STATION TEST — ACX0002', type: 'credit', categorie_id: 1 },
    ])
  })
})
