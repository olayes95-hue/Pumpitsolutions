import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { oublierPlateforme } from '../lib/plateforme'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

// Réglages de la plateforme : coordonnées d'assistance, émetteur des factures, prix des formules.
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
  async function enregistrerPrix(e) {
    e.preventDefault(); setErr(''); setMsg('')
    for (const f of formules) {
      const prix = nombre(f.prix_mensuel)
      if (prix === null || prix < 0) { setErr(`Prix invalide pour la formule ${f.label}.`); return }
      const { error } = await supabase.from('formules').update({ prix_mensuel: prix }).eq('key', f.key)
      if (error) { setErr(error.message); return }
    }
    setMsg('Prix enregistrés. Ils s\'appliquent aux prochaines factures.'); load()
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

      <Panel title="Prix des formules" meta="par mois">
        <form onSubmit={enregistrerPrix} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={grille}>
            {formules.map((f, i) => (
              <Field key={f.key} label={f.label}>
                <Input numeric inputMode="numeric" value={f.prix_mensuel} suffix="F" onChange={e => setFormules(formules.map((x, j) => j === i ? { ...x, prix_mensuel: e.target.value } : x))} />
              </Field>
            ))}
          </div>
          <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer les prix</Button>
        </form>
      </Panel>
    </div>
  )
}
