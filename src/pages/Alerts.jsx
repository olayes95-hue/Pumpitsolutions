import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOffre } from '../lib/offre.jsx'
import { filtrerAlertes } from '../lib/formules'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { frDate } from '../lib/format'
import { ALERT_TONES } from '../lib/tones'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12']
const ML = { '01':'Janv','02':'Févr','03':'Mars','04':'Avril','05':'Mai','06':'Juin','07':'Juil','08':'Août','09':'Sept','10':'Oct','11':'Nov','12':'Déc' }
const key = (a) => `${a.report_date}|${a.type}`

export default function AlertsPage() {
  const { session, isAdmin } = useAuth()
  const { stationId } = useStation()
  const { has, activite } = useOffre()   // fonctions et activités incluses dans l'offre de la station courante
  const nav = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [dismissed, setDismissed] = useState(new Set())
  const [type, setType] = useState('all')
  // Par défaut, mois en cours (pas le dernier mois avec des alertes, qui peut être ancien).
  const today = new Date().toISOString().slice(0, 10)
  const [year, setYear] = useState(today.slice(0, 4))
  const [month, setMonth] = useState(today.slice(5, 7))
  const [showDismissed, setShowDismissed] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!stationId) return
    setLoading(true)
    const { data } = await supabase.from('v_alerts').select('*').eq('station_id', stationId).order('report_date', { ascending: false })
    setAlerts(filtrerAlertes(data, has))
    const { data: d } = await supabase.from('alert_dismissals').select('report_date,type').eq('station_id', stationId)
    setDismissed(new Set((d || []).map(x => `${x.report_date}|${x.type}`)))
    setLoading(false)
  }
  useEffect(() => { load() }, [stationId])

  // Marquer/rétablir réservé à l'admin (RLS le bloque aussi côté base — migration v55).
  // Erreur vérifiée explicitement : avant, un échec RLS silencieux faisait croire que
  // l'alerte était traitée (état local optimiste) alors que rien n'était enregistré.
  async function dismiss(a) {
    const { error } = await supabase.from('alert_dismissals').upsert(
      { station_id: stationId, report_date: a.report_date, type: a.type, dismissed_by: session.user.id },
      { onConflict: 'station_id,report_date,type' })
    if (error) { console.error(error); return }
    setDismissed(p => new Set(p).add(key(a)))
  }
  async function restore(a) {
    const { error } = await supabase.from('alert_dismissals').delete().eq('station_id', stationId).eq('report_date', a.report_date).eq('type', a.type)
    if (error) { console.error(error); return }
    setDismissed(p => { const n = new Set(p); n.delete(key(a)); return n })
  }

  const years = useMemo(() => [...new Set([...alerts.map(a => a.report_date.slice(0, 4)), today.slice(0, 4)])].sort(), [alerts])
  const types = useMemo(() => [...new Set(alerts.map(a => a.type))], [alerts])

  const active = alerts.filter(a => !dismissed.has(key(a)))
  const nbActive = active.length

  // Résumé cliquable par type — sert aussi de filtre rapide (clique une tuile = filtre dessus).
  const countByType = useMemo(() => {
    const m = {}
    for (const a of active) m[a.type] = (m[a.type] || 0) + 1
    return m
  }, [active])
  const topTypes = useMemo(() => Object.entries(countByType).sort((a, b) => b[1] - a[1]).slice(0, 6), [countByType])

  const shown = alerts.filter(a =>
    (type === 'all' || a.type === type) &&
    (year === 'all' || a.report_date.slice(0, 4) === year) &&
    (month === 'all' || a.report_date.slice(5, 7) === month) &&
    (showDismissed ? dismissed.has(key(a)) : !dismissed.has(key(a))))
    // Gravité haute en tête, à date égale de filtre — les urgentes ne se perdent pas dans la liste.
    .sort((a, b) => (a.gravite === 'haute' ? -1 : 1) - (b.gravite === 'haute' ? -1 : 1))

  const yearOptions = [{ value: 'all', label: 'Toutes années' }, ...years.map(y => ({ value: y, label: y }))]
  const monthOptions = [{ value: 'all', label: 'Tous mois' }, ...MONTHS.map(m => ({ value: m, label: ML[m] }))]
  const typeOptions = [{ value: 'all', label: 'Tous types' }, ...types.map(t => ({ value: t, label: ALERT_TONES[t]?.label || t }))]

  return (
    <Panel
      title="Alertes"
      meta={`${nbActive} active(s) · ${dismissed.size} traitée(s)`}
      flush
      actions={<>
        <Select size="sm" value={year} onChange={e => setYear(e.target.value)} options={yearOptions} />
        <Select size="sm" value={month} onChange={e => setMonth(e.target.value)} options={monthOptions} />
        <Select size="sm" value={type} onChange={e => setType(e.target.value)} options={typeOptions} />
        <Checkbox label="Voir les traitées" checked={showDismissed} onChange={v => setShowDismissed(v)} />
      </>}
    >
      {topTypes.length > 0 && (
        <div style={{ padding: 'var(--gutter-panel)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-4)' }}>
          {topTypes.map(([t, n]) => {
            const meta = ALERT_TONES[t] || { label: t, tone: 'info' }
            return (
              <div key={t} onClick={() => { setType(t); setShowDismissed(false) }} style={{ cursor: 'pointer' }}>
                <Kpi label={meta.label} value={n} status={type === t ? 'info' : meta.tone} />
              </div>
            )
          })}
        </div>
      )}
      {loading
        ? <div style={{ padding: 'var(--sp-6)', font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>Chargement…</div>
        : !shown.length
          ? <PanelEmpty icon="bell" label={showDismissed ? 'Aucune alerte traitée' : 'Aucune alerte active'} />
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', padding: 'var(--gutter-panel)' }}>
              {shown.map((a, i) => {
                const meta = ALERT_TONES[a.type] || { label: a.type, tone: 'info' }
                const urgent = a.gravite === 'haute'
                return (
                  <div key={i} style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderLeft: `${urgent ? '3px' : 'var(--bw-accent)'} solid var(--state-${meta.tone})`, borderRadius: 'var(--radius-1)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                          {urgent && <Badge tone="alarm">Urgent</Badge>}
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>
                        <Tag>{frDate(a.report_date)}</Tag>
                      </div>
                      <div style={{ marginTop: 'var(--sp-3)', font: '400 15px/1.4 var(--font-ui)', color: 'var(--text-body)' }}>{a.detail}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', flexShrink: 0 }}>
                      {a.report_date && <Button size="sm" onClick={() => nav(`/saisie?date=${a.report_date}`)}>Traiter</Button>}
                      {isAdmin && (showDismissed
                        ? <Button size="sm" onClick={() => restore(a)}>Rétablir</Button>
                        : <Button size="sm" tone="dark" onClick={() => dismiss(a)}>Marquer traité</Button>)}
                    </div>
                  </div>
                )
              })}
            </div>}
    </Panel>
  )
}
