import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { fcfa, frDate, today } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Drawer, DrawerRow } from '../ds/pumpit/components/feedback/Drawer.jsx'

const PERMISSION = {
  supervision: 'Supervision et statistiques', clients: 'Clients et essais', offres: 'Offres et fonctions', facturation: 'Factures et comptabilité',
  assistance: 'Assistance', ouvrir_client: 'Entrer chez un client', reglages: 'Réglages', agents: 'Équipe PumpIT', notifications: 'Notifications',
}
const PERMISSION_KEYS = Object.keys(PERMISSION)
const N = (v) => Number(v) || 0
const CONTRAT_TYPES = [{ value: 'cdi', label: 'CDI' }, { value: 'cdd', label: 'CDD' }, { value: 'essai', label: "Période d'essai" }, { value: 'prestataire', label: 'Prestataire' }]
const COMMISSION_TYPES = [{ value: 'aucune', label: 'Aucune' }, { value: 'recurrent', label: 'Récurrente (% de chaque facture)' }, { value: 'unique', label: 'Unique (% à la signature)' }]

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
  const [rhId, setRhId] = useState(null)       // agent ouvert dans le Drawer Fiche RH
  const [rhForm, setRhForm] = useState({})
  const [soldes, setSoldes] = useState({})      // {agent_id: {solde_du, total_du, total_verse}}
  const [commissionDetail, setCommissionDetail] = useState([])   // lignes de v_commission_commerciale pour l'agent ouvert
  const [versements, setVersements] = useState([])
  const [rb, setRb] = useState({ montant: '', periode: '', note: '' })

  const fail = (e) => { setMsg(''); setErr(e?.message || String(e)) }

  async function load() {
    const [a, r, sc] = await Promise.all([
      supabase.rpc('bo_agents'),
      supabase.from('plateforme_roles').select('*').order('ordre'),
      supabase.from('v_solde_commission_agent').select('*'),
    ])
    if (a.error) fail(a.error)
    setAgents(a.data || []); setRoles(r.data || [])
    setMatrice(Object.fromEntries((r.data || []).map(x => [x.key, new Set(x.permissions || [])])))
    setModifie(false)
    const sm = {}; for (const x of (sc.data || [])) sm[x.agent_id] = x; setSoldes(sm)
  }
  useEffect(() => { load() }, [])

  function openRh(a) {
    setRhId(a.id)
    setRhForm({
      salaire_mensuel: a.salaire_mensuel ?? '', commission_type: a.commission_type || 'aucune', commission_taux: a.commission_taux ?? '',
      contrat_type: a.contrat_type || '', contrat_fin: a.contrat_fin || '', cnss_declare: a.cnss_declare == null ? '' : String(a.cnss_declare),
      assurance_maladie_fin: a.assurance_maladie_fin || '', visite_medicale_le: a.visite_medicale_le || '', visite_medicale_mois: a.visite_medicale_mois || 12,
    })
    setRb({ montant: '', periode: '', note: '' })
    Promise.all([
      supabase.from('v_commission_commerciale').select('*').eq('agent_id', a.id).order('date_emission', { ascending: false }),
      supabase.from('agent_commission_versements').select('*').eq('agent_id', a.id).order('created_at', { ascending: false }),
    ]).then(([c, v]) => { setCommissionDetail(c.data || []); setVersements(v.data || []) })
  }
  async function saveRh() {
    const patch = {
      salaire_mensuel: rhForm.salaire_mensuel === '' ? null : N(rhForm.salaire_mensuel),
      commission_type: rhForm.commission_type || 'aucune',
      commission_taux: rhForm.commission_taux === '' ? null : N(rhForm.commission_taux),
      contrat_type: rhForm.contrat_type || null, contrat_fin: rhForm.contrat_fin || null,
      cnss_declare: rhForm.cnss_declare === '' ? null : rhForm.cnss_declare === 'true',
      assurance_maladie_fin: rhForm.assurance_maladie_fin || null, visite_medicale_le: rhForm.visite_medicale_le || null,
      visite_medicale_mois: N(rhForm.visite_medicale_mois) || 12,
    }
    const { error } = await supabase.from('profiles').update(patch).eq('id', rhId)
    if (error) { fail(error); return }
    setErr(''); setMsg('Fiche RH enregistrée'); setRhId(null); load()
  }
  async function addVersement(e) {
    e.preventDefault()
    if (!N(rb.montant)) return
    const { error } = await supabase.from('agent_commission_versements').insert({ agent_id: rhId, montant: N(rb.montant), periode: rb.periode || null, note: rb.note || null })
    if (error) { fail(error); return }
    setRb({ montant: '', periode: '', note: '' })
    const [c, v, sc] = await Promise.all([
      supabase.from('v_commission_commerciale').select('*').eq('agent_id', rhId).order('date_emission', { ascending: false }),
      supabase.from('agent_commission_versements').select('*').eq('agent_id', rhId).order('created_at', { ascending: false }),
      supabase.from('v_solde_commission_agent').select('*'),
    ])
    setCommissionDetail(c.data || []); setVersements(v.data || [])
    const sm = {}; for (const x of (sc.data || [])) sm[x.agent_id] = x; setSoldes(sm)
  }

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
    { key: 'solde', header: 'Commission', align: 'right', render: a => N(soldes[a.id]?.solde_du) > 0 ? <Badge tone="warn">{fcfa(soldes[a.id].solde_du)} dû</Badge> : null },
    { key: 'rh', header: '', align: 'right', render: a => <Button size="sm" onClick={() => openRh(a)}>Fiche RH</Button> },
    { key: 'action', header: '', align: 'right', render: a => a.id === session?.user?.id ? null
      : <Button size="sm" tone="ghost" disabled={busy} onClick={() => definir(a.email, null, 'Agent retiré : il n\'a plus accès au back-office.')}>Retirer</Button> },
  ]
  const rhAgent = agents.find(a => a.id === rhId)

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

      <Drawer open={!!rhId} onClose={() => setRhId(null)} title={rhAgent?.full_name || ''} meta="Fiche RH"
        status={N(soldes[rhId]?.solde_du) > 0 ? 'warn' : 'ok'}
        footer={<Button tone="primary" onClick={saveRh}>Enregistrer</Button>}>
        {rhAgent && <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', paddingTop: 'var(--sp-3)' }}>
            <Field label="Salaire mensuel (F)"><Input type="number" numeric value={rhForm.salaire_mensuel} onChange={e => setRhForm(p => ({ ...p, salaire_mensuel: e.target.value }))} /></Field>
            <Field label="Type de contrat">
              <Select value={rhForm.contrat_type} onChange={e => setRhForm(p => ({ ...p, contrat_type: e.target.value }))} style={{ width: '100%' }}
                options={[{ value: '', label: '— non renseigné —' }, ...CONTRAT_TYPES]} />
            </Field>
            {rhForm.contrat_type && rhForm.contrat_type !== 'cdi' && (
              <Field label="Fin de contrat"><Input type="date" value={rhForm.contrat_fin} onChange={e => setRhForm(p => ({ ...p, contrat_fin: e.target.value }))} /></Field>
            )}
            <Field label="CNSS déclaré">
              <Select value={rhForm.cnss_declare} onChange={e => setRhForm(p => ({ ...p, cnss_declare: e.target.value }))} style={{ width: '100%' }}
                options={[{ value: '', label: 'Non renseigné' }, { value: 'true', label: 'Oui' }, { value: 'false', label: 'Non' }]} />
            </Field>
            <Field label="Assurance maladie — expiration"><Input type="date" value={rhForm.assurance_maladie_fin} onChange={e => setRhForm(p => ({ ...p, assurance_maladie_fin: e.target.value }))} /></Field>
            <Field label="Dernière visite médicale"><Input type="date" value={rhForm.visite_medicale_le} onChange={e => setRhForm(p => ({ ...p, visite_medicale_le: e.target.value }))} /></Field>
            <Field label="Périodicité (mois)"><Input type="number" min="1" numeric value={rhForm.visite_medicale_mois} onChange={e => setRhForm(p => ({ ...p, visite_medicale_mois: e.target.value }))} /></Field>

            <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: 'var(--sp-3) 0 0' }}>Commission commerciale</p>
            <Field label="Type de commission">
              <Select value={rhForm.commission_type} onChange={e => setRhForm(p => ({ ...p, commission_type: e.target.value }))} style={{ width: '100%' }} options={COMMISSION_TYPES} />
            </Field>
            {rhForm.commission_type !== 'aucune' && (
              <Field label="Taux (%)"><Input type="number" numeric value={rhForm.commission_taux} onChange={e => setRhForm(p => ({ ...p, commission_taux: e.target.value }))} placeholder="ex : 5 ou 10" /></Field>
            )}
          </div>

          {rhForm.commission_type !== 'aucune' && <>
            <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: 'var(--sp-5) 0 var(--sp-2)' }}>Commissions calculées</p>
            {commissionDetail.length
              ? commissionDetail.map(c => <DrawerRow key={c.facture_id} mono={false} label={`${frDate(c.date_emission)} — ${c.organisation_nom} (${c.numero})`} value={fcfa(c.commission_montant)} />)
              : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Aucune facture éligible pour l'instant.</p>}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-2)', borderTop: '1px solid var(--border-hairline)', font: '600 14px/1.3 var(--font-ui)' }}>
              <span>Solde dû</span><span>{fcfa(soldes[rhId]?.solde_du || 0)}</span>
            </div>

            <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: 'var(--sp-5) 0 var(--sp-2)' }}>Versements reçus</p>
            {versements.length
              ? versements.map(v => <DrawerRow key={v.id} mono={false} status="ok" label={`${frDate(v.created_at?.slice(0, 10))}${v.periode ? ' · ' + v.periode : ''}${v.note ? ' · ' + v.note : ''}`} value={fcfa(v.montant)} />)
              : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Aucun versement enregistré.</p>}

            <form onSubmit={addVersement} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
              <Field label="Montant versé (F)" required><Input type="number" numeric value={rb.montant} onChange={e => setRb(p => ({ ...p, montant: e.target.value }))} /></Field>
              <Field label="Période (libre)"><Input value={rb.periode} onChange={e => setRb(p => ({ ...p, periode: e.target.value }))} placeholder="ex : 2026-05" /></Field>
              <Field label="Note"><Input value={rb.note} onChange={e => setRb(p => ({ ...p, note: e.target.value }))} /></Field>
              <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer le versement</Button>
            </form>
          </>}
        </>}
      </Drawer>
    </div>
  )
}
