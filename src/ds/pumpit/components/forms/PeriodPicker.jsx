import { useState } from 'react'
import { Button } from '../core/Button.jsx'
import { Checkbox } from './Checkbox.jsx'

const MOIS = [['01', 'Janv'], ['02', 'Févr'], ['03', 'Mars'], ['04', 'Avril'], ['05', 'Mai'], ['06', 'Juin'],
  ['07', 'Juil'], ['08', 'Août'], ['09', 'Sept'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Déc']]

// Sélecteur de période unique — un seul bouton, un seul panneau, année(s) ET mois ensemble
// (remplace deux sélecteurs séparés "Années" / "Mois"). Multi-sélection des deux dimensions ;
// choisir une année sans aucun mois = toute l'année. Par défaut (chez l'appelant), année et
// mois en cours — voir chaque page.
export function PeriodPicker({ years, months, setYears, setMonths, availableYears, showMonths = true }) {
  const [open, setOpen] = useState(false)
  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  const label = () => {
    if (!years.length && !months.length) return 'Toutes périodes'
    if (years.length === 1 && months.length === 1) return `${MOIS.find(([v]) => v === months[0])?.[1] || months[0]} ${years[0]}`
    if (years.length === 1 && !months.length) return years[0]
    const parts = []
    parts.push(years.length === 1 ? years[0] : years.length ? `${years.length} années` : null)
    parts.push(months.length === 1 ? MOIS.find(([v]) => v === months[0])?.[1] : months.length ? `${months.length} mois` : null)
    return parts.filter(Boolean).join(' · ') || 'Toutes périodes'
  }

  return (
    <div style={{ position: 'relative' }}>
      <Button size="sm" icon="calendar-days" tone={(years.length || months.length) ? 'dark' : 'neutral'} onClick={() => setOpen(v => !v)}>{label()}</Button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4, padding: 'var(--sp-4)', background: 'var(--surface-panel)', border: 'var(--border-panel)', borderRadius: 'var(--radius-1)', boxShadow: '0 4px 16px rgba(0,0,0,.16)', display: 'flex', gap: 'var(--sp-6)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 90, maxHeight: 280, overflowY: 'auto' }}>
            <span style={{ font: '600 12px/1.2 var(--font-ui)', color: 'var(--text-muted)' }}>Année(s)</span>
            {availableYears.map(y => <Checkbox key={y} label={y} checked={years.includes(y)} onChange={() => toggle(years, setYears, y)} />)}
          </div>
          {showMonths && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 110, maxHeight: 280, overflowY: 'auto' }}>
              <span style={{ font: '600 12px/1.2 var(--font-ui)', color: 'var(--text-muted)' }}>Mois</span>
              {MOIS.map(([v, l]) => <Checkbox key={v} label={l} checked={months.includes(v)} onChange={() => toggle(months, setMonths, v)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
