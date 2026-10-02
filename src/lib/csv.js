// Export CSV compatible Excel FR : séparateur « ; », décimales à la virgule, BOM UTF-8 (accents).
function csvCell(v) {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v)
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// rows: array of objects ; columns: [[header, key], ...]
export function exportRowsToCsv(filename, columns, rows) {
  const lines = [columns.map(([h]) => csvCell(h)).join(';')]
  for (const row of rows) lines.push(columns.map(([, k]) => csvCell(row[k])).join(';'))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
