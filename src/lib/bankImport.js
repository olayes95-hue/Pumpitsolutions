// Import d'un relevé bancaire (CSV) dans Rapprochement. Depuis la v107, les débits sont gardés
// aussi (plus seulement les crédits) et chaque ligne est classée dans une catégorie — mots-clés
// définis par l'admin (bank_line_categories, voir Stations & équipe → Paramètres).

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

// Décodage : la plupart des banques exportent en UTF-8, certaines en Windows-1252 (Latin-1).
// Repère les signes typiques d'un mauvais décodage UTF-8 d'un fichier Latin-1 et redécode.
export async function readCsvFile(file) {
  const buf = await file.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buf)
  if (/Ã©|Ã¨|Ã´|Ã»|Â«|Â»|â€™|â€“/.test(text)) text = new TextDecoder('windows-1252').decode(buf)
  return text.replace(/^﻿/, '')
}

function detectDelimiter(headerLine) {
  const counts = [';', ',', '\t'].map(d => [d, headerLine.split(d).length - 1])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ';'
}

function splitCsvLine(line, delim) {
  const out = []; let cur = ''; let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === delim) { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

export function parseCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '')
  if (!lines.length) return { headers: [], rows: [] }
  const delim = detectDelimiter(lines[0])
  const headers = splitCsvLine(lines[0], delim)
  const rows = lines.slice(1).map(l => splitCsvLine(l, delim))
  return { headers, rows }
}

// Auto-détection des colonnes par nom d'en-tête (insensible aux accents/majuscules) — repli sur
// une sélection manuelle côté UI si une colonne obligatoire (date, crédit) n'est pas trouvée.
export function detectColumns(headers) {
  const h = headers.map(norm)
  const find = (re) => h.findIndex(x => re.test(x))
  return {
    date: find(/date.*op|^date$/),
    description: find(/description|libelle|intitule/),
    reference: find(/reference|^ref$/),
    debit: find(/debit/),
    credit: find(/credit/),
  }
}

export function parseMontant(raw) {
  if (raw == null) return null
  let s = String(raw).trim().replace(/\s/g, '').replace(/[^\d,.\-]/g, '')
  if (!s) return null
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
  else if (lastDot > lastComma) s = s.replace(/,/g, '')
  const n = Number(s)
  return isNaN(n) ? null : n
}

// Accepte JJ/MM/AAAA, JJ/MM/AA (année sur 2 chiffres — ex. export BOA "30/09/26"), JJ-MM-AAAA,
// JJ.MM.AAAA et AAAA-MM-JJ (déjà ISO) → renvoie une date ISO ou null.
export function parseDateFR(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})/)
  if (m) {
    const annee = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${annee}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

// Catégorie d'une ligne : premier mot-clé (insensible accents/majuscules) trouvé dans la
// description+référence, sinon la catégorie "autre" si elle existe, sinon aucune (null).
function categoriser(texte, categories) {
  const t = norm(texte)
  for (const cat of categories) {
    if ((cat.mots_cles || []).some(mc => mc && t.includes(norm(mc)))) return cat.id
  }
  return categories.find(c => c.key === 'autre')?.id ?? null
}

// Construit les lignes bank_lines (crédits ET débits désormais) à partir des lignes CSV +
// colonnes mappées + catégories admin. Ignore toute ligne sans date valide (lignes de
// total/solde, lignes vides) ou sans montant ni en crédit ni en débit.
export function buildBankLines(rows, cols, categories = []) {
  const out = []
  for (const r of rows) {
    const date_operation = parseDateFR(cols.date >= 0 ? r[cols.date] : null)
    if (!date_operation) continue
    const description = cols.description >= 0 ? r[cols.description] : ''
    const reference = cols.reference >= 0 ? r[cols.reference] : ''
    const refText = [description, reference].filter(Boolean).join(' — ') || null
    const categorie_id = categoriser(`${description} ${reference}`, categories)
    const credit = cols.credit >= 0 ? parseMontant(r[cols.credit]) : null
    if (credit != null && Math.abs(credit) > 0) {
      out.push({ date_operation, montant: Math.abs(credit), reference: refText, type: 'credit', categorie_id })
    }
    const debit = cols.debit >= 0 ? parseMontant(r[cols.debit]) : null
    if (debit != null && Math.abs(debit) > 0) {
      out.push({ date_operation, montant: Math.abs(debit), reference: refText, type: 'debit', categorie_id })
    }
  }
  return out
}
