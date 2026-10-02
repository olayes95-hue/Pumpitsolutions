import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { frDate } from '../lib/format'

// Entreprise (pour l'administrateur d'un client) et Clients (pour l'administrateur de la
// plateforme). Le cloisonnement des données est assuré par la base : cette page ne fait
// qu'afficher ce que le RLS laisse voir et appeler les fonctions create_organisation,
// switch_organisation et assign_organisation.
export default function Entreprise() {
  const { organisation, isPlatformAdmin, refreshProfile } = useAuth()
  const [orgs, setOrgs] = useState([])
  const [orphans, setOrphans] = useState([])
  const [target, setTarget] = useState({})
  const [nom, setNom] = useState('')
  const [rename, setRename] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function load() {
    if (!isPlatformAdmin) return
    const [o, p] = await Promise.all([
      supabase.from('organisations').select('*').order('nom'),
      supabase.from('profiles').select('id, full_name, created_at').is('organisation_id', null).order('created_at', { ascending: false }),
    ])
    setOrgs(o.data || [])
    setOrphans(p.data || [])
  }
  useEffect(() => { load() }, [isPlatformAdmin])
  useEffect(() => { setRename(organisation?.nom || '') }, [organisation?.nom])

  const fail = (error) => { setMsg(''); setErr(error?.message || String(error)) }

  async function copyCode() {
    try { await navigator.clipboard.writeText(organisation.code_invitation); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { fail('Copie impossible. Sélectionnez le code à la main.') }
  }

  async function create(e) {
    e.preventDefault(); setErr(''); setMsg('')
    if (!nom.trim()) { setErr('Renseignez le nom du client.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('create_organisation', { p_nom: nom.trim() })
    setBusy(false)
    if (error) return fail(error)
    setNom(''); setMsg(`Client créé. Code d'invitation : ${data?.code_invitation || ''}`); load()
  }

  // Changer de client recharge toute l'application : aucune donnée de l'ancien client ne reste en mémoire.
  async function open(o) {
    setErr(''); setBusy(true)
    const { error } = await supabase.rpc('switch_organisation', { p_org: o.id })
    if (error) { setBusy(false); return fail(error) }
    window.location.assign('/')
  }

  async function saveName(e) {
    e.preventDefault(); setErr(''); setMsg('')
    if (!rename.trim()) return
    const { error } = await supabase.from('organisations').update({ nom: rename.trim() }).eq('id', organisation.id)
    if (error) return fail(error)
    setMsg('Nom enregistré.'); await refreshProfile(); load()
  }

  async function assign(p) {
    setErr(''); setMsg('')
    const org = Number(target[p.id])
    if (!org) { setErr('Choisissez le client auquel rattacher ce compte.'); return }
    const { error } = await supabase.rpc('assign_organisation', { p_profile: p.id, p_org: org })
    if (error) return fail(error)
    setMsg('Compte rattaché. L\'administrateur du client peut maintenant le valider.'); load()
  }

  const orgCols = [
    { key: 'nom', header: 'Client', render: o => <b style={{ fontWeight: 600 }}>{o.nom}</b> },
    { key: 'code_invitation', header: 'Code d\'invitation', numeric: true },
    { key: 'created_at', header: 'Créé le', optional: '1', muted: true, render: o => frDate(String(o.created_at).slice(0, 10)) },
    { key: 'action', header: '', align: 'right', render: o => o.id === organisation?.id
      ? <Badge tone="ok">Client ouvert</Badge>
      : <Button size="sm" tone="dark" disabled={busy} onClick={() => open(o)}>Ouvrir</Button> },
  ]
  const orphanCols = [
    { key: 'full_name', header: 'Compte' },
    { key: 'created_at', header: 'Inscrit le', optional: '1', muted: true, render: p => frDate(String(p.created_at).slice(0, 10)) },
    { key: 'org', header: 'Client', render: p => <Select size="sm" value={target[p.id] || ''} onChange={e => setTarget(t => ({ ...t, [p.id]: e.target.value }))}
      options={[{ value: '', label: 'Choisir…' }, ...orgs.map(o => ({ value: o.id, label: o.nom }))]} /> },
    { key: 'action', header: '', align: 'right', render: p => <Button size="sm" tone="dark" onClick={() => assign(p)}>Rattacher</Button> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')}>{msg}</AlertBanner>}

      <Panel title={organisation?.nom || 'Votre entreprise'}>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--sp-4)' }}>
          Donnez ce code à chaque nouvel employé. Il le saisit en créant son compte, puis vous validez le compte dans Stations et équipe.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          <span style={{ font: '800 32px/1.1 var(--font-display)', letterSpacing: '.06em', padding: 'var(--sp-4) var(--sp-6)', background: 'var(--brume)', borderRadius: 'var(--radius-2)', userSelect: 'all' }}>
            {organisation?.code_invitation || '—'}
          </span>
          <Button tone="dark" icon={copied ? 'check' : undefined} disabled={!organisation} onClick={copyCode}>{copied ? 'Code copié' : 'Copier le code'}</Button>
        </div>
        {isPlatformAdmin && organisation && (
          <form onSubmit={saveName} style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-4)', marginTop: 'var(--sp-6)' }}>
            <Field label="Nom du client" style={{ flex: '1 1 240px', maxWidth: 420 }}>
              <Input value={rename} onChange={e => setRename(e.target.value)} />
            </Field>
            <Button type="submit">Renommer</Button>
          </form>
        )}
      </Panel>

      {isPlatformAdmin && (
        <>
          <Panel title="Clients" meta={`${orgs.length} au total`} flush>
            {orgs.length ? <DataTable columns={orgCols} rows={orgs} zebra={false} /> : <PanelEmpty label="Aucun client." />}
          </Panel>

          <Panel title="Nouveau client">
            <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--sp-4)' }}>
              Les réglages du client ouvert (prix, marges, seuils) sont copiés. L'administrateur du nouveau client s'inscrit avec le code, puis vous ouvrez ce client pour valider son compte et créer sa première station.
            </p>
            <form onSubmit={create} style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
              <Field label="Nom du client" required style={{ flex: '1 1 240px', maxWidth: 420 }}>
                <Input value={nom} onChange={e => setNom(e.target.value)} placeholder="ex : Stations Dossou" />
              </Field>
              <Button type="submit" tone="primary" disabled={busy}>Créer le client</Button>
            </form>
          </Panel>

          {orphans.length > 0 && (
            <Panel title="Comptes sans entreprise" meta="code d'invitation absent ou erroné à l'inscription" status="warn" flush>
              <DataTable columns={orphanCols} rows={orphans} zebra={false} />
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
