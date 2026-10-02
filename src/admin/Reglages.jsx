import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { oublierPlateforme } from '../lib/plateforme'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

// Réglages de la plateforme : assistance, période d'essai, émetteur des factures.
// Les prix et le contenu des offres se règlent dans la rubrique Offres.
export default function Reglages() {
  const [p, setP] = useState(null)
  const [formules, setFormules] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    const [r, f] = await Promise.all([
      supabase.from('plateforme_reglages').select('*').eq('id', 1).maybeSingle(),
      supabase.from('formules').select('*').order('ordre'),
    ])
    setP(r.data || {}); setFormules(f.data || [])
  }
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setP({ ...p, [k]: e.target.value })
  // Nombre saisi avec une virgule ou un point décimal. Renvoie null si ce n'est pas un nombre.
  const nombre = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return String(v ?? '').trim() === '' || isNaN(n) ? null : n }
  const vide = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim())

  async function enregistrer(champs, message) {
    setErr(''); setMsg('')
    const { error } = await supabase.from('plateforme_reglages').update(champs).eq('id', 1)
    if (error) { setErr(error.message); return }
    oublierPlateforme(); setMsg(message); load()
  }

  if (!p) return <div className="center" style={{ minHeight: '40dvh' }}>Chargement…</div>
  const grille = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--sp-4)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')}>{msg}</AlertBanner>}

      <Panel title="Assistance" meta="affichée à vos clients">
        <form onSubmit={e => { e.preventDefault(); enregistrer({ telephone_assistance: vide(p.telephone_assistance), whatsapp_assistance: vide(p.whatsapp_assistance), horaires_assistance: vide(p.horaires_assistance) }, 'Coordonnées d\'assistance enregistrées.') }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={grille}>
            <Field label="Téléphone" hint="Bouton « Appeler »."><Input type="tel" value={p.telephone_assistance || ''} onChange={set('telephone_assistance')} placeholder="+229 …" /></Field>
            <Field label="WhatsApp" hint="Avec l'indicatif du pays."><Input type="tel" value={p.whatsapp_assistance || ''} onChange={set('whatsapp_assistance')} placeholder="+229 …" /></Field>
            <Field label="Horaires" hint="Affichés à côté des boutons."><Input value={p.horaires_assistance || ''} onChange={set('horaires_assistance')} placeholder="ex : du lundi au samedi, 8 h à 18 h" /></Field>
          </div>
          <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
        </form>
      </Panel>

      <Panel title="Émetteur des factures">
        <form onSubmit={e => { e.preventDefault(); enregistrer({ raison_sociale: vide(p.raison_sociale) || 'PumpIT Solutions', adresse: vide(p.adresse), telephone: vide(p.telephone), email: vide(p.email), rccm: vide(p.rccm), ifu: vide(p.ifu), coordonnees_bancaires: vide(p.coordonnees_bancaires), taux_tva: nombre(p.taux_tva) ?? 0, prefixe_facture: vide(p.prefixe_facture) || 'PI' }, 'Émetteur enregistré.') }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={grille}>
            <Field label="Raison sociale"><Input value={p.raison_sociale || ''} onChange={set('raison_sociale')} /></Field>
            <Field label="Adresse"><Input value={p.adresse || ''} onChange={set('adresse')} /></Field>
            <Field label="Téléphone"><Input type="tel" value={p.telephone || ''} onChange={set('telephone')} /></Field>
            <Field label="E-mail"><Input type="email" value={p.email || ''} onChange={set('email')} /></Field>
            <Field label="RCCM"><Input value={p.rccm || ''} onChange={set('rccm')} /></Field>
            <Field label="IFU"><Input value={p.ifu || ''} onChange={set('ifu')} /></Field>
            <Field label="Coordonnées bancaires"><Input value={p.coordonnees_bancaires || ''} onChange={set('coordonnees_bancaires')} /></Field>
            <Field label="TVA (%)" hint="0 si vous n'êtes pas assujetti."><Input numeric inputMode="decimal" value={p.taux_tva ?? 0} onChange={set('taux_tva')} suffix="%" /></Field>
            <Field label="Préfixe des numéros" hint="ex : PI-2026-00001"><Input value={p.prefixe_facture || ''} onChange={set('prefixe_facture')} maxLength={6} /></Field>
          </div>
          <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
        </form>
      </Panel>

      <Panel title="Période d'essai gratuit">
        <form onSubmit={e => { e.preventDefault(); const j = nombre(p.essai_jours); if (j === null || j < 0 || j > 365) { setErr('Durée d\'essai invalide (0 à 365 jours).'); return } enregistrer({ essai_jours: Math.round(j), essai_formule: p.essai_formule || null, suspendre_fin_essai: p.suspendre_fin_essai !== false }, 'Réglages de l\'essai enregistrés.') }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={grille}>
            <Field label="Durée de l'essai" hint="0 pour ne pas proposer d'essai."><Input numeric inputMode="numeric" suffix="jours" value={p.essai_jours ?? 30} onChange={set('essai_jours')} /></Field>
            <Field label="Fonctions pendant l'essai" hint="Ce que le client peut utiliser avant de payer.">
              <Select value={p.essai_formule || ''} onChange={set('essai_formule')} style={{ width: '100%' }}
                options={[{ value: '', label: 'Celles de l\'offre choisie' }, ...formules.map(f => ({ value: f.key, label: `Celles de l'offre ${f.label}` }))]} />
            </Field>
          </div>
          <Checkbox checked={p.suspendre_fin_essai !== false} onChange={v => setP({ ...p, suspendre_fin_essai: v })} label="Bloquer l'accès automatiquement à la fin de l'essai" />
          <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
            Sans blocage automatique, le client garde son accès et apparaît « Essai terminé » dans la supervision. La durée s'applique aux prochains clients créés ; la date d'un essai en cours se modifie dans la fiche du client.
          </p>
          <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
        </form>
      </Panel>
    </div>
  )
}
