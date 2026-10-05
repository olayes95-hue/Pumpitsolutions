import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { useOffre } from '../lib/offre.jsx'
import { PhotoThumb } from '../lib/photos.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate } from '../lib/format'
import { exportRowsToCsv } from '../lib/csv'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { PeriodPicker } from '../ds/pumpit/components/forms/PeriodPicker.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Drawer } from '../ds/pumpit/components/feedback/Drawer.jsx'
import { EvidenceThumb } from '../ds/pumpit/components/evidence/EvidenceThumb.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? Number(v) : 0)
// Dépenses payées en espèces ce jour-là (hors non-cash, ex. carburant du propriétaire).
const depenseCashJour = (exps) => (exps || []).filter(e => !e.non_cash).reduce((s, e) => s + N(e.montant), 0)
const POLE_FILTER_OPTIONS = [
  { value: 'tous', label: 'Tous les pôles' },
  { value: 'carburant', label: 'Carburant' },
  { value: 'gaz_lub', label: 'Gaz + Lubrifiant' },
  { value: 'superette', label: 'Supérette' },
]
const POLE_LABEL = { carburant: 'Carburant', gaz_lub: 'Gaz + Lubrifiant', superette: 'Supérette' }

// Fusion de « Historique des points » (réconciliation financière) et « Saisies & photos »
// (détail opérationnel + preuves) — même donnée journalière parcourue sous deux angles avant,
// un seul tableau + panneau de détail maintenant.
//
// Réconciliation (Écart) calculée au MOIS CIVIL, par pôle, sans déduire les dépenses cash —
// exactement la même formule que le Tableau de bord (v_ventes_mensuelles), déclinée par pôle
// au lieu d'un seul total (v_pole_recon_mois, migration_v124). Avant, Historique calculait par
// PÉRIODE de versement déclarée et déduisait les dépenses cash du carburant (v_pole_recon_jour)
// — un chiffre différent de celui du Tableau de bord, source de confusion répétée côté gérants
// (un écart mensuel annoncé ailleurs ne se retrouvait pas en sommant cet écran). L'écart n'est
// donc plus une notion "par jour" : le tableau journalier montre le CA et les versements du
// jour, mais le SEUL écart affiché est le total du mois, en haut de page.
export default function History() {
  const { stationId, current } = useStation()
  const { has, activite } = useOffre()   // fonctions et activités incluses dans l'offre de la station courante
  const { isAdmin } = useAuth()
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [reconMois, setReconMois] = useState([])   // v_pole_recon_mois, toute la station (toutes périodes)
  const [attCompteurByDate, setAttCompteurByDate] = useState({})   // {date: nb photos compteur}
  const [expByDate, setExpByDate] = useState({})   // {date: [{montant,non_cash,photo_path}]}
  const [depByDate, setDepByDate] = useState({})   // {date: [{montant,photo_path,pole}]}
  const [loading, setLoading] = useState(true)
  // Par défaut, mois en cours — pas le dernier mois avec des données (qui pouvait être ancien
  // si la station n'a rien saisi récemment, masquant justement les jours en attente/incomplets).
  const today = new Date().toISOString().slice(0, 10)
  const [year, setYear] = useState(today.slice(0, 4))
  const [month, setMonth] = useState(today.slice(5, 7))
  const [quickFilter, setQuickFilter] = useState('tous')   // tous | photos (filtre les LIGNES)
  const [poleFilter, setPoleFilter] = useState('tous')      // tous | carburant | gaz_lub | superette (filtre les COLONNES)
  const [detailDate, setDetailDate] = useState(null)
  const [detailExtra, setDetailExtra] = useState({ at: [], dep: [], exp: [] })   // chargé à la demande, pour le seul jour ouvert
  const nombreMachines = Math.min(10, Math.max(1, N(current?.nombre_machines) || 4))

  useEffect(() => { if (!stationId) return; (async () => {
    setLoading(true)
    // Borne d'historique (~20 mois) : évite de recalculer sur TOUT l'historique.
    const CUTOFF = new Date(Date.now() - 600 * 864e5).toISOString().slice(0, 10)
    const [m, rc, at, exp, dep] = await Promise.all([
      supabase.from('v_report_metrics').select('*').eq('station_id', stationId).gte('report_date', CUTOFF).order('report_date', { ascending: false }).limit(600),
      supabase.from('v_pole_recon_mois').select('*').eq('station_id', stationId),
      supabase.from('attachments').select('report_date,categorie').eq('station_id', stationId).gte('report_date', CUTOFF),
      supabase.from('expenses').select('report_date,montant,non_cash,photo_path').eq('station_id', stationId).gte('report_date', CUTOFF),
      supabase.from('deposits').select('report_date,montant,photo_path,pole').eq('station_id', stationId).gte('report_date', CUTOFF),
    ])
    setRows(m.data || [])
    setReconMois(rc.data || [])
    const attMap = {}
    for (const a of (at.data || [])) { if (a.categorie === 'compteur') attMap[a.report_date] = (attMap[a.report_date] || 0) + 1 }
    setAttCompteurByDate(attMap)
    const expMap = {}
    for (const e of (exp.data || [])) { (expMap[e.report_date] = expMap[e.report_date] || []).push(e) }
    setExpByDate(expMap)
    const depMap = {}
    for (const d of (dep.data || [])) { (depMap[d.report_date] = depMap[d.report_date] || []).push(d) }
    setDepByDate(depMap)
    setLoading(false)
  })() }, [stationId])

  // Détail d'un jour (compteurs, stock, charges, photos) : chargé seulement à l'ouverture du
  // panneau, pas pour toute la période — sinon requête lourde pour une donnée rarement consultée.
  useEffect(() => {
    if (!detailDate || !stationId) return
    (async () => {
      const [at, dep, exp] = await Promise.all([
        supabase.from('attachments').select('*').eq('report_date', detailDate).eq('station_id', stationId).order('id'),
        supabase.from('deposits').select('*').eq('report_date', detailDate).eq('station_id', stationId),
        supabase.from('expenses').select('*').eq('report_date', detailDate).eq('station_id', stationId),
      ])
      setDetailExtra({ at: at.data || [], dep: dep.data || [], exp: exp.data || [] })
    })()
  }, [detailDate, stationId])

  const years = useMemo(() => [...new Set([...rows.map(r => r.report_date.slice(0, 4)), today.slice(0, 4)])].sort(), [rows])
  const frows = useMemo(() => rows.filter(r =>
    (year === 'all' || r.report_date.slice(0, 4) === year) &&
    (month === 'all' || r.report_date.slice(5, 7) === month)), [rows, year, month])

  // Réconciliation du mois sélectionné (ou somme sur la période si "Tous les mois"/"Toutes les
  // années" — valide, chaque mois est un total indépendant, pas de double-compte).
  const reconFiltered = useMemo(() => reconMois.filter(r =>
    (year === 'all' || r.mois.slice(0, 4) === year) &&
    (month === 'all' || r.mois.slice(5, 7) === month)), [reconMois, year, month])
  const reconByPole = useMemo(() => {
    const o = { carburant: { espece: 0, verse: 0 }, gaz_lub: { espece: 0, verse: 0 }, superette: { espece: 0, verse: 0 } }
    for (const r of reconFiltered) {
      const p = o[r.pole_groupe]; if (!p) continue
      p.espece += N(r.espece); p.verse += N(r.verse)
    }
    return o
  }, [reconFiltered])
  const polesVisibles = (poleFilter === 'tous' ? ['carburant', 'gaz_lub', 'superette'] : [poleFilter])
  const nbPolesEcart = polesVisibles.filter(p => reconByPole[p].espece - reconByPole[p].verse > 1000).length

  // Complet = TOUTES les preuves exigées sont là (une photo par compteur rempli, un justificatif
  // par dépense cash, un bordereau par versement) — pas juste "au moins une photo ce jour-là".
  const photosOk = (r) => {
    const date = r.report_date
    let expectedMeters = 0
    for (let i = 1; i <= nombreMachines; i++) {
      if (r['e' + i + '_m'] != null) expectedMeters++
      if (r['g' + i + '_m'] != null) expectedMeters++
      if (r['e' + i] != null) expectedMeters++
      if (r['g' + i] != null) expectedMeters++
    }
    if (expectedMeters === 0) return false
    if ((attCompteurByDate[date] || 0) < expectedMeters) return false
    if ((expByDate[date] || []).some(e => N(e.montant) > 0 && !e.non_cash && !e.photo_path)) return false
    if ((depByDate[date] || []).some(d => N(d.montant) > 0 && !d.photo_path)) return false
    return true
  }
  const nbPhotosManquantes = frows.filter(r => !photosOk(r)).length
  const shownRows = frows.filter(r => quickFilter === 'photos' ? !photosOk(r) : true)

  // Versé ce jour-là, pour le(s) pôle(s) visible(s) — fait concret ("un bordereau de ce montant
  // a été saisi ce jour"), pas une notion d'écart (qui n'existe plus qu'au niveau du mois).
  const verseJour = (date, poles) => (depByDate[date] || [])
    .filter(d => poles.includes(poleGroupeDe(d.pole)))
    .reduce((s, d) => s + N(d.montant), 0)

  function exportCsv() {
    const columns = [
      ['Date', 'date'],
      ...(poleFilter === 'tous' || poleFilter === 'carburant' ? [['CA Carbu.', 'ca_carb'], ['Versé ce jour Carbu.', 'v_carb']] : []),
      ...(poleFilter === 'tous' || poleFilter === 'gaz_lub' ? [['CA Gaz+Lub.', 'ca_gl'], ['Versé ce jour Gaz+Lub.', 'v_gl']] : []),
      ...(poleFilter === 'tous' || poleFilter === 'superette' ? [['CA Supérette', 'ca_sup'], ['Versé ce jour Sup.', 'v_sup']] : []),
      ['Bon', 'bon'], ['Dépenses (cash)', 'dep'], ['Photos', 'photos'],
    ]
    const data = frows.map(r => {
      const caGL = N(r.gaz_espece) + N(r.lubrifiant_espece)
      return {
        date: frDate(r.report_date),
        ca_carb: Math.round(N(r.ca_carburant)), v_carb: Math.round(verseJour(r.report_date, ['carburant'])),
        ca_gl: Math.round(caGL), v_gl: Math.round(verseJour(r.report_date, ['gaz_lub'])),
        ca_sup: Math.round(N(r.superette_espece)), v_sup: Math.round(verseJour(r.report_date, ['superette'])),
        bon: Math.round(N(r.ventes_bon)), dep: Math.round(depenseCashJour(expByDate[r.report_date])), photos: photosOk(r) ? 'Complet' : 'Incomplet',
      }
    })
    const totalRow = {
      date: `TOTAL (${frows.length} j)`,
      ca_carb: Math.round(frows.reduce((s, r) => s + N(r.ca_carburant), 0)),
      ca_gl: Math.round(frows.reduce((s, r) => s + N(r.gaz_espece) + N(r.lubrifiant_espece), 0)),
      ca_sup: Math.round(frows.reduce((s, r) => s + N(r.superette_espece), 0)),
      bon: Math.round(frows.reduce((s, r) => s + N(r.ventes_bon), 0)),
      dep: Math.round(frows.reduce((s, r) => s + depenseCashJour(expByDate[r.report_date]), 0)),
    }
    const reconRows = polesVisibles.map(p => ({
      date: `Écart du mois — ${POLE_LABEL[p]}`,
      ca_carb: p === 'carburant' ? Math.round(reconByPole[p].espece) : undefined,
      v_carb: p === 'carburant' ? Math.round(reconByPole[p].verse) : undefined,
      ca_gl: p === 'gaz_lub' ? Math.round(reconByPole[p].espece) : undefined,
      v_gl: p === 'gaz_lub' ? Math.round(reconByPole[p].verse) : undefined,
      ca_sup: p === 'superette' ? Math.round(reconByPole[p].espece) : undefined,
      v_sup: p === 'superette' ? Math.round(reconByPole[p].verse) : undefined,
    }))
    const label = (year === 'all' ? 'tout' : year) + (month !== 'all' ? '-' + month : '')
    const station = (current?.nom || 'station').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    exportRowsToCsv(`historique-${station}-${label}.csv`, columns, [...data, totalRow, ...reconRows])
  }

  // Colonnes détaillées par pôle (CA + Versé du jour), comme avant — poleFilter choisit
  // lesquels afficher au lieu d'imposer soit tout, soit un résumé compressé.
  const showCarb = poleFilter === 'tous' || poleFilter === 'carburant'
  const showGL = poleFilter === 'tous' || poleFilter === 'gaz_lub'
  const showSup = poleFilter === 'tous' || poleFilter === 'superette'
  const columns = [
    { key: 'date', header: 'Date', render: r => frDate(r.report_date) },
    ...(showCarb ? [
      { key: 'ca_carb', header: 'CA Carbu.', numeric: true, align: 'right', render: r => fcfa(r.ca_carburant) },
      { key: 'v_carb', header: 'Versé ce jour', numeric: true, align: 'right', muted: true, render: r => { const v = verseJour(r.report_date, ['carburant']); return v ? fcfa(v) : '—' } },
    ] : []),
    ...(showGL ? [
      { key: 'ca_gl', header: 'CA Gaz+Lub.', numeric: true, align: 'right', render: r => fcfa(N(r.gaz_espece) + N(r.lubrifiant_espece)) },
      { key: 'v_gl', header: 'Versé ce jour', numeric: true, align: 'right', muted: true, render: r => { const v = verseJour(r.report_date, ['gaz_lub']); return v ? fcfa(v) : '—' } },
    ] : []),
    ...(showSup ? [
      { key: 'ca_sup', header: 'CA Supérette', numeric: true, align: 'right', render: r => fcfa(r.superette_espece) },
      { key: 'v_sup', header: 'Versé ce jour', numeric: true, align: 'right', muted: true, render: r => { const v = verseJour(r.report_date, ['superette']); return v ? fcfa(v) : '—' } },
    ] : []),
    ...(showCarb ? [{ key: 'bon', header: 'Bon', numeric: true, align: 'right', render: r => fcfa(r.ventes_bon) }] : []),
    { key: 'dep', header: 'Dépenses', numeric: true, align: 'right', render: r => fcfa(depenseCashJour(expByDate[r.report_date])) },
    { key: 'photos', header: 'Photos', render: r => photosOk(r) ? <Badge tone="ok">Complet</Badge> : <Badge tone="alarm">Incomplet</Badge> },
  ]

  const footer = { date: `TOTAL (${shownRows.length} j)` }
  if (showCarb) { footer.ca_carb = fcfa(shownRows.reduce((s, r) => s + N(r.ca_carburant), 0)) }
  if (showGL) { footer.ca_gl = fcfa(shownRows.reduce((s, r) => s + N(r.gaz_espece) + N(r.lubrifiant_espece), 0)) }
  if (showSup) { footer.ca_sup = fcfa(shownRows.reduce((s, r) => s + N(r.superette_espece), 0)) }
  footer.dep = fcfa(shownRows.reduce((s, r) => s + depenseCashJour(expByDate[r.report_date]), 0))

  const detailRow = frows.find(r => r.report_date === detailDate) || null
  const machineNums = Array.from({ length: nombreMachines }, (_, i) => i + 1)
  const photos = [
    ...detailExtra.at,
    ...detailExtra.dep.filter(x => x.photo_path).map(x => ({ ...x, categorie: 'versement ' + x.pole, note: fcfa(x.montant) })),
    ...detailExtra.exp.filter(x => x.photo_path).map(x => ({ ...x, categorie: 'justificatif ' + (x.categorie || ''), note: fcfa(x.montant) })),
  ]

  return (
    <Panel
      title="Historique"
      meta={`${shownRows.length}`}
      flush
      actions={<>
        <Select size="sm" value={poleFilter} onChange={e => setPoleFilter(e.target.value)} options={POLE_FILTER_OPTIONS} />
        <PeriodPicker multiple={false} years={year === 'all' ? [] : [year]} months={month === 'all' ? [] : [month]}
          setYears={ys => setYear(ys[0] || 'all')} setMonths={ms => setMonth(ms[0] || 'all')} availableYears={years} />
        {(year !== 'all' || month !== 'all') && <Button size="sm" onClick={() => { setYear('all'); setMonth('all') }}>Réinitialiser</Button>}
        {has('export') && <Button size="sm" onClick={exportCsv} disabled={!frows.length}>Exporter (CSV)</Button>}
      </>}
    >
      <div style={{ padding: 'var(--gutter-panel)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        <div>
          <div style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>
            Réconciliation {month === 'all' ? (year === 'all' ? '— toute la période' : `— ${year}`) : `— ${frDate(`${year}-${month}-01`).slice(3)}`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--sp-4)' }}>
            {polesVisibles.map(p => {
              const { espece, verse } = reconByPole[p]
              const ecart = espece - verse
              return (
                <div key={p} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-1)', padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  <span style={{ font: 'var(--fw-semibold) 14px/1.3 var(--font-ui)', color: 'var(--text-primary)' }}>{POLE_LABEL[p]}</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}><span>Espèces</span><span style={{ fontWeight: 600, color: 'var(--text-body)' }}>{fcfa(espece)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}><span>Versé</span><span style={{ fontWeight: 600, color: 'var(--text-body)' }}>{fcfa(verse)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', font: '400 13px/1.3 var(--font-ui)' }}><span style={{ color: 'var(--text-muted)' }}>Écart</span><span style={{ fontWeight: 700, color: ecart > 1000 ? 'var(--state-alarm)' : 'var(--state-ok)' }}>{fcfa(ecart)}{ecart < -1000 ? ' (surplus)' : ''}</span></div>
                </div>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-4)' }}>
          <div onClick={() => setQuickFilter('tous')} style={{ cursor: 'pointer' }}><Kpi label="Jours saisis" value={frows.length} status={quickFilter === 'tous' ? 'info' : undefined} /></div>
          <Kpi label="Pôles en écart (période)" value={nbPolesEcart} status={nbPolesEcart > 0 ? 'alarm' : 'ok'} />
          <div onClick={() => setQuickFilter('photos')} style={{ cursor: 'pointer' }}><Kpi label="Photos manquantes" value={nbPhotosManquantes} status={nbPhotosManquantes > 0 ? 'warn' : 'ok'} /></div>
        </div>
        {quickFilter !== 'tous' && <Button size="sm" onClick={() => setQuickFilter('tous')} style={{ alignSelf: 'flex-start' }}>Réinitialiser le filtre rapide</Button>}
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
          Cliquez sur une ligne pour voir le détail complet du jour (compteurs, stock, charges, photos).
        </p>
      </div>

      <div>
        {loading
          ? <div style={{ padding: 'var(--gutter-panel)', font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>Chargement…</div>
          : <DataTable columns={columns} rows={shownRows.map(r => ({ ...r, id: r.report_date }))} footer={footer} onRowClick={r => setDetailDate(r.report_date)} />}
      </div>
      <p style={{ font: '400 14px/1.5 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel)' }}>
        L'<b>Écart</b> se calcule désormais au <b>mois</b>, par pôle, comme le Point financier : espèces encaissées dans le mois moins
        montant versé dans le mois (voir le bandeau de réconciliation ci-dessus) — les deux écrans affichent toujours le même chiffre.
        Le tableau ci-dessous montre le détail jour par jour (CA et versements du jour) pour retrouver <i>où</i> regarder, mais ne
        porte plus d'écart ligne par ligne.
      </p>

      <Drawer open={!!detailRow} onClose={() => setDetailDate(null)}
        title={detailRow ? frDate(detailRow.report_date) : ''}
        footer={detailRow && <Button tone="primary" onClick={() => nav(`/saisie?date=${detailRow.report_date}`)}>{isAdmin ? 'Ouvrir / modifier' : 'Ouvrir'} cette journée</Button>}>
        {detailRow && (() => {
          const caGL = N(detailRow.gaz_espece) + N(detailRow.lubrifiant_espece)
          return (
            <>
              <Section title="Caisse du jour">
                <Info l="CA carburant" v={fcfa(detailRow.ca_carburant)} />
                <Info l="Versé ce jour (carburant)" v={fcfa(verseJour(detailRow.report_date, ['carburant']))} />
                <Info l="CA gaz + lubrifiant" v={fcfa(caGL)} />
                <Info l="Versé ce jour (gaz + lubrifiant)" v={fcfa(verseJour(detailRow.report_date, ['gaz_lub']))} />
                <Info l="CA supérette" v={fcfa(detailRow.superette_espece)} />
                <Info l="Versé ce jour (supérette)" v={fcfa(verseJour(detailRow.report_date, ['superette']))} />
                <Info l="Ventes à bon" v={fcfa(detailRow.ventes_bon)} />
              </Section>

              <Section title="Ventes carburant">
                <Info l="Essence" v={`${N(detailRow.ess_litres)} L × ${N(detailRow.ess_pu)} — bon ${fcfa(detailRow.ess_bon)} · espèce ${fcfa(detailRow.ess_espece)}`} />
                <Info l="Gasoil" v={`${N(detailRow.gas_litres)} L × ${N(detailRow.gas_pu)} — bon ${fcfa(detailRow.gas_bon)} · espèce ${fcfa(detailRow.gas_espece)}`} />
              </Section>

              <Section title="Autres pôles (espèces)">
                <Info l="Gaz / Supérette / Lubrifiant" v={`${fcfa(detailRow.gaz_espece)} · ${fcfa(detailRow.superette_espece)} · ${fcfa(detailRow.lubrifiant_espece)}`} />
              </Section>

              <Section title="Compteurs">
                <Info l={`Ouverture E1→E${nombreMachines}`} v={machineNums.map(n => N(detailRow['e' + n + '_m'])).join(' · ')} />
                <Info l={`Ouverture G1→G${nombreMachines}`} v={machineNums.map(n => N(detailRow['g' + n + '_m'])).join(' · ')} />
                <Info l={`16h E1→E${nombreMachines}`} v={machineNums.map(n => N(detailRow['e' + n])).join(' · ')} />
                <Info l={`16h G1→G${nombreMachines}`} v={machineNums.map(n => N(detailRow['g' + n])).join(' · ')} />
              </Section>

              <Section title="Stock">
                <Info l="Cuve essence / gasoil" v={`${N(detailRow.ess_stock)} L · ${N(detailRow.gas_stock)} L`} />
                <Info l="Gaz 3/6/12/38 kg" v={`${N(detailRow.gaz_stock_3)} · ${N(detailRow.gaz_stock_6)} · ${N(detailRow.gaz_stock_12)} · ${N(detailRow.gaz_stock_38)}`} />
              </Section>

              <Section title="Charges déclarées par le gérant">
                {detailExtra.exp.length
                  ? <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                      {detailExtra.exp.map(e => (
                        <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', font: '400 15px/1.3 var(--font-ui)' }}>
                          <span style={{ color: 'var(--text-body)' }}>{(e.categorie || 'AUTRE').replace(/_/g, ' ')}{e.motif ? ` — ${e.motif}` : ''}{e.non_cash ? ' (non-cash)' : ''}</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{fcfa(e.montant)}</span>
                        </div>
                      ))}
                    </div>
                  : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Aucune charge déclarée ce jour.</p>}
              </Section>

              {photos.length > 0 && (
                <Section title="Photos du jour">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
                    {photos.map((x, i) => (
                      <PhotoThumb key={i} path={x.photo_path} label={x.categorie} timestamp={x.note} status="none" size={92} />
                    ))}
                  </div>
                </Section>
              )}
            </>
          )
        })()}
      </Drawer>
    </Panel>
  )
}

// pole_groupe à partir du texte libre deposits.pole — même mapping que v_verse_groupe/
// v_verse_mensuel_pole côté base (migration_FINALE_v27_v30 / v124), à tenir synchronisé.
function poleGroupeDe(pole) {
  if (pole === 'carburant') return 'carburant'
  if (pole === 'gaz' || pole === 'lubrifiant' || pole === 'gaz_lubrifiant') return 'gaz_lub'
  return 'superette'
}

function Section({ title, children }) {
  return (<div style={{ marginBottom: 'var(--sp-4)' }}>
    <div style={{ font: 'var(--fw-semibold) 12px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: '0 0 var(--sp-2)' }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>{children}</div>
  </div>)
}
function Info({ l, v }) {
  return (<div style={{ display: 'flex', gap: 'var(--sp-4)', font: '400 15px/1.3 var(--font-ui)', flexWrap: 'wrap', alignItems: 'baseline' }}>
    <span style={{ color: 'var(--text-muted)', minWidth: 150, flexShrink: 0 }}>{l}</span>
    <span style={{ fontWeight: 600, color: 'var(--text-body)', wordBreak: 'break-word', flex: 1 }}>{v}</span>
  </div>)
}
