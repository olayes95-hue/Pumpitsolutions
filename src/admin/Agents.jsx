import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'

const PERMISSION = {
  supervision: 'Supervision et statistiques', clients: 'Clients et essais', offres: 'Offres et fonctions', facturation: 'Factures et comptabilité',
  assistance: 'Assistance', ouvrir_client: 'Entrer chez un client', reglages: 'Réglages', agents: 'Équipe PumpIT',
}

// Équipe PumpIT : les personnes qui gèrent la plateforme, et ce que chaque rôle autorise.
export default function Agents() {
  const { session } = useAuth()
  const [agents, setAgents] = useState([])
  const [roles, setRoles] = useState([])
  const [f, setF] = useState({ email: '', role: 'support' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const fail = (e) => { setMsg(''); setErr(e?.message || String(e)) }

  async function load() {
    const [a, r] = await Promise.all([supabase.rpc('bo_agents'), supabase.from('plateforme_roles').select('*').order('ordre')])
    if (a.error) fail(a.error)
    setAgents(a.data || []); setRoles(r.data || [])
  }
  useEffect(() => { load() }, [])

  async function definir(email, role, message) {
    setBusy(true)
    const { error } = await supabase.rpc('agent_definir', { p_email: email, p_role: role })
    setBusy(false)
    if (error) return fail(error)
    setErr(''); setMsg(message); load()
  }
  async function ajouter(e) {
    e.preventDefault()
    if (!f.email.trim()) return fail('Renseignez l\'e-mail du compte.')
    await definir(f.email.trim(), f.role, 'Agent ajouté. Il accède au back-office à sa prochaine connexion.')
    setF({ email: '', role: 'support' })
  }

  const optionsRole = roles.map(r => ({ value: r.key, label: r.label }))
  const cols = [
    { key: 'full_name', header: 'Agent', render: a => <span><b style={{ fontWeight: 600 }}>{a.full_name}</b>{a.id === session?.user?.id && <span style={{ color: 'var(--text-muted)' }}> (vous)</span>}</span> },
    { key: 'email', header: 'E-mail', optional: '1', muted: true },
    { key: 'plateforme_role', header: 'Rôle', render: a => a.id === session?.user?.id
      ? <Badge tone="accent">{roles.find(r => r.key === a.plateforme_role)?.label || a.plateforme_role}</Badge>
      : <Select size="sm" value={a.plateforme_role} options={optionsRole} disabled={busy} onChange={e => definir(a.email, e.target.value, 'Rôle modifié.')} /> },
    { key: 'action', header: '', align: 'right', render: a => a.id === session?.user?.id ? null
      : <Button size="sm" tone="ghost" disabled={busy} onClick={() => definir(a.email, null, 'Agent retiré : il n\'a plus accès au back-office.')}>Retirer</Button> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')}>{msg}</AlertBanner>}

      <Panel title="Agents" meta={`${agents.length}`} flush>
        {agents.length ? <DataTable columns={cols} rows={agents} zebra={false} /> : <PanelEmpty icon="users" label="Aucun agent." />}
      </Panel>

      <Panel title="Ajouter un agent">
        <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--sp-4)' }}>
          La personne crée d'abord son compte sur l'écran de connexion (le code entreprise peut être quelconque). Saisissez ensuite son e-mail ici : son compte est validé et rattaché à l'équipe PumpIT.
        </p>
        <form onSubmit={ajouter} style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          <Field label="E-mail du compte" required style={{ flex: '1 1 260px', maxWidth: 380 }}><Input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Rôle"><Select value={f.role} options={optionsRole} onChange={e => setF({ ...f, role: e.target.value })} /></Field>
          <Button type="submit" tone="primary" disabled={busy}>Ajouter l'agent</Button>
        </form>
      </Panel>

      <Panel title="Ce que chaque rôle autorise">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
          {roles.map(r => (
            <div key={r.key}>
              <div style={{ font: '700 16px/1.3 var(--font-display)' }}>{r.label}</div>
              {r.description && <div style={{ font: '400 14px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: '2px 0 var(--sp-3)' }}>{r.description}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>{(r.permissions || []).map(p => <Tag key={p}>{PERMISSION[p] || p}</Tag>)}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
