import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { frDate } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'

// Catalogue des déclencheurs gérés par notification-poller (voir ce fichier pour le détail de
// la détection de chaque trigger) — en ajouter un ici ne suffit pas, il faut aussi coder sa
// détection côté poller. destType = option de destinataires par défaut pour ce déclencheur.
const TRIGGERS = [
  { key: 'user_signup', label: 'Nouvelle inscription', vars: ['nom', 'email'], destType: 'evenement' },
  { key: 'compte_a_valider', label: 'Compte employé en attente de validation', vars: ['nom', 'email'], destType: 'roles_client' },
  { key: 'compte_retire', label: 'Accès compte retiré', vars: ['nom', 'email'], destType: 'roles_client' },
  { key: 'client_suspendu', label: 'Client suspendu', vars: ['station'], destType: 'roles_client' },
  { key: 'versement_manquant', label: 'Versement manquant', vars: ['station', 'date', 'detail'], destType: 'roles_client' },
  { key: 'versement_incomplet', label: 'Versement incomplet', vars: ['station', 'date', 'detail'], destType: 'roles_client' },
  { key: 'ecart_caisse', label: 'Écart de caisse', vars: ['station', 'date', 'detail'], destType: 'roles_client' },
  { key: 'ecart_compteur', label: 'Écart de compteur carburant', vars: ['station', 'date', 'detail'], destType: 'roles_client' },
  { key: 'ecart_stock', label: 'Écart de stock', vars: ['station', 'date', 'detail'], destType: 'roles_client' },
  { key: 'stock_bas', label: 'Stock bas', vars: ['station', 'date', 'detail'], destType: 'roles_client' },
  { key: 'point_manquant', label: 'Journée non saisie', vars: ['station', 'date'], destType: 'roles_client' },
  { key: 'releve_compteur_manquant', label: 'Relevé compteur manquant', vars: ['station', 'date', 'detail'], destType: 'roles_client' },
  { key: 'depense_non_justifiee', label: 'Dépense non justifiée', vars: ['station', 'date', 'detail'], destType: 'roles_client' },
  { key: 'commande_a_valider', label: 'Commande à valider', vars: ['station', 'produit', 'quantite', 'date', 'gerant'], destType: 'roles_client' },
  { key: 'commande_statut', label: 'Commande validée ou refusée', vars: ['station', 'produit', 'statut', 'valideur'], destType: 'evenement' },
  { key: 'reception_ecart', label: 'Écart à la réception', vars: ['station', 'produit', 'quantite_commandee', 'quantite_recue'], destType: 'roles_client' },
  { key: 'essai_j3', label: 'Essai se termine dans 3 jours', vars: ['station', 'date_fin'], destType: 'roles_client' },
  { key: 'essai_termine', label: 'Essai terminé', vars: ['station', 'date_fin'], destType: 'roles_client' },
  { key: 'facture_emise', label: 'Facture émise', vars: ['numero', 'montant', 'periode_debut', 'periode_fin'], destType: 'roles_client' },
  { key: 'facture_retard', label: 'Facture en retard', vars: ['numero', 'montant', 'date_emission'], destType: 'roles_client' },
]
const FONCTIONS = [
  { value: '', label: 'Aucune (toutes les offres)' },
  { value: 'alertes_completes', label: 'alertes_completes' },
  { value: 'prevision', label: 'prevision' },
  { value: 'finance', label: 'finance' },
  { value: 'bordereaux', label: 'bordereaux' },
  { value: 'export', label: 'export' },
  { value: 'audit', label: 'audit' },
]
const FORMULE_KEYS = ['essentiel', 'pro', 'complet']
const ROLES_DISPONIBLES = ['admin', 'directeur', 'gerant', 'comptable']
const blank = () => ({
  trigger_key: 'versement_manquant', nom: '', destinataires_type: 'roles_client', destinataires_emails: '', destinataires_roles: ['admin', 'directeur'],
  sujet: '', corps_html: '', actif: true, requiert_fonction: '', formules: [],
})

// Notifications (Brevo) — back-office PumpIT uniquement. Un admin définit ici qui reçoit quoi,
// à quel événement, pour quelles offres ; l'envoi réel est fait côté serveur par
// notification-poller + send-notification (clé Brevo jamais exposée au navigateur).
export default function Notifications() {
  const [regles, setRegles] = useState([])
  const [log, setLog] = useState([])
  const [f, setF] = useState(blank())
  const [editId, setEditId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [filtreTrigger, setFiltreTrigger] = useState('tous')
  const [filtreActif, setFiltreActif] = useState('tous')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const formRef = useRef(null)

  async function load() {
    const [r, l] = await Promise.all([
      supabase.from('notification_rules').select('*').order('id', { ascending: false }),
      supabase.from('notification_log').select('*').order('envoye_at', { ascending: false }).limit(100),
    ])
    setRegles(r.data || []); setLog(l.data || [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setPage(1) }, [filtreTrigger, filtreActif])

  const fail = (e) => { setMsg(''); setErr(e?.message || String(e)) }
  const ok = (m) => { setErr(''); setMsg(m) }

  function editer(r) {
    setEditId(r.id)
    setF({
      trigger_key: r.trigger_key, nom: r.nom,
      destinataires_type: r.destinataires?.type || 'evenement',
      destinataires_emails: (r.destinataires?.emails || []).join(', '),
      destinataires_roles: r.destinataires?.roles || ['admin', 'directeur'],
      sujet: r.sujet, corps_html: r.corps_html, actif: r.actif,
      requiert_fonction: r.requiert_fonction || '', formules: r.formules || [],
    })
    setShowForm(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  function nouveau() {
    setEditId(null); setF(blank())
    setShowForm(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  function fermerForm() { setShowForm(false); setEditId(null); setF(blank()) }

  async function enregistrer(e) {
    e.preventDefault(); setBusy(true)
    const destinataires = f.destinataires_type === 'fixe'
      ? { type: 'fixe', emails: f.destinataires_emails.split(',').map(s => s.trim()).filter(Boolean) }
      : f.destinataires_type === 'roles_client'
      ? { type: 'roles_client', roles: f.destinataires_roles }
      : { type: 'evenement', champ: 'email' }
    const payload = {
      trigger_key: f.trigger_key, nom: f.nom, destinataires, sujet: f.sujet, corps_html: f.corps_html, actif: f.actif,
      requiert_fonction: f.requiert_fonction || null, formules: f.formules.length ? f.formules : null,
      updated_at: new Date().toISOString(),
    }
    const { error } = editId
      ? await supabase.from('notification_rules').update(payload).eq('id', editId)
      : await supabase.from('notification_rules').insert(payload)
    setBusy(false)
    if (error) return fail(error)
    ok(editId ? 'Règle modifiée.' : 'Règle créée.'); fermerForm(); load()
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
  const toggleRole = (role) => setF(p => ({ ...p, destinataires_roles: p.destinataires_roles.includes(role) ? p.destinataires_roles.filter(r => r !== role) : [...p.destinataires_roles, role] }))
  const toggleFormule = (k) => setF(p => ({ ...p, formules: p.formules.includes(k) ? p.formules.filter(x => x !== k) : [...p.formules, k] }))

  const reglesFiltrees = regles.filter(r =>
    (filtreTrigger === 'tous' || r.trigger_key === filtreTrigger)
    && (filtreActif === 'tous' || (filtreActif === 'actif' ? r.actif : !r.actif)))
  const pageCount = Math.max(1, Math.ceil(reglesFiltrees.length / pageSize))
  const pageClamped = Math.min(page, pageCount)
  const reglesPage = reglesFiltrees.slice((pageClamped - 1) * pageSize, pageClamped * pageSize)

  const cols = [
    { key: 'nom', header: 'Règle', render: r => <b style={{ fontWeight: 600 }}>{r.nom}</b> },
    { key: 'trigger_key', header: 'Déclencheur', render: r => TRIGGERS.find(t => t.key === r.trigger_key)?.label || r.trigger_key },
    { key: 'destinataires', header: 'Destinataires', muted: true, render: r => r.destinataires?.type === 'fixe' ? (r.destinataires.emails || []).join(', ')
      : r.destinataires?.type === 'roles_client' ? (r.destinataires.roles || []).join(', ') : "la personne concernée" },
    { key: 'offre', header: 'Offres', render: r => r.formules?.length ? r.formules.map(k => <Tag key={k}>{k}</Tag>)
      : r.requiert_fonction ? <Tag>{r.requiert_fonction}</Tag> : <span style={{ color: 'var(--text-muted)' }}>Toutes</span> },
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

      <Panel title="Règles de notification" meta={`${reglesFiltrees.length}/${regles.length}`} flush
        actions={<Button size="sm" tone="primary" onClick={nouveau}>+ Nouvelle règle</Button>}>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
          <Select size="sm" value={filtreTrigger} onChange={e => setFiltreTrigger(e.target.value)}
            options={[{ value: 'tous', label: 'Tous déclencheurs' }, ...TRIGGERS.map(t => ({ value: t.key, label: t.label }))]} />
          <Select size="sm" value={filtreActif} onChange={e => setFiltreActif(e.target.value)}
            options={[{ value: 'tous', label: 'Tous états' }, { value: 'actif', label: 'Actives' }, { value: 'inactif', label: 'Désactivées' }]} />
        </div>
        <div style={{ marginTop: 'var(--sp-4)' }}>
          {reglesPage.length ? <DataTable columns={cols} rows={reglesPage} zebra={false} /> : <PanelEmpty icon="bell" label={regles.length ? 'Aucune règle ne correspond à ce filtre.' : 'Aucune règle — crée la première avec le bouton ci-dessus.'} />}
        </div>
        <Pagination page={pageClamped} pageCount={pageCount} total={reglesFiltrees.length} pageSize={pageSize} onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />
      </Panel>

      {showForm && <Panel title={editId ? 'Modifier la règle' : 'Nouvelle règle'} sectionRef={formRef}>
        <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <Field label="Nom (interne)" style={{ flex: '1 1 220px' }}><Input value={f.nom} onChange={e => setF({ ...f, nom: e.target.value })} placeholder="ex. Versement manquant" /></Field>
            <Field label="Déclencheur" style={{ flex: '1 1 260px' }}>
              <Select value={f.trigger_key} onChange={e => setF({ ...f, trigger_key: e.target.value })} options={TRIGGERS.map(t => ({ value: t.key, label: t.label }))} style={{ width: '100%' }} />
            </Field>
          </div>

          <Field label="Destinataires">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <input type="radio" checked={f.destinataires_type === 'evenement'} onChange={() => setF({ ...f, destinataires_type: 'evenement' })} />
                La personne concernée par l'événement
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <input type="radio" checked={f.destinataires_type === 'roles_client'} onChange={() => setF({ ...f, destinataires_type: 'roles_client' })} />
                Rôles du client concerné (admin/directeur de la station ou de l'organisation)
              </label>
              {f.destinataires_type === 'roles_client' && (
                <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', marginLeft: 'var(--sp-7)' }}>
                  {ROLES_DISPONIBLES.map(role => <Checkbox key={role} label={role} checked={f.destinataires_roles.includes(role)} onChange={() => toggleRole(role)} />)}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <input type="radio" checked={f.destinataires_type === 'fixe'} onChange={() => setF({ ...f, destinataires_type: 'fixe' })} />
                Liste fixe d'adresses
              </label>
              {f.destinataires_type === 'fixe' && (
                <Input value={f.destinataires_emails} onChange={e => setF({ ...f, destinataires_emails: e.target.value })} placeholder="a@pumpit.app, b@pumpit.app" style={{ marginLeft: 'var(--sp-7)' }} />
              )}
            </div>
          </Field>

          <Field label="Sujet"><Input value={f.sujet} onChange={e => setF({ ...f, sujet: e.target.value })} placeholder="⚠️ Versement manquant — {{station}}" /></Field>
          <Field label="Corps (HTML)" hint={`Variables disponibles pour « ${trigger?.label} » : ${(trigger?.vars || []).map(v => `{{${v}}}`).join(', ')} — l'en-tête (logo), « Bonjour, » et le pied de page sont ajoutés automatiquement.`}>
            <textarea value={f.corps_html} onChange={e => setF({ ...f, corps_html: e.target.value })} rows={6}
              style={{ width: '100%', padding: 'var(--sp-3)', font: '400 14px/1.5 var(--font-ui)', border: '1.5px solid var(--border-default)', borderRadius: 'var(--radius-1)', resize: 'vertical' }} />
          </Field>

          <Field label="Limiter à une offre (optionnel)" hint="Vide = la règle s'applique à toutes les offres. Choisis soit une fonction, soit des offres précises — pas besoin des deux.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <Select value={f.requiert_fonction} onChange={e => setF({ ...f, requiert_fonction: e.target.value })} options={FONCTIONS} style={{ maxWidth: 280 }} />
              <div style={{ display: 'flex', gap: 'var(--sp-4)' }}>
                {FORMULE_KEYS.map(k => <Checkbox key={k} label={k} checked={f.formules.includes(k)} onChange={() => toggleFormule(k)} />)}
              </div>
            </div>
          </Field>

          <Checkbox label="Règle active" checked={f.actif} onChange={v => setF({ ...f, actif: v })} />

          <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button type="submit" tone="primary" disabled={busy}>{editId ? 'Enregistrer' : 'Créer la règle'}</Button>
            <Button type="button" onClick={fermerForm}>Annuler</Button>
            <span style={{ flex: 1 }} />
            <Input placeholder="adresse de test" value={testEmail} onChange={e => setTestEmail(e.target.value)} style={{ maxWidth: 220 }} />
            <Button type="button" disabled={busy || !f.sujet || !f.corps_html} onClick={tester}>Envoyer un test</Button>
          </div>
        </form>
      </Panel>}

      <Panel title="Historique d'envoi" meta={`${log.length} (100 derniers)`} flush>
        {log.length ? <DataTable columns={logCols} rows={log} zebra={false} /> : <PanelEmpty icon="bell" label="Aucun envoi pour le moment." />}
      </Panel>
    </div>
  )
}
