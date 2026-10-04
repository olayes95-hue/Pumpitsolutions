import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { usePlateforme } from '../lib/plateforme'
import { fcfa } from '../lib/format'
import { etatClient, ouvrirClient, il_y_a } from './outils'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { MetricTile } from '../ds/pumpit/components/data/MetricTile.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

// Supervision : l'état de chaque client en une ligne, sans avoir à l'ouvrir.
// Les chiffres viennent de la fonction bo_supervision(), qui ne renvoie que des compteurs.
export default function Overview() {
  const { organisation, agentCan } = useAuth()
  const reglages = usePlateforme()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  async function load() {
    const { data, error } = await supabase.rpc('bo_supervision')
    if (error) { setErr(error.message); setRows([]); return }
    setRows(data || [])
  }
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [])

  async function ouvrir(o) {
    setBusy(true)
    try { await ouvrirClient(o.id) } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  const liste = rows || []
  const suspendus = liste.filter(o => o.acces === false).length
  const enEssai = liste.filter(o => etatClient(o, reglages).cle === 'essai').length
  const impaye = liste.reduce((s, o) => s + Number(o.montant_impaye || 0), 0)
  const demandes = liste.reduce((s, o) => s + Number(o.demandes_ouvertes || 0), 0)
  const stations = liste.reduce((s, o) => s + Number(o.nb_stations || 0), 0)
  const aJour = liste.reduce((s, o) => s + Number(o.stations_a_jour || 0), 0)

  const cols = [
    { key: 'nom', header: 'Client', render: o => <span><b style={{ fontWeight: 600 }}>{o.nom}</b>{Number(o.montant_mensuel) > 0 && <span style={{ color: 'var(--text-muted)' }}> · {fcfa(o.montant_mensuel)} / mois</span>}</span> },
    { key: 'etat', header: 'État', render: o => { const e = etatClient(o, reglages); return <Badge tone={e.tone}>{e.label}</Badge> } },
    { key: 'saisies', header: 'Saisies du jour', render: o => Number(o.nb_stations) ? `${o.stations_a_jour} sur ${o.nb_stations}` : 'Aucune station' },
    { key: 'derniere_activite', header: 'Dernière saisie', optional: '1', muted: true, render: o => il_y_a(o.derniere_activite) },
    { key: 'comptes_en_attente', header: 'À valider', optional: '2', numeric: true, align: 'right', render: o => Number(o.comptes_en_attente) ? `${o.comptes_en_attente} compte${Number(o.comptes_en_attente) > 1 ? 's' : ''}` : '—' },
    { key: 'montant_impaye', header: 'À régler', numeric: true, align: 'right', optional: '1', render: o => Number(o.montant_impaye) ? fcfa(o.montant_impaye) : '—' },
    { key: 'demandes_ouvertes', header: 'Demandes', numeric: true, align: 'right', optional: '1', render: o => Number(o.demandes_ouvertes) ? (agentCan('assistance') ? <Link to="/admin/assistance">{o.demandes_ouvertes}</Link> : o.demandes_ouvertes) : '—' },
    agentCan('ouvrir_client') && { key: 'action', header: '', align: 'right', render: o => o.id === organisation?.id
      ? <Badge tone="info">Ouvert</Badge>
      : <Button size="sm" tone="dark" disabled={busy} onClick={() => ouvrir(o)}>Ouvrir</Button> },
  ].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Supervision indisponible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      <div className="pi-bo-kpis">
        <MetricTile label="Clients" value={liste.length} sub={[suspendus ? `${suspendus} sans accès` : null, enEssai ? `${enEssai} en essai` : null].filter(Boolean).join(', ') || 'tous actifs'} status={suspendus ? 'alarm' : undefined} />
        <MetricTile label="Stations à jour aujourd'hui" value={`${aJour} / ${stations}`} sub="au moins une saisie envoyée" />
        <MetricTile label="Factures à régler" value={fcfa(impaye)} status={impaye > 0 ? 'warn' : undefined} />
        <MetricTile label="Demandes d'assistance" value={demandes} sub="non résolues" status={demandes > 0 ? 'warn' : undefined} />
      </div>
      <Panel title="Clients" meta={rows ? `${liste.length}` : 'chargement…'} flush
        actions={<Button size="sm" icon="rotate-ccw" onClick={load}>Actualiser</Button>}>
        {liste.length ? <>
          <DataTable columns={cols} rows={liste.slice((page - 1) * pageSize, page * pageSize)} zebra={false} rowStatus={o => etatClient(o, reglages).rang} />
          <Pagination page={Math.min(page, Math.max(1, Math.ceil(liste.length / pageSize)))}
            pageCount={Math.max(1, Math.ceil(liste.length / pageSize))} total={liste.length} pageSize={pageSize}
            onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />
        </> : <PanelEmpty icon="users" label={rows ? 'Aucun client.' : 'Chargement…'} />}
      </Panel>
    </div>
  )
}
