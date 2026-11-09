import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'

const PERMISSION = {
  supervision: 'Supervision et statistiques', clients: 'Clients et essais', offres: 'Offres et fonctions', facturation: 'Factures et comptabilité',
  assistance: 'Assistance', ouvrir_client: 'Entrer chez un client', reglages: 'Réglages', agents: 'Équipe PumpIT', notifications: 'Notifications',
}
const PERMISSION_KEYS = Object.keys(PERMISSION)

// Équipe PumpIT : les personnes qui gèrent la plateforme, et ce que chaque rôle autorise.
export default function Agents() {
  const { session } = useAuth()
  const [agents, setAgents] = useState([])
  const [roles, setRoles] = useState([])
  const [matrice, setMatrice] = useState({})   // role_key -> Set des permissions cochées (brouillon)
  const [modifie, setModifie] = useState(false)
  const [f, setF] = useState({ email: '', role: 'support' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const fail = (e) => { setMsg(''); setErr(e?.message || String(e)) }

  async function load() {
    const [a, r] = await Promise.all([supabase.rpc('bo_agents'), supabase.from('plateforme_roles').select('*').order('ordre')])
    if (a.error) fail(a.error)
    setAgents(a.data || []); setRoles(r.data || [])
    setMatrice(Object.fromEntries((r.data || []).map(x => [x.key, new Set(x.permissions || [])])))
    setModifie(false)
  }
  useEffect(() => { load() }, [])

  function basculerPermission(roleKey, perm) {
    setMatrice(m => { const s = new Set(m[roleKey]); s.has(perm) ? s.delete(perm) : s.add(perm); return { ...m, [roleKey]: s } })
    setModifie(true)
  }
  async function enregistrerMatrice() {
    for (const r of roles) {
      const { error } = await supabase.from('plateforme_roles').update({ permissions: [...(matrice[r.key] || [])] }).eq('key', r.key)
      if (error) return fail(error)
    }
    setErr(''); setMsg('Permissions enregistrées. Elles s\'appliquent à la prochaine connexion des agents concernés.')
    await load()
  }

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

      <Panel title="Ce que chaque rôle autorise" actions={modifie && <Button size="sm" tone="primary" onClick={enregistrerMatrice}>Enregistrer</Button>}>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Cochez les droits de chaque rôle — s'applique à la prochaine connexion des agents concernés. super_admin garde toujours tous les droits en pratique (vérifié côté code), mais reste modifiable ici comme les autres.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', font: '400 14px/1.3 var(--font-ui)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 'var(--sp-2) var(--sp-3)', borderBottom: '1px solid var(--border-hairline)' }}>Rôle</th>
                {PERMISSION_KEYS.map(p => (
                  <th key={p} style={{ textAlign: 'center', padding: 'var(--sp-2) var(--sp-3)', borderBottom: '1px solid var(--border-hairline)', font: '600 12px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>{PERMISSION[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map(r => (
                <tr key={r.key}>
                  <td style={{ padding: 'var(--sp-3)', borderBottom: '1px solid var(--border-hairline)' }}>
                    <div style={{ font: '700 14px/1.3 var(--font-ui)' }}>{r.label}</div>
                    {r.description && <div style={{ font: '400 12px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>{r.description}</div>}
                  </td>
                  {PERMISSION_KEYS.map(p => (
                    <td key={p} style={{ textAlign: 'center', padding: 'var(--sp-3)', borderBottom: '1px solid var(--border-hairline)' }}>
                      <Checkbox checked={!!matrice[r.key]?.has(p)} onChange={() => basculerPermission(r.key, p)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
