import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { frDate } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'

const STATUT_BADGE = { en_attente: { tone: 'warn', label: 'En attente' }, validee: { tone: 'ok', label: 'Validée' }, refusee: { tone: 'alarm', label: 'Refusée' }, annulee: { tone: 'idle', label: 'Annulée' } }

// Onglet Demandes > Congés & absences — demande émise par l'employé (bouton "Demander un
// congé"), validée ou refusée par le gérant/directeur (manage_team) — migration_v158. Un seul
// composant pour les deux rôles : un employé ne voit/gère que ses propres demandes (suivi +
// historique), un manage_team voit et traite celles de toute l'équipe.
export default function CongesAbsences() {
  const { can, isAdmin, session } = useAuth()
  const { stationId } = useStation()
  const peutValider = isAdmin || can('manage_team')
  const [profiles, setProfiles] = useState([])
  const [demandes, setDemandes] = useState([])
  const [note, setNote] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ type: 'conge', date_debut: '', date_fin: '', motif: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  async function load() {
    if (peutValider) {
      const [p, d] = await Promise.all([
        supabase.from('profiles').select('id,full_name,role,station_id').in('role', ['gerant', 'pompiste', 'vendeuse']).eq('approved', true).or('plateforme_role.is.null,membre_equipe_malgre_agent.eq.true'),
        supabase.from('conges_demandes').select('*').order('created_at', { ascending: false }),
      ])
      setProfiles(p.data || []); setDemandes(d.data || [])
    } else if (session?.user?.id) {
      const { data } = await supabase.from('conges_demandes').select('*').eq('employe_id', session.user.id).order('created_at', { ascending: false })
      setDemandes(data || [])
    }
  }
  useEffect(() => { load() }, [peutValider, session?.user?.id])

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500) }
  const fail = (e) => { setErr(e.message || String(e)); setMsg('') }
  const employeNom = (id) => peutValider ? (profiles.find(p => p.id === id)?.full_name || id) : null

  async function demander(e) {
    e.preventDefault()
    if (!form.date_debut || !form.date_fin) return
    setBusy(true)
    const { error } = await supabase.from('conges_demandes').insert({
      station_id: stationId, employe_id: session.user.id, type: form.type,
      date_debut: form.date_debut, date_fin: form.date_fin, motif: form.motif.trim() || null,
    })
    setBusy(false)
    if (error) { fail(error); return }
    setForm({ type: 'conge', date_debut: '', date_fin: '', motif: '' }); setShowForm(false)
    flash('Demande envoyée'); load()
  }
  async function annuler(id) {
    const { error } = await supabase.from('conges_demandes').update({ statut: 'annulee' }).eq('id', id)
    if (error) { fail(error); return }
    load()
  }
  async function decider(d, statut) {
    const { error } = await supabase.from('conges_demandes').update({
      statut, decidee_par: session.user.id, decidee_at: new Date().toISOString(), note_decision: note[d.id] || null,
    }).eq('id', d.id)
    if (error) { fail(error); return }
    flash(statut === 'validee' ? 'Demande validée' : 'Demande refusée'); load()
  }

  const enAttente = demandes.filter(d => d.statut === 'en_attente')
  const historique = demandes.filter(d => d.statut !== 'en_attente').slice(0, peutValider ? 20 : 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <div>
        <Button tone={showForm ? 'dark' : 'primary'} icon="plus" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Annuler' : 'Demander un congé'}
        </Button>
      </div>

      {showForm && (
        <Panel title="Demander un congé ou signaler une absence">
          <form onSubmit={demander} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'end' }}>
            <Field label="Type" style={{ flex: '1 1 140px' }}>
              <Select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                options={[{ value: 'conge', label: 'Congé' }, { value: 'absence', label: 'Absence' }]} style={{ width: '100%' }} />
            </Field>
            <Field label="Du" style={{ flex: '1 1 140px' }}>
              <Input type="date" value={form.date_debut} onChange={e => setForm(p => ({ ...p, date_debut: e.target.value }))} />
            </Field>
            <Field label="Au" style={{ flex: '1 1 140px' }}>
              <Input type="date" value={form.date_fin} min={form.date_debut || undefined} onChange={e => setForm(p => ({ ...p, date_fin: e.target.value }))} />
            </Field>
            <Field label="Motif (optionnel)" style={{ flex: '2 1 200px' }}>
              <Input value={form.motif} onChange={e => setForm(p => ({ ...p, motif: e.target.value }))} placeholder="ex : mariage, maladie…" />
            </Field>
            <Button type="submit" tone="primary" disabled={busy || !form.date_debut || !form.date_fin}>Envoyer la demande</Button>
          </form>
        </Panel>
      )}

      <Panel title={peutValider ? 'Congés & absences à valider' : 'Suivi de ma demande'} meta={`${enAttente.length}`} status={enAttente.length ? 'warn' : 'ok'} flush>
        {enAttente.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', margin: 'var(--sp-4) var(--gutter-panel)' }}>
            {enAttente.map(d => (
              <div key={d.id} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <p style={{ font: '600 14px/1.4 var(--font-ui)', margin: 0 }}>{peutValider ? `${employeNom(d.employe_id)} — ` : ''}{d.type === 'conge' ? 'Congé' : 'Absence'}</p>
                <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Du {frDate(d.date_debut)} au {frDate(d.date_fin)}{d.motif ? ` — ${d.motif}` : ''}</p>
                <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                  {peutValider ? (<>
                    <Input size="sm" value={note[d.id] || ''} onChange={e => setNote(n => ({ ...n, [d.id]: e.target.value }))} placeholder="Note (optionnelle)" style={{ minWidth: 220 }} />
                    <Button size="sm" tone="primary" onClick={() => decider(d, 'validee')}>Valider</Button>
                    <Button size="sm" tone="danger" onClick={() => decider(d, 'refusee')}>Refuser</Button>
                  </>) : (
                    <Badge tone="warn">En attente de validation</Badge>
                  )}
                  {!peutValider && <Button size="sm" onClick={() => annuler(d.id)}>Annuler ma demande</Button>}
                </div>
              </div>
            ))}
          </div>
        ) : <PanelEmpty icon="calendar" label={peutValider ? 'Aucune demande en attente' : 'Aucune demande en cours'} />}
      </Panel>

      <Panel title="Historique" meta={`${historique.length}`} flush>
        {historique.length ? (
          <DataTable columns={[
            ...(peutValider ? [{ key: 'employe', header: 'Employé', render: d => employeNom(d.employe_id) }] : []),
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
