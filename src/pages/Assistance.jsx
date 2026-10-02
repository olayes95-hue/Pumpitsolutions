import { useEffect, useState } from 'react'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { useStation } from '../lib/station.jsx'
import { uploadEvidence } from '../lib/image'
import { STATUT_DEMANDE, dateHeure } from '../lib/plateforme'
import Conversation from '../components/Conversation.jsx'
import ContactAssistance from '../components/ContactAssistance.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { IconButton } from '../ds/pumpit/components/core/IconButton.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Textarea } from '../ds/pumpit/components/forms/Textarea.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

// Assistance côté client : écrire à PumpIT, suivre ses demandes, appeler ou passer par WhatsApp.
// Fonctionne aussi hors de l'application (écran « Accès suspendu ») : sans station
// courante, seule la photo jointe est indisponible.
export default function Assistance() {
  const station = useStation()
  const stationId = station?.stationId || null
  const [demandes, setDemandes] = useState([])
  const [ouverte, setOuverte] = useState(null)
  const [creer, setCreer] = useState(false)
  const [f, setF] = useState({ sujet: '', contenu: '', rappel: false, telephone: '' })
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await supabase.from('assistance_demandes').select('*').order('dernier_message_at', { ascending: false }).limit(100)
    setDemandes(data || [])
    setOuverte(o => o ? (data || []).find(d => d.id === o.id) || o : o)
  }
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])

  async function envoyer(e) {
    e.preventDefault(); setErr('')
    if (!f.sujet.trim() || !f.contenu.trim()) { setErr('Renseignez le sujet et le message.'); return }
    if (f.rappel && !f.telephone.trim()) { setErr('Indiquez le numéro auquel vous rappeler.'); return }
    setBusy(true)
    try {
      let path = null
      if (photo && stationId) path = await uploadEvidence(supabase, BORDEREAUX_BUCKET, `${stationId}/assistance`, photo)
      const { data, error } = await supabase.rpc('assistance_ouvrir', {
        p_sujet: f.sujet.trim(), p_contenu: f.contenu.trim(), p_station: stationId,
        p_rappel: f.rappel, p_telephone: f.telephone.trim() || null, p_photo: path,
      })
      if (error) throw error
      setF({ sujet: '', contenu: '', rappel: false, telephone: '' }); setPhoto(null); setCreer(false)
      await load(); setOuverte(data)
    } catch (x) {
      setErr(`Demande non envoyée : ${x.message || x}`)
    } finally { setBusy(false) }
  }

  async function clore() {
    const { error } = await supabase.rpc('assistance_statut', { p_demande: ouverte.id, p_statut: 'resolue' })
    if (error) { setErr(error.message); return }
    load()
  }

  if (ouverte) {
    const st = STATUT_DEMANDE[ouverte.statut] || STATUT_DEMANDE.ouverte
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
        {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
        <Panel>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
            <IconButton icon="arrow-left" tone="solid" title="Retour aux demandes" onClick={() => { setOuverte(null); load() }} />
            <h2 style={{ fontSize: 20, flex: '1 1 200px', minWidth: 0 }}>{ouverte.sujet}</h2>
            <Badge tone={st.tone}>{st.label}</Badge>
            {ouverte.statut !== 'resolue' && <Button size="sm" icon="check" onClick={clore}>C'est résolu</Button>}
          </div>
          <Conversation demande={ouverte} cote="client" stationId={stationId} onChanged={load} />
        </Panel>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}

      <Panel title="Contacter PumpIT">
        <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--sp-4)' }}>Écrivez-nous ici : la réponse arrive dans cette page. Pour une urgence, appelez.</p>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
          {!creer && <Button tone="primary" icon="message-circle" onClick={() => setCreer(true)}>Nouvelle demande</Button>}
          <ContactAssistance />
        </div>

        {creer && (
          <form onSubmit={envoyer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', marginTop: 'var(--sp-5)', maxWidth: 640 }}>
            <Field label="Sujet" required><Input value={f.sujet} maxLength={160} onChange={e => setF({ ...f, sujet: e.target.value })} placeholder="ex : Le relevé de 16 h ne s'envoie pas" /></Field>
            <Field label="Message" required hint="Décrivez ce que vous faisiez et ce qui s'affiche."><Textarea rows={4} value={f.contenu} maxLength={4000} onChange={e => setF({ ...f, contenu: e.target.value })} /></Field>
            {stationId && (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                <label style={{ display: 'inline-flex' }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { setPhoto(e.target.files?.[0] || null); e.target.value = '' }} />
                  <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 'var(--control-h-sm)', padding: '0 14px', borderRadius: 'var(--radius-full)', background: 'var(--gris-fond)', font: '600 13px/1 var(--font-ui)', cursor: 'pointer' }}>Joindre une photo</span>
                </label>
                {photo && <Tag onRemove={() => setPhoto(null)}>{photo.name}</Tag>}
              </div>
            )}
            <Checkbox checked={f.rappel} onChange={v => setF({ ...f, rappel: v })} label="Je souhaite être rappelé(e)" />
            {f.rappel && <Field label="Numéro pour le rappel" required><Input type="tel" value={f.telephone} onChange={e => setF({ ...f, telephone: e.target.value })} placeholder="+229 …" style={{ maxWidth: 280 }} /></Field>}
            <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
              <Button type="submit" tone="primary" icon="send" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer la demande'}</Button>
              <Button tone="ghost" onClick={() => { setCreer(false); setErr('') }}>Annuler</Button>
            </div>
          </form>
        )}
      </Panel>

      <Panel title="Vos demandes" meta={demandes.length ? `${demandes.length}` : undefined} flush>
        {!demandes.length ? <PanelEmpty icon="message-circle" label="Aucune demande pour le moment." /> : demandes.map(d => {
          const st = STATUT_DEMANDE[d.statut] || STATUT_DEMANDE.ouverte
          return (
            <button key={d.id} type="button" onClick={() => setOuverte(d)}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', width: '100%', textAlign: 'left', padding: 'var(--sp-4) var(--gutter-panel)', background: 'transparent', border: 0, borderTop: '1px solid var(--border-hairline)', cursor: 'pointer' }}>
              {d.non_lu_client && <span title="Nouvelle réponse" style={{ width: 10, height: 10, borderRadius: 'var(--radius-full)', background: 'var(--vert-pump)', flex: '0 0 auto' }} />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: (d.non_lu_client ? '600' : '500') + ' 15px/1.3 var(--font-ui)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.sujet}</span>
                <span style={{ font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>{d.auteur_nom} · {dateHeure(d.dernier_message_at)}</span>
              </span>
              <Badge tone={st.tone}>{st.label}</Badge>
            </button>
          )
        })}
      </Panel>
    </div>
  )
}
