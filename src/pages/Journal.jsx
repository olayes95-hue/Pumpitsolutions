import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOffre } from '../lib/offre.jsx'
import { filtrerAlertes } from '../lib/formules'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, today } from '../lib/format'
import { ALERT_TONES } from '../lib/tones'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Icon } from '../ds/pumpit/components/core/Icon.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { GaugeBar } from '../ds/pumpit/components/data/GaugeBar.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? Number(v) : 0)
// Jusqu'à 10 machines par station (stations.nombre_machines, réglable dans Stations & équipe).
const MAX_MACHINES = 10
const machineNums = (n) => Array.from({ length: n }, (_, i) => i + 1)

const CHECKLIST = [
  { key: 'matin', label: 'Matin (8h) — stock & ouverture', hint: "Relevez le stock en cuve et les compteurs d'ouverture, avec photo." },
  { key: 'apres-midi', label: '16 h — ventes & compteurs', hint: 'Enregistre les ventes de la veille et les 8 relevés compteurs (obligatoire).' },
  { key: 'soir', label: 'Soir — clôture & versement', hint: 'Enregistre les dépenses justifiées et le versement en banque, avec photo.' },
]

// Une pompe est jugée hors service si ses N derniers relevés 16h renseignés (rows déjà triées
// report_date desc) sont tous identiques — l'index d'une pompe utilisée ne peut que monter.
// Pas assez de relevés (< N) → statut inconnu (pompe neuve, ou station qui ne l'a pas) : on
// n'affirme rien plutôt que de l'annoncer à tort comme hors service.
export function pumpStatus(rows, key, n) {
  const vals = []
  for (const r of rows) {
    if (r[key] != null) vals.push(Number(r[key]))
    if (vals.length >= n) break
  }
  if (vals.length < n) return null
  return vals.every(v => v === vals[0]) ? 'inactive' : 'active'
}

export default function Journal() {
  const { stationId, current } = useStation()
  const { has, activite } = useOffre()   // fonctions et activités incluses dans l'offre de la station courante
  const nav = useNavigate()
  const [moments, setMoments] = useState(new Set())
  const [forecast, setForecast] = useState(null)
  const [manque, setManque] = useState({ carburant: 0, gaz_lub: 0, superette: 0 })
  const [pertes, setPertes] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [pendingCount, setPendingCount] = useState(0)
  const [pumpRows, setPumpRows] = useState([])
  const [pompeInactiveApres, setPompeInactiveApres] = useState(5)
  const [stock, setStock] = useState(null)
  const [loading, setLoading] = useState(true)
  // Mois affiché pour "Manque à verser" — sélectionnable, pas figé sur le mois en cours
  // (demande explicite : pouvoir consulter un mois passé sans attendre le Tableau de bord).
  const [moisManque, setMoisManque] = useState(today().slice(0, 7))

  useEffect(() => { if (!stationId) return; (async () => {
    setLoading(true)
    const day = today()
    // Alertes : fenêtre glissante de 60 jours, PAS le mois calendaire — un manque à verser ou un
    // jour manquant du mois dernier reste dû/à faire même après le 1er du mois suivant ; le
    // gérant ne doit pas le perdre de vue simplement parce que le calendrier a tourné (constaté
    // en prod : un manque de 15 500 F du mois précédent avait disparu de cette page).
    const cutoff60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)
    const [sub, fc, pert, al, dis, po, st, pr, ls] = await Promise.all([
      supabase.from('submissions').select('moment').eq('station_id', stationId).eq('report_date', day),
      supabase.from('v_stock_forecast').select('*').eq('station_id', stationId).maybeSingle(),
      supabase.from('v_pertes_mensuelles').select('*').eq('station_id', stationId).eq('mois', day.slice(0, 7)).maybeSingle(),
      supabase.from('v_alerts').select('*').eq('station_id', stationId).gte('report_date', cutoff60).lte('report_date', day),
      supabase.from('alert_dismissals').select('report_date,type').eq('station_id', stationId),
      supabase.from('fuel_orders').select('id', { count: 'exact', head: true }).eq('station_id', stationId).in('statut', ['lancee', 'partielle']),
      supabase.from('settings').select('pompe_inactive_apres').eq('id', 1).maybeSingle(),
      supabase.from('daily_reports').select(['report_date', ...machineNums(MAX_MACHINES).flatMap(n => [`e${n}`, `g${n}`])].join(',')).eq('station_id', stationId).order('report_date', { ascending: false }).limit(60),
      supabase.from('v_latest_stock').select('bons_restant,bons_utilises_depuis').eq('station_id', stationId).maybeSingle(),
    ])
    setMoments(new Set((sub.data || []).map(x => x.moment)))
    setForecast(fc.data || null)
    setStock(ls.data || null)
    setPertes(pert.data || null)
    // v_alerts n'a aucune notion de "traité" (vue calculée) — sans ce filtre, une alerte
    // marquée traitée sur la page Alertes continuait d'apparaître ici indéfiniment.
    const dismissedKeys = new Set((dis.data || []).map(x => x.report_date + '|' + x.type))
    const activeAlerts = filtrerAlertes(al.data, has).filter(a => !dismissedKeys.has(a.report_date + '|' + a.type))
    setAlerts(activeAlerts.sort((a, b) => (a.gravite === 'haute' ? -1 : 1) - (b.gravite === 'haute' ? -1 : 1)))
    setPendingCount(po.count || 0)
    setPompeInactiveApres(N(st.data?.pompe_inactive_apres) || 5)
    setPumpRows(pr.data || [])
    setLoading(false)
  })() }, [stationId])

  // "Manque à verser" : chargé séparément, dépend du mois SÉLECTIONNÉ (moisManque), pas de
  // "aujourd'hui" — permet de consulter un mois passé sans changer de page.
  //
  // Même formule que le Tableau de bord et Historique (v_pole_recon_mois, migration_v124) :
  // espèces du mois civil moins versé du mois civil, par pôle, SANS déduire aucune dépense —
  // les 3 écrans affichent toujours le même chiffre. Avant, ce calcul attribuait chaque
  // versement à sa PÉRIODE réelle (plus précis pour une période à cheval sur deux mois, cf.
  // ancien commentaire ici) et déduisait en plus les charges SBEE/AUTRE/supérette — choix
  // explicite de cohérence inter-écrans au prix de cette précision-là (voir conversation).
  useEffect(() => { if (!stationId) return; (async () => {
    const { data } = await supabase.from('v_pole_recon_mois').select('*').eq('station_id', stationId).eq('mois', moisManque)
    const manqueByPole = { carburant: 0, gaz_lub: 0, superette: 0 }
    for (const g of (data || [])) {
      if (!(g.pole_groupe in manqueByPole)) continue
      manqueByPole[g.pole_groupe] = N(g.espece) - N(g.verse)
    }
    setManque(manqueByPole)
  })() }, [stationId, moisManque])

  if (loading) return <Panel><p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Chargement…</p></Panel>

  const manqueTotal = manque.carburant + manque.gaz_lub + manque.superette
  // Jours passés sans aucune saisie — mis en avant séparément (pas juste noyés dans la liste
  // d'alertes) : c'est précisément ce que le gérant ne voit pas spontanément autrement.
  const joursManquants = [...new Set(alerts.filter(a => a.type === 'POINT_MANQUANT').map(a => a.report_date))].sort().reverse()
  const otherAlerts = alerts.filter(a => a.type !== 'POINT_MANQUANT')
  const topAlerts = otherAlerts.slice(0, 5)
  const nombreMachines = Math.min(MAX_MACHINES, Math.max(1, N(current?.nombre_machines) || 4))
  const pumps = machineNums(nombreMachines).map(n => ({
    n, e: `e${n}`, g: `g${n}`,
    eStatus: pumpStatus(pumpRows, `e${n}`, pompeInactiveApres),
    gStatus: pumpStatus(pumpRows, `g${n}`, pompeInactiveApres),
  }))
  const nbActives = pumps.reduce((s, p) => s + (p.eStatus === 'active' ? 1 : 0) + (p.gStatus === 'active' ? 1 : 0), 0)
  const nbInactives = pumps.reduce((s, p) => s + (p.eStatus === 'inactive' ? 1 : 0) + (p.gStatus === 'inactive' ? 1 : 0), 0)
  const capaciteEssence = N(current?.capacite_essence) || 20000
  const capaciteGasoil = N(current?.capacite_gasoil) || 20000

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {/* ===== MÉTRIQUES ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        <Kpi label="Manque à verser (mois)" value={fcfa(manqueTotal)} status={manqueTotal > 0 ? 'alarm' : 'ok'} />
        <Kpi label="Pertes carburant (mois)" value={pertes?.perte_na_montant ? fcfa(pertes.perte_na_montant) : fcfa(0)} status={N(pertes?.perte_na_montant) > 0 ? 'alarm' : 'ok'} sub={pertes?.perte_na_litres ? `${Math.round(N(pertes.perte_na_litres)).toLocaleString('fr-FR')} L hors seuil` : ''} />
        <Kpi label="Pompes actives" value={`${nbActives}/${pumps.length * 2}`} status={nbInactives > 0 ? 'alarm' : 'ok'} sub={nbInactives > 0 ? `${nbInactives} hors service` : ''} />
        <Kpi label="Bons en cours" value={stock?.bons_restant != null ? fcfa(stock.bons_restant) : '—'}
          sub={N(stock?.bons_utilises_depuis) > 0 ? `dont ${fcfa(stock.bons_utilises_depuis)} engagés en commandes` : ''}
          status={stock?.bons_restant != null && stock.bons_restant < 0 ? 'alarm' : undefined} />
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <Panel title="État des cuves" style={{ height: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
              <GaugeBar value={N(forecast?.ess_stock)} max={capaciteEssence} label="Essence" valueLabel={`${Math.round(N(forecast?.ess_stock)).toLocaleString('fr-FR')} / ${capaciteEssence.toLocaleString('fr-FR')} L`} />
              <GaugeBar value={N(forecast?.gas_stock)} max={capaciteGasoil} label="Gasoil" valueLabel={`${Math.round(N(forecast?.gas_stock)).toLocaleString('fr-FR')} / ${capaciteGasoil.toLocaleString('fr-FR')} L`} />
            </div>
          </Panel>
        </div>
        <div style={{ flex: '2 1 480px' }}>
          <Panel title="Pompes" meta={`sur les ${pompeInactiveApres} derniers relevés`} style={{ height: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--sp-4)' }}>
              {pumps.map(m => (
                <div key={m.n} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                    <Icon name="fuel" size={13} color="var(--text-muted)" />
                    <span style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>Machine {m.n}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-body)' }}>Essence (E{m.n})</span>
                    <Badge tone={m.eStatus === 'active' ? 'ok' : m.eStatus === 'inactive' ? 'alarm' : 'idle'}>{m.eStatus === 'active' ? 'Active' : m.eStatus === 'inactive' ? 'Hors service' : '—'}</Badge>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-body)' }}>Gasoil (G{m.n})</span>
                    <Badge tone={m.gStatus === 'active' ? 'ok' : m.gStatus === 'inactive' ? 'alarm' : 'idle'}>{m.gStatus === 'active' ? 'Active' : m.gStatus === 'inactive' ? 'Hors service' : '—'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Manque à verser par pôle"
        actions={<Input type="month" size="sm" value={moisManque} max={today().slice(0, 7)} onChange={e => e.target.value && setMoisManque(e.target.value)} style={{ width: 160 }} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <PoleLine label="Carburant" value={manque.carburant} />
          <PoleLine label="Gaz + Lubrifiant" value={manque.gaz_lub} />
          <PoleLine label="Supérette" value={manque.superette} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--sp-3) var(--sp-4)', borderTop: '1px solid var(--border-default)', marginTop: 'var(--sp-2)' }}>
            <span style={{ font: 'var(--fw-semibold) 15px/1.3 var(--font-ui)', color: 'var(--text-primary)' }}>= Cash non tracé (mois)</span>
            <span style={{ font: '600 15px/1.25 var(--font-data)', color: manqueTotal > 0 ? 'var(--state-alarm)' : 'var(--state-ok)' }}>{fcfa(manqueTotal)}</span>
          </div>
        </div>
      </Panel>

      {/* ===== ACTIONS À FAIRE + ALERTES ===== */}
      <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 380px' }}>
          <Panel title="Aujourd'hui — à faire" meta={frDate(today())} style={{ height: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {CHECKLIST.map(c => {
                const done = moments.has(c.key)
                return (
                  <div key={c.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', borderLeft: 'var(--bw-accent) solid var(--state-' + (done ? 'ok' : 'warn') + ')' }}>
                    <Icon name={done ? 'check' : 'triangle-alert'} size={16} color={done ? 'var(--state-ok)' : 'var(--state-warn)'} style={{ marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)' }}>{c.label}</div>
                      {!done && <div style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>{c.hint}</div>}
                    </div>
                    {done ? <Badge tone="ok">Envoyé</Badge> : <Button size="sm" tone="dark" onClick={() => nav(`/saisie?moment=${c.key}`)}>Faire</Button>}
                  </div>
                )
              })}
              {pendingCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', borderLeft: 'var(--bw-accent) solid var(--state-info)' }}>
                  <Icon name="truck" size={16} color="var(--state-info)" />
                  <div style={{ flex: 1, font: '400 15px/1.3 var(--font-ui)', color: 'var(--text-body)' }}>{pendingCount} commande{pendingCount > 1 ? 's' : ''} en attente de réception</div>
                  <Button size="sm" tone="dark" onClick={() => nav('/saisie')}>Réceptionner</Button>
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div style={{ flex: '1 1 380px' }}>
          <Panel title="Alertes récentes" meta={`${alerts.length}`} flush style={{ height: '100%' }}>
            {(joursManquants.length || topAlerts.length)
              ? <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--gutter-panel)' }}>
                  {joursManquants.length > 0 && (
                    <AlertBanner tone="alarm" title={joursManquants.length > 1 ? `${joursManquants.length} jours sans aucune saisie` : 'Jour sans aucune saisie'}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                        {joursManquants.map(d => (
                          <div key={d} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)' }}>
                            <span>{frDate(d)} — rien envoyé</span>
                            <Button size="sm" onClick={() => nav(`/saisie?date=${d}`)}>Rattraper</Button>
                          </div>
                        ))}
                      </div>
                    </AlertBanner>
                  )}
                  {topAlerts.map((a, i) => {
                    const meta = ALERT_TONES[a.type] || { label: a.type, tone: 'info' }
                    return (
                      <AlertBanner key={i} tone={meta.tone} title={meta.label} timestamp={frDate(a.report_date)}
                        action={a.report_date && <Button size="sm" onClick={() => nav(`/saisie?date=${a.report_date}`)}>Traiter</Button>}>
                        {a.detail}
                      </AlertBanner>
                    )
                  })}
                  {otherAlerts.length > topAlerts.length && (
                    <p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>+ {otherAlerts.length - topAlerts.length} autre(s) alerte(s).</p>
                  )}
                </div>
              : <PanelEmpty icon="check" label="Aucune alerte" />}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function PoleLine({ label, value, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--sp-3) var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)' }}>
      <span style={{ font: '400 15px/1.3 var(--font-ui)', color: muted ? 'var(--text-muted)' : 'var(--text-body)' }}>{label}</span>
      <span style={{ font: '500 15px/1.25 var(--font-data)', color: muted ? 'var(--text-muted)' : value > 0 ? 'var(--state-alarm)' : 'var(--state-ok)' }}>{value < 0 ? '− ' + fcfa(Math.abs(value)) : fcfa(value)}</span>
    </div>
  )
}
