import { Button } from '../core/Button.jsx'
import { Checkbox } from './Checkbox.jsx'

// Bouton compact qui ouvre un petit panneau de cases à cocher — pour choisir plusieurs valeurs
// (mois, années…) sans prendre de place en permanence sur la ligne de filtres (contrairement à
// une rangée de cases à cocher toujours visible, ou à deux listes déroulantes "du / au").
export function MultiSelectPopover({ label, allLabel, options, selected, onToggle, open, onToggleOpen }) {
  return (
    <div style={{ position: 'relative' }}>
      <Button size="sm" tone={selected.length ? 'dark' : 'neutral'} onClick={onToggleOpen}>
        {selected.length ? `${label} (${selected.length})` : allLabel}
      </Button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4, padding: 'var(--sp-3)', background: 'var(--surface-panel)', border: 'var(--border-panel)', borderRadius: 'var(--radius-1)', boxShadow: '0 4px 16px rgba(0,0,0,.16)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 140, maxHeight: 280, overflowY: 'auto' }}>
          {options.map(([v, l]) => (
            <Checkbox key={v} label={l} checked={selected.includes(v)} onChange={() => onToggle(v)} />
          ))}
        </div>
      )}
    </div>
  )
}
