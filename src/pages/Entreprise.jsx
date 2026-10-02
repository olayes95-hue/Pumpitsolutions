import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { usePlateforme, STATUT_FACTURE } from '../lib/plateforme'
import { fcfa, frDate, today } from '../lib/format'
import FactureSheet from '../components/FactureSheet.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'

// Page « Entreprise » de l'administrateur d'un client : code d'invitation à donner aux
// employés, état de l'abonnement, factures. La gestion des clients elle-même est dans le
// back-office (/admin).
// `facturesSeules` : version réduite affichée sur l'écran « Accès suspendu ».
export default function Entreprise({ facturesSeules = false }) {
  const { organisation } = useAuth()
  const emetteur = usePlateforme()
  const [formules, setFormules] = useState([])
  const [factures, setFactures] = useState([])
  const [aImprimer, setAImprimer] = useState(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!organisation?.id) return
    supabase.from('formules').select('*').order('ordre').then(({ data }) => setFormules(data || []))
    supabase.from('factures').select('*').eq('organisation_id', organisation.id).order('date_emission', { ascending: false })
      .then(({ data }) => setFactures(data || []))
  }, [organisation?.id])

  async function copyCode() {
    try { await navigator.clipboard.writeText(organisation.code_invitation); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setErr('Copie impossible. Sélectionnez le code à la main.') }
  }

  const formule = formules.find(f => f.key === organisation?.formule)
  const enRetard = organisation?.abonnement_jusqu_au && organisation.abonnement_jusqu_au < today()
  const suspendu = organisation?.statut === 'suspendu'

  const cols = [
    { key: 'numero', header: 'Facture', render: f => <b style={{ fontWeight: 600 }}>{f.numero}</b> },
    { key: 'periode', header: 'Période', optional: '1', render: f => `${frDate(f.periode_debut)} au ${frDate(f.periode_fin)}` },
    { key: 'montant_ttc', header: 'Montant', numeric: true, align: 'right', render: f => fcfa(f.montant_ttc) },
    { key: 'statut', header: 'État', render: f => { const s = STATUT_FACTURE[f.statut] || STATUT_FACTURE.emise; return <Badge tone={s.tone}>{s.label}</Badge> } },
    { key: 'action', header: '', align: 'right', render: f => <Button size="sm" icon="printer" onClick={() => setAImprimer(f)}>Imprimer</Button> },
  ]

  const abonnement = (
    <Panel title="Abonnement" status={suspendu ? 'alarm' : enRetard ? 'warn' : undefined} flush>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-7)', padding: '0 var(--gutter-panel) var(--sp-5)' }}>
        <Info label="Formule" value={formule ? formule.label : (organisation?.formule || '—')} sub={formule ? `${fcfa(formule.prix_mensuel)} par mois` : undefined} />
        <Info label="État" value={<Badge tone={suspendu ? 'alarm' : 'ok'}>{suspendu ? 'Suspendu' : 'Actif'}</Badge>} />
        <Info label="Réglé jusqu'au" value={organisation?.abonnement_jusqu_au ? frDate(organisation.abonnement_jusqu_au) : '—'} sub={enRetard && !suspendu ? 'Échéance dépassée' : undefined} alarm={enRetard} />
      </div>
      {factures.length ? <DataTable columns={cols} rows={factures} zebra={false} /> : <PanelEmpty icon="receipt" label="Aucune facture pour le moment." />}
    </Panel>
  )

  if (facturesSeules) return <>{abonnement}<FactureSheet facture={aImprimer} client={organisation} emetteur={emetteur} onDone={() => setAImprimer(null)} /></>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}

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
      </Panel>

      {abonnement}
      <FactureSheet facture={aImprimer} client={organisation} emetteur={emetteur} onDone={() => setAImprimer(null)} />
    </div>
  )
}

function Info({ label, value, sub, alarm }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ font: '500 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ font: '800 20px/1.2 var(--font-display)', color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ font: '400 13px/1.3 var(--font-ui)', color: alarm ? 'var(--state-alarm)' : 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
