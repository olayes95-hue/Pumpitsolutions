import { usePlateforme, lienTel, lienWhatsApp } from '../lib/plateforme'
import { Icon } from '../ds/pumpit/components/core/Icon.jsx'

// Boutons Appeler et WhatsApp. Ils ouvrent le téléphone ou WhatsApp de l'appareil :
// l'appel ne passe pas par l'application. Numéros réglés dans le back-office.
const lien = { display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-3)', minHeight: 'var(--control-h)', padding: '0 20px', borderRadius: 'var(--radius-full)',
  font: '700 14px/1.15 var(--font-ui)', textDecoration: 'none', whiteSpace: 'nowrap' }

export default function ContactAssistance({ style }) {
  const p = usePlateforme()
  if (!p.telephone_assistance && !p.whatsapp_assistance) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)', ...style }}>
      {p.telephone_assistance && <a href={lienTel(p.telephone_assistance)} style={{ ...lien, background: 'var(--nuit)', color: '#FFFFFF' }}><Icon name="phone" size={17} />Appeler {p.telephone_assistance}</a>}
      {p.whatsapp_assistance && <a href={lienWhatsApp(p.whatsapp_assistance)} target="_blank" rel="noreferrer" style={{ ...lien, border: '2px solid var(--nuit)', color: 'var(--nuit)' }}><Icon name="message-circle" size={17} />WhatsApp</a>}
      {p.horaires_assistance && <span style={{ font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>{p.horaires_assistance}</span>}
    </div>
  )
}
