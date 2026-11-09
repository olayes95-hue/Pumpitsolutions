import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { fcfa, frDate, today } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Drawer, DrawerRow } from '../ds/pumpit/components/feedback/Drawer.jsx'

const STATUT_BADGE = { envoyee: { tone: 'warn', label: 'En attente de réponse' }, repondue: { tone: 'ok', label: 'Répondue' }, sans_reponse: { tone: 'alarm', label: 'Sans réponse' } }

// Autonome (pas liée à une dette_personnel précise) : l'admin/manage_team crée une demande pour
// n'importe quel employé et motif ; l'employé répond lui-même (voir la bannière dans Submit.jsx).
export default function DemandesExplication() {
  const { can, isAdmin } = useAuth()
  const peutGerer = isAdmin || can('manage_team')
  const [profiles, setProfiles] = useState([])
  const [demandes, setDemandes] = useState([])
  const [f, setF] = useState({ employe_id: '', motif: '', date_limite: '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [detailId, setDetailId] = useState(null)

  async function load() {
    const [p, d] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role,station_id').in('role', ['gerant', 'pompiste', 'vendeuse']).eq('approved', true),
      supabase.from('demandes_explication').select('*').order('created_at', { ascending: false }),
    ])
    setProfiles(p.data || []); setDemandes(d.data || [])
  }
  useEffect(() => { load() }, [])

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500) }
  const employeNom = (id) => profiles.find(p => p.id === id)?.full_name || id

  async function creer(e) {
    e.preventDefault(); setErr('')
    if (!f.employe_id || !f.motif.trim()) return
    const employe = profiles.find(p => p.id === f.employe_id)
    const { error } = await supabase.from('demandes_explication').insert({
      station_id: employe?.station_id, employe_id: f.employe_id, motif: f.motif.trim(), date_limite: f.date_limite || null,
    })
    if (error) { setErr(error.message); return }
    setF({ employe_id: '', motif: '', date_limite: '' }); flash('Demande envoyée'); load()
  }
  async function marquerSansReponse(d) {
    const { error } = await supabase.from('demandes_explication').update({ statut: 'sans_reponse' }).eq('id', d.id)
    if (error) { setErr(error.message); return }
    load()
  }

  if (!peutGerer) return null
  const detail = demandes.find(d => d.id === detailId)

  const columns = [
    { key: 'employe', header: 'Employé', render: d => employeNom(d.employe_id) },
    { key: 'motif', header: 'Motif', render: d => <span style={{ maxWidth: 320, display: 'inline-block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.motif}</span> },
    { key: 'date_limite', header: 'Date limite', render: d => d.date_limite ? frDate(d.date_limite) : '—' },
    { key: 'statut', header: 'Statut', render: d => <Badge tone={STATUT_BADGE[d.statut]?.tone}>{STATUT_BADGE[d.statut]?.label || d.statut}</Badge> },
    { key: 'actions', header: '', align: 'right', render: d => (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <Button size="sm" onClick={() => setDetailId(d.id)}>Voir</Button>
        {d.statut === 'envoyee' && <Button size="sm" tone="danger" onClick={() => marquerSansReponse(d)}>Marquer sans réponse</Button>}
      </div>
    ) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <Panel title="Demander une explication">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Pour tout motif (manque de caisse, retard, absence...) — l'employé verra la demande et pourra y répondre directement dans l'application.
        </p>
        {err && <AlertBanner tone="alarm" title="Erreur" style={{ marginBottom: 'var(--sp-4)' }}>{err}</AlertBanner>}
        {msg && <AlertBanner tone="ok" title="Succès" style={{ marginBottom: 'var(--sp-4)' }}>{msg}</AlertBanner>}
        <form onSubmit={creer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <Field label="Employé" required>
            <Select value={f.employe_id} onChange={e => setF(p => ({ ...p, employe_id: e.target.value }))} style={{ width: '100%' }}
              options={[{ value: '', label: '— choisir —' }, ...profiles.map(p => ({ value: p.id, label: `${p.full_name} (${p.role})` }))]} />
          </Field>
          <Field label="Motif" required><Input value={f.motif} onChange={e => setF(p => ({ ...p, motif: e.target.value }))} placeholder="ex : manque de caisse de 15 000 F le 12/05" /></Field>
          <Field label="Date limite de réponse (optionnelle)"><Input type="date" value={f.date_limite} onChange={e => setF(p => ({ ...p, date_limite: e.target.value }))} /></Field>
          <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>Envoyer la demande</Button>
        </form>
      </Panel>

      <Panel title="Demandes d'explication" meta={`${demandes.length}`} flush>
        {demandes.length ? <DataTable columns={columns} rows={demandes} /> : <PanelEmpty icon="file-pen-line" label="Aucune demande" />}
      </Panel>

      <Drawer open={!!detailId} onClose={() => setDetailId(null)} title={detail ? employeNom(detail.employe_id) : ''}
        meta={detail ? STATUT_BADGE[detail.statut]?.label : ''} status={detail?.statut === 'repondue' ? 'ok' : detail?.statut === 'sans_reponse' ? 'alarm' : 'warn'}>
        {detail && <>
          <DrawerRow label="Motif" mono={false} value={detail.motif} />
          {detail.date_limite && <DrawerRow label="Date limite" mono={false} value={frDate(detail.date_limite)} />}
          <DrawerRow label="Envoyée le" mono={false} value={frDate(detail.created_at?.slice(0, 10))} />
          <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: 'var(--sp-5) 0 var(--sp-2)' }}>Réponse</p>
          {detail.reponse
            ? <p style={{ font: '400 14px/1.5 var(--font-ui)', color: 'var(--text-body)' }}>{detail.reponse}</p>
            : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Pas encore de réponse.</p>}
        </>}
      </Drawer>
    </div>
  )
}
