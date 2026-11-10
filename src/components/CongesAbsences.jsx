import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { frDate } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'

const STATUT_BADGE = { en_attente: { tone: 'warn', label: 'En attente' }, validee: { tone: 'ok', label: 'Validée' }, refusee: { tone: 'alarm', label: 'Refusée' }, annulee: { tone: 'idle', label: 'Annulée' } }

// Congés/absences : demande émise par l'employé (voir Submit.jsx, bannière "Mes congés &
// absences"), validée ou refusée ici par le gérant/directeur (manage_team) — migration_v158.
export default function CongesAbsences() {
  const { can, isAdmin } = useAuth()
  const peutGerer = isAdmin || can('manage_team')
  const [profiles, setProfiles] = useState([])
  const [demandes, setDemandes] = useState([])
  const [note, setNote] = useState({})
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  async function load() {
    const [p, d] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role,station_id').in('role', ['gerant', 'pompiste', 'vendeuse']).eq('approved', true),
      supabase.from('conges_demandes').select('*').order('created_at', { ascending: false }),
    ])
    setProfiles(p.data || []); setDemandes(d.data || [])
  }
  useEffect(() => { load() }, [])

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500) }
  const employeNom = (id) => profiles.find(p => p.id === id)?.full_name || id

  async function decider(d, statut) {
    const { error } = await supabase.from('conges_demandes').update({
      statut, decidee_par: (await supabase.auth.getUser()).data.user.id, decidee_at: new Date().toISOString(), note_decision: note[d.id] || null,
    }).eq('id', d.id)
    if (error) { setErr(error.message); return }
    flash(statut === 'validee' ? 'Demande validée' : 'Demande refusée'); load()
  }

  if (!peutGerer) return null
  const enAttente = demandes.filter(d => d.statut === 'en_attente')
  const historique = demandes.filter(d => d.statut !== 'en_attente').slice(0, 20)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      {enAttente.length > 0 && (
        <Panel title="Congés &amp; absences à valider" meta={`${enAttente.length}`} status="warn" flush>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', margin: 'var(--sp-4) var(--gutter-panel)' }}>
            {enAttente.map(d => (
              <div key={d.id} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <p style={{ font: '600 14px/1.4 var(--font-ui)', margin: 0 }}>{employeNom(d.employe_id)} — {d.type === 'conge' ? 'Congé' : 'Absence'}</p>
                <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Du {frDate(d.date_debut)} au {frDate(d.date_fin)}{d.motif ? ` — ${d.motif}` : ''}</p>
                <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Input size="sm" value={note[d.id] || ''} onChange={e => setNote(n => ({ ...n, [d.id]: e.target.value }))} placeholder="Note (optionnelle)" style={{ minWidth: 220 }} />
                  <Button size="sm" tone="primary" onClick={() => decider(d, 'validee')}>Valider</Button>
                  <Button size="sm" tone="danger" onClick={() => decider(d, 'refusee')}>Refuser</Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Historique congés &amp; absences" meta={`${historique.length}`} flush>
        {historique.length ? (
          <DataTable columns={[
            { key: 'employe', header: 'Employé', render: d => employeNom(d.employe_id) },
            { key: 'type', header: 'Type', render: d => d.type === 'conge' ? 'Congé' : 'Absence' },
            { key: 'periode', header: 'Période', render: d => `${frDate(d.date_debut)} → ${frDate(d.date_fin)}` },
            { key: 'statut', header: 'Statut', render: d => <Badge tone={STATUT_BADGE[d.statut]?.tone}>{STATUT_BADGE[d.statut]?.label || d.statut}</Badge> },
            { key: 'note', header: 'Note', render: d => d.note_decision || '—' },
          ]} rows={historique} />
        ) : <PanelEmpty icon="calendar" label="Aucune demande traitée" />}
      </Panel>
    </div>
  )
}
