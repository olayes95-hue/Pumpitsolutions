import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { usePlateforme } from '../lib/plateforme'
import { fcfa } from '../lib/format'
import { etatClient, il_y_a, moisDe, libelleMois, derniersMois } from './outils'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'
import { MetricTile } from '../ds/pumpit/components/data/MetricTile.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

const ETAT_STATION = {
  a_jour: { label: 'À jour', tone: 'ok', aide: 'saisie envoyée aujourd\'hui' },
  en_retard: { label: 'En retard', tone: 'warn', aide: 'dernière saisie il y a moins de 7 jours' },
  inactive: { label: 'Inactive', tone: 'alarm', aide: 'aucune saisie depuis plus de 7 jours' },
}

// Statistiques de la plateforme : clients, stations et leur état, activité, répartition par offre.
export default function Stats() {
  const reglages = usePlateforme()
  const [clients, setClients] = useState([])
  const [stations, setStations] = useState([])
  const [activite, setActivite] = useState([])
  const [formules, setFormules] = useState([])
  const [filtre, setFiltre] = useState('toutes')
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([supabase.rpc('bo_supervision'), supabase.rpc('bo_stations'), supabase.rpc('bo_activite', { p_jours: 30 }), supabase.from('formules').select('*').order('ordre')])
      .then(([c, s, a, f]) => {
        const e = c.error || s.error || a.error
        if (e) setErr(e.message)
        setClients(c.data || []); setStations(s.data || []); setActivite(a.data || []); setFormules(f.data || [])
      })
  }, [])

  const etats = clients.map(c => etatClient(c, reglages).cle)
  const compte = (cle) => etats.filter(e => e === cle).length
  const sansAcces = compte('suspendu') + clients.filter(c => etatClient(c, reglages).cle === 'essai_termine' && c.acces === false).length
  const parEtat = (e) => stations.filter(s => s.etat === e).length
  const comptes = clients.reduce((s, c) => s + Number(c.nb_comptes || 0), 0)
  const taux = stations.length ? Math.round(parEtat('a_jour') / stations.length * 100) : 0

  // Chaque station a sa propre offre : la répartition se compte en stations. Le revenu ne retient
  // que les stations des clients qui paient (ni en essai, ni sans accès).
  const cleClient = Object.fromEntries(clients.map(c => [c.id, etatClient(c, reglages).cle]))
  const parOffre = formules.map(f => {
    const st = stations.filter(s => s.formule === f.key)
    return { id: f.key, offre: f.label, stations: st.length, clients: new Set(st.map(s => s.organisation_id)).size,
      essai: st.filter(s => cleClient[s.organisation_id] === 'essai').length,
      revenu: st.filter(s => ['actif', 'retard'].includes(cleClient[s.organisation_id])).reduce((t, s) => t + Number(s.prix_mensuel || 0), 0) }
  })
  const nouveaux = derniersMois(6).map(m => ({ mois: libelleMois(m), Clients: clients.filter(c => moisDe(c.created_at) === m).length }))
  const jours = activite.map(a => ({ jour: a.jour.slice(8, 10) + '/' + a.jour.slice(5, 7), Stations: Number(a.stations), Saisies: Number(a.saisies) }))
  const liste = filtre === 'toutes' ? stations : stations.filter(s => s.etat === filtre)
  const tooltip = { background: 'var(--surface-panel)', border: 0, borderRadius: 'var(--radius-1)', boxShadow: 'var(--shadow-pop)', font: '13px var(--font-ui)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Statistiques indisponibles" onDismiss={() => setErr('')}>{err}</AlertBanner>}

      <div className="pi-bo-kpis">
        <MetricTile label="Clients" value={clients.length} sub={`${compte('actif') + compte('retard')} avec abonnement, ${compte('essai')} en essai, ${sansAcces} sans accès`} />
        <MetricTile label="Stations" value={stations.length} sub={`${parEtat('a_jour')} à jour, ${parEtat('en_retard')} en retard, ${parEtat('inactive')} inactive${parEtat('inactive') > 1 ? 's' : ''}`} status={parEtat('inactive') ? 'warn' : undefined} />
        <MetricTile label="Stations à jour aujourd'hui" value={taux} unit="%" sub={`${parEtat('a_jour')} sur ${stations.length}`} status={taux >= 80 ? 'ok' : 'warn'} />
        <MetricTile label="Comptes utilisateurs" value={comptes} sub="validés, hors agents PumpIT" />
      </div>

      <Panel title="Stations ayant saisi, par jour" meta="30 derniers jours">
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={jours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="jour" fontSize={12} stroke="var(--ardoise)" tickLine={false} axisLine={false} interval={4} />
              <YAxis fontSize={12} stroke="var(--ardoise)" tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <Tooltip contentStyle={tooltip} cursor={{ fill: 'var(--brume)' }} />
              <Bar dataKey="Stations" fill="var(--vert-pump)" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="pi-bo-2col pi-bo-large">
        <Panel title="Répartition par offre" flush>
          {parOffre.length ? <DataTable zebra={false} rows={parOffre} columns={[
            { key: 'offre', header: 'Offre', render: l => <b style={{ fontWeight: 600 }}>{l.offre}</b> },
            { key: 'stations', header: 'Stations', numeric: true, align: 'right' },
            { key: 'essai', header: 'Dont essai', numeric: true, align: 'right', optional: '1' },
            { key: 'clients', header: 'Clients', numeric: true, align: 'right' },
            { key: 'revenu', header: 'Revenu mensuel', numeric: true, align: 'right', render: l => fcfa(l.revenu) },
          ]} footer={{ offre: 'Total', clients: clients.length, essai: parOffre.reduce((s, l) => s + l.essai, 0), stations: stations.length, revenu: fcfa(parOffre.reduce((s, l) => s + l.revenu, 0)) }} />
            : <PanelEmpty icon="package" label="Aucune offre." />}
        </Panel>
        <Panel title="Nouveaux clients" meta="6 derniers mois">
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={nouveaux} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="mois" fontSize={12} stroke="var(--ardoise)" tickLine={false} axisLine={false} />
                <YAxis fontSize={12} stroke="var(--ardoise)" tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip contentStyle={tooltip} cursor={{ fill: 'var(--brume)' }} />
                <Bar dataKey="Clients" fill="var(--nuit)" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="État des stations" meta={`${liste.length}`} flush>
        <div style={{ padding: '0 var(--gutter-panel) var(--sp-4)' }}>
          <Tabs value={filtre} onChange={setFiltre} style={{ background: 'var(--brume)', borderRadius: 'var(--radius-full)', display: 'inline-flex' }} items={[
            { value: 'toutes', label: 'Toutes', count: stations.length }, { value: 'a_jour', label: 'À jour', count: parEtat('a_jour') },
            { value: 'en_retard', label: 'En retard', count: parEtat('en_retard') }, { value: 'inactive', label: 'Inactives', count: parEtat('inactive') }]} />
        </div>
        {liste.length ? <DataTable zebra={false} rows={liste.map(s => ({ ...s, id: s.station_id }))} rowStatus={s => s.etat === 'inactive' ? 'alarm' : s.etat === 'en_retard' ? 'warn' : null} columns={[
          { key: 'station', header: 'Station', render: s => <b style={{ fontWeight: 600 }}>{s.station}</b> },
          { key: 'client', header: 'Client' },
          { key: 'formule', header: 'Offre', optional: '1', render: s => formules.find(f => f.key === s.formule)?.label || s.formule },
          { key: 'etat', header: 'État', render: s => { const e = ETAT_STATION[s.etat] || ETAT_STATION.inactive; return <Badge tone={e.tone} title={e.aide}>{e.label}</Badge> } },
          { key: 'derniere_saisie', header: 'Dernière saisie', muted: true, optional: '1', render: s => il_y_a(s.derniere_saisie) },
          { key: 'saisies_7j', header: 'Saisies sur 7 j', numeric: true, align: 'right', optional: '1' },
        ]} /> : <PanelEmpty icon="fuel" label="Aucune station dans cet état." />}
        <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0, padding: 'var(--sp-4) var(--gutter-panel)' }}>
          À jour : saisie envoyée aujourd'hui. En retard : dernière saisie il y a moins de 7 jours. Inactive : aucune saisie depuis plus de 7 jours.
        </p>
      </Panel>
    </div>
  )
}
