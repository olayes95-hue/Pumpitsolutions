import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStation } from '../lib/station.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'

const TABLE_LABELS = {
  daily_reports: 'Point journalier', deposits: 'Versement', expenses: 'Dépense',
  deliveries: 'Achat', fuel_orders: 'Commande', inspections: 'Contrôle ANM',
}
const ACTION_LABELS = { INSERT: { l: 'Création', tone: 'ok' }, UPDATE: { l: 'Modification', tone: 'warn' }, DELETE: { l: 'Suppression', tone: 'alarm' } }
// champs à surveiller pour le diff lisible
const PUMP_FIELDS = Array.from({ length: 10 }, (_, i) => i + 1).flatMap(n => [`e${n}_m`, `g${n}_m`, `e${n}`, `g${n}`]) // jusqu'à 10 machines par station (stations.nombre_machines)
const WATCH = ['ess_litres','gas_litres','ess_bon','ess_espece','gas_bon','gas_espece','montant','quantite_commandee','cuve_avant','cuve_apres','statut', ...PUMP_FIELDS, 'ess_stock','gas_stock']

const TABLE_OPTIONS = [{ value: 'all', label: 'Toutes les données' }, ...Object.entries(TABLE_LABELS).map(([value, label]) => ({ value, label }))]
const ACTION_OPTIONS = [
  { value: 'all', label: 'Toutes les actions' },
  { value: 'INSERT', label: 'Créations' },
  { value: 'UPDATE', label: 'Modifications' },
  { value: 'DELETE', label: 'Suppressions' },
]

export default function AuditLog() {
  const { stationId } = useStation()
  const [rows, setRows] = useState([])
  const [table, setTable] = useState('all')
  const [action, setAction] = useState('all')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => { if (!stationId) return; (async () => {
    setLoading(true)
    const { data } = await supabase.from('audit_log').select('*').eq('station_id', stationId).order('changed_at', { ascending: false }).limit(500)
    setRows(data || [])
    setLoading(false)
  })() }, [stationId])

  const shown = useMemo(() => rows.filter(r =>
    (table === 'all' || r.table_name === table) && (action === 'all' || r.action === action)), [rows, table, action])
  useEffect(() => { setPage(1) }, [table, action])

  const columns = [
    { key: 'changed_at', header: 'Quand', render: r => fmt(r.changed_at) },
    { key: 'changed_by_email', header: 'Qui', muted: true, render: r => r.changed_by_email || '—' },
    { key: 'table_name', header: 'Donnée', render: r => TABLE_LABELS[r.table_name] || r.table_name },
    { key: 'action', header: 'Action', render: r => {
      const a = ACTION_LABELS[r.action] || { l: r.action, tone: 'idle' }
      return <Badge tone={a.tone}>{a.l}</Badge>
    } },
    { key: 'detail', header: 'Détail', render: r => <span style={{ font: '400 14px/1.4 var(--font-ui)' }}>{diff(r)}</span> },
  ]

  return (
    <Panel
      title="Journal d'audit"
      meta={`${shown.length} événement(s)`}
      flush
      actions={<>
        <Select value={table} onChange={e => setTable(e.target.value)} options={TABLE_OPTIONS} size="sm" />
        <Select value={action} onChange={e => setAction(e.target.value)} options={ACTION_OPTIONS} size="sm" />
      </>}
    >
      {loading
        ? <div style={{ padding: 'var(--sp-6)', font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>Chargement…</div>
        : shown.length
          ? <>
              <DataTable columns={columns} rows={shown.slice((page - 1) * pageSize, page * pageSize)} />
              <Pagination page={Math.min(page, Math.max(1, Math.ceil(shown.length / pageSize)))}
                pageCount={Math.max(1, Math.ceil(shown.length / pageSize))} total={shown.length} pageSize={pageSize}
                onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />
            </>
          : <PanelEmpty icon="search" label="Aucun événement" />}
    </Panel>
  )
}

function fmt(ts) { if (!ts) return '—'; const d = new Date(ts); return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }

function diff(r) {
  const o = r.old_data || {}, n = r.new_data || {}
  if (r.action === 'INSERT') {
    const parts = WATCH.filter(k => n[k] != null && n[k] !== '' && n[k] !== 0).slice(0, 4).map(k => `${k}=${n[k]}`)
    return parts.join(' · ') || `#${r.row_id}`
  }
  if (r.action === 'DELETE') return `supprimé #${r.row_id}`
  // UPDATE : montre les champs surveillés qui ont changé
  const changed = WATCH.filter(k => JSON.stringify(o[k]) !== JSON.stringify(n[k]))
  if (!changed.length) return '—'
  return changed.slice(0, 5).map(k => <span key={k}>{k}: <b style={{ color: 'var(--state-alarm)' }}>{fmtv(o[k])}→{fmtv(n[k])}</b>{' '}</span>)
}
function fmtv(v) { return v == null || v === '' ? '∅' : String(v) }
