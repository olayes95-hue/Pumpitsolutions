import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { frDate } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'

// Catalogue des déclencheurs gérés par la fonction planifiée notification-poller (voir
// supabase/functions/notification-poller) — ajouter ici un déclencheur ne suffit pas, il faut
// aussi coder sa détection côté poller.
const TRIGGERS = [
  { key: 'user_signup', label: 'Nouvelle inscription', vars: ['nom', 'email'], destType: 'evenement' },
  { key: 'alerte_haute', label: 'Alerte haute gravité (toute station)', vars: ['station', 'type', 'detail', 'date'], destType: 'fixe' },
]
const blank = () => ({ trigger_key: 'user_signup', nom: '', destinataires_type: 'evenement', destinataires_emails: '', sujet: '', corps_html: '', actif: true })

// Notifications (Brevo) — back-office PumpIT uniquement. Un admin définit ici qui reçoit quoi,
// à quel événement ; l'envoi réel est fait côté serveur par notification-poller + send-notification
// (clé Brevo jamais exposée au navigateur).
export default function Notifications() {
  const [regles, setRegles] = useState([])
  const [log, setLog] = useState([])
  const [f, setF] = useState(blank())
  const [editId, setEditId] = useState(null)
  const [testEmail, setTestEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    const [r, l] = await Promise.all([
      supabase.from('notification_rules').select('*').order('id', { ascending: false }),
      supabase.from('notification_log').select('*').order('envoye_at', { ascending: false }).limit(100),
    ])
    setRegles(r.data || []); setLog(l.data || [])
  }
  useEffect(() => { load() }, [])

  const fail = (e) => { setMsg(''); setErr(e?.message || String(e)) }
  const ok = (m) => { setErr(''); setMsg(m) }

  function editer(r) {
    setEditId(r.id)
    setF({
      trigger_key: r.trigger_key, nom: r.nom,
      destinataires_type: r.destinataires?.type || 'evenement',
      destinataires_emails: (r.destinataires?.emails || []).join(', '),
      sujet: r.sujet, corps_html: r.corps_html, actif: r.actif,
    })
  }
  function nouveau() { setEditId(null); setF(blank()) }

  async function enregistrer(e) {
    e.preventDefault(); setBusy(true)
    const destinataires = f.destinataires_type === 'fixe'
      ? { type: 'fixe', emails: f.destinataires_emails.split(',').map(s => s.trim()).filter(Boolean) }
      : { type: 'evenement', champ: 'email' }
    const payload = { trigger_key: f.trigger_key, nom: f.nom, destinataires, sujet: f.sujet, corps_html: f.corps_html, actif: f.actif, updated_at: new Date().toISOString() }
    const { error } = editId
      ? await supabase.from('notification_rules').update(payload).eq('id', editId)
      : await supabase.from('notification_rules').insert(payload)
    setBusy(false)
    if (error) return fail(error)
    ok(editId ? 'Règle modifiée.' : 'Règle créée.'); nouveau(); load()
  }
  async function supprimer(r) {
    setBusy(true)
    const { error } = await supabase.from('notification_rules').delete().eq('id', r.id)
    setBusy(false)
    if (error) return fail(error)
    ok('Règle supprimée.'); load()
  }
  async function toggleActif(r) {
    const { error } = await supabase.from('notification_rules').update({ actif: !r.actif }).eq('id', r.id)
    if (error) return fail(error)
    load()
  }
  async function tester() {
    if (!testEmail.trim()) return fail('Indique une adresse pour le test.')
    setBusy(true); setErr(''); setMsg('')
    const trigger = TRIGGERS.find(t => t.key === f.trigger_key)
    const vars = Object.fromEntries((trigger?.vars || []).map(v => [v, `[${v}]`]))
    const { data, error } = await supabase.functions.invoke('send-notification', {
      body: { trigger_key: f.trigger_key, destinataire_email: testEmail.trim(), sujet: f.sujet, corps_html: f.corps_html, variables: vars },
    })
    setBusy(false)
    if (error || data?.error) return fail(error || data.error)
    ok('E-mail de test envoyé à ' + testEmail.trim() + '.'); load()
  }

  const trigger = TRIGGERS.find(t => t.key === f.trigger_key)

  const cols = [
    { key: 'nom', header: 'Règle', render: r => <b style={{ fontWeight: 600 }}>{r.nom}</b> },
    { key: 'trigger_key', header: 'Déclencheur', render: r => TRIGGERS.find(t => t.key === r.trigger_key)?.label || r.trigger_key },
    { key: 'destinataires', header: 'Destinataires', muted: true, render: r => r.destinataires?.type === 'fixe' ? (r.destinataires.emails || []).join(', ') : "la personne concernée par l'événement" },
    { key: 'actif', header: 'État', render: r => <Badge tone={r.actif ? 'ok' : 'idle'}>{r.actif ? 'Active' : 'Désactivée'}</Badge> },
    { key: 'actions', header: '', align: 'right', render: r => (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <Button size="sm" onClick={() => toggleActif(r)}>{r.actif ? 'Désactiver' : 'Activer'}</Button>
        <Button size="sm" onClick={() => editer(r)}>Modifier</Button>
        <Button size="sm" tone="danger" onClick={() => supprimer(r)}>Supprimer</Button>
      </div>
    ) },
  ]
  const logCols = [
    { key: 'envoye_at', header: 'Date', render: l => frDate(l.envoye_at?.slice(0, 10)) + ' ' + (l.envoye_at?.slice(11, 16) || '') },
    { key: 'trigger_key', header: 'Déclencheur' },
    { key: 'destinataire_email', header: 'Destinataire', muted: true },
    { key: 'sujet', header: 'Sujet', muted: true },
    { key: 'statut', header: 'Statut', render: l => <Badge tone={l.statut === 'envoye' ? 'ok' : 'alarm'}>{l.statut === 'envoye' ? '✓ Envoyé' : '✗ Échec'}</Badge> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')}>{msg}</AlertBanner>}

      <Panel title="Règles de notification" meta={`${regles.length}`} flush>
        {regles.length ? <DataTable columns={cols} rows={regles} zebra={false} /> : <PanelEmpty icon="bell" label="Aucune règle — crée la première ci-dessous." />}
      </Panel>

      <Panel title={editId ? 'Modifier la règle' : 'Nouvelle règle'}>
        <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <Field label="Nom (interne)" style={{ flex: '1 1 220px' }}><Input value={f.nom} onChange={e => setF({ ...f, nom: e.target.value })} placeholder="ex. Bienvenue nouvel inscrit" /></Field>
            <Field label="Déclencheur" style={{ flex: '1 1 220px' }}>
              <Select value={f.trigger_key} onChange={e => setF({ ...f, trigger_key: e.target.value })} options={TRIGGERS.map(t => ({ value: t.key, label: t.label }))} style={{ width: '100%' }} />
            </Field>
          </div>

          <Field label="Destinataires">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <input type="radio" checked={f.destinataires_type === 'evenement'} onChange={() => setF({ ...f, destinataires_type: 'evenement' })} />
                La personne concernée par l'événement (ex. le nouvel inscrit)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <input type="radio" checked={f.destinataires_type === 'fixe'} onChange={() => setF({ ...f, destinataires_type: 'fixe' })} />
                Liste fixe d'adresses
              </label>
              {f.destinataires_type === 'fixe' && (
                <Input value={f.destinataires_emails} onChange={e => setF({ ...f, destinataires_emails: e.target.value })} placeholder="a@pumpit.app, b@pumpit.app" />
              )}
            </div>
          </Field>

          <Field label="Sujet"><Input value={f.sujet} onChange={e => setF({ ...f, sujet: e.target.value })} placeholder="Bienvenue sur PumpIT, {{nom}} !" /></Field>
          <Field label="Corps (HTML)" hint={`Variables disponibles pour « ${trigger?.label} » : ${(trigger?.vars || []).map(v => `{{${v}}}`).join(', ')}`}>
            <textarea value={f.corps_html} onChange={e => setF({ ...f, corps_html: e.target.value })} rows={6}
              style={{ width: '100%', padding: 'var(--sp-3)', font: '400 14px/1.5 var(--font-ui)', border: '1.5px solid var(--border-default)', borderRadius: 'var(--radius-1)', resize: 'vertical' }} />
          </Field>

          <Checkbox label="Règle active" checked={f.actif} onChange={v => setF({ ...f, actif: v })} />

          <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button type="submit" tone="primary" disabled={busy}>{editId ? 'Enregistrer' : 'Créer la règle'}</Button>
            {editId && <Button type="button" onClick={nouveau}>Annuler</Button>}
            <span style={{ flex: 1 }} />
            <Input placeholder="adresse de test" value={testEmail} onChange={e => setTestEmail(e.target.value)} style={{ maxWidth: 220 }} />
            <Button type="button" disabled={busy || !f.sujet || !f.corps_html} onClick={tester}>Envoyer un test</Button>
          </div>
        </form>
      </Panel>

      <Panel title="Historique d'envoi" meta={`${log.length} (100 derniers)`} flush>
        {log.length ? <DataTable columns={logCols} rows={log} zebra={false} /> : <PanelEmpty icon="bell" label="Aucun envoi pour le moment." />}
      </Panel>
    </div>
  )
}
