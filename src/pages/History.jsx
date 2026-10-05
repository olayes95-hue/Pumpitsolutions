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
// Dépenses payées en espèces ce jour-là (hors non-cash, ex. carburant du propriétaire) — c'est
// exactement ce que v_recette_groupe_jour déduit de la recette carburant pour calculer l'écart
// (voir migration_v31_v40 : "dépense carburant = ESPÈCES uniquement"). Affiché en colonne pour
// qu'un gros écart se comprenne d'un coup d'œil (ex. 200 000 F dépensés sur place un jour donné)
// sans avoir à ouvrir le détail de chaque journée une par une.
const depenseCashJour = (exps) => (exps || []).filter(e => !e.non_cash).reduce((s, e) => s + N(e.montant), 0)
const POLE_FILTER_OPTIONS = [
  { value: 'tous', label: 'Tous les pôles' },
  { value: 'carburant', label: 'Carburant' },
  { value: 'gaz_lub', label: 'Gaz + Lubrifiant' },
  { value: 'superette', label: 'Supérette' },
]

// Fusion de « Historique des points » (réconciliation financière) et « Saisies & photos »
// (détail opérationnel + preuves) — même donnée journalière parcourue sous deux angles avant,
// un seul tableau + panneau de détail maintenant.
export default function History() {
  const { stationId, current } = useStation()
  const { has, activite } = useOffre()   // fonctions et activités incluses dans l'offre de la station courante
  const { isAdmin } = useAuth()
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [recon, setRecon] = useState({})   // recon[date][pole_groupe] (v_pole_recon_jour)
  const [attCompteurByDate, setAttCompteurByDate] = useState({})   // {date: nb photos compteur}
  const [expByDate, setExpByDate] = useState({})   // {date: [{montant,non_cash,photo_path}]}
  const [depByDate, setDepByDate] = useState({})   // {date: [{montant,photo_path}]}
  const [loading, setLoading] = useState(true)
  // Par défaut, mois en cours — pas le dernier mois avec des données (qui pouvait être ancien
  // si la station n'a rien saisi récemment, masquant justement les jours en attente/incomplets).
  const today = new Date().toISOString().slice(0, 10)
  const [year, setYear] = useState(today.slice(0, 4))
  const [month, setMonth] = useState(today.slice(5, 7))
  const [quickFilter, setQuickFilter] = useState('tous')   // tous | ecarts | attente | photos (filtre les LIGNES)
  const [poleFilter, setPoleFilter] = useState('tous')      // tous | carburant | gaz_lub | superette (filtre les COLONNES)
  const [detailDate, setDetailDate] = useState(null)
  const [detailExtra, setDetailExtra] = useState({ at: [], dep: [], exp: [] })   // chargé à la demande, pour le seul jour ouvert
  const nombreMachines = Math.min(10, Math.max(1, N(current?.nombre_machines) || 4))

  useEffect(() => { if (!stationId) return; (async () => {
    setLoading(true)
    // Borne d'historique (~20 mois) : évite de recalculer v_pole_recon_jour sur TOUT l'historique
    // (3 lignes/jour × sous-requêtes imbriquées). Les 5 requêtes partent en parallèle (avant : en série).
    const CUTOFF = new Date(Date.now() - 600 * 864e5).toISOString().slice(0, 10)
    const [m, cr, at, exp, dep] = await Promise.all([
      supabase.from('v_report_metrics').select('*').eq('station_id', stationId).gte('report_date', CUTOFF).order('report_date', { ascending: false }).limit(600),
      // 3 lignes/jour (une par pôle) : sans tri+limite explicites, la limite par défaut de l'API
      // (1000 lignes) pouvait tronquer arbitrairement — des jours récents disparaissaient de
      // `recon`, retombant à tort sur l'affichage "en attente" (repli quand la ligne est absente).
      supabase.from('v_pole_recon_jour').select('*').eq('station_id', stationId).gte('report_date', CUTOFF).order('report_date', { ascending: false }).limit(1800),
      supabase.from('attachments').select('report_date,categorie').eq('station_id', stationId).gte('report_date', CUTOFF),
      supabase.from('expenses').select('report_date,montant,non_cash,photo_path').eq('station_id', stationId).gte('report_date', CUTOFF),
      supabase.from('deposits').select('report_date,montant,photo_path').eq('station_id', stationId).gte('report_date', CUTOFF),
    ])
    setRows(m.data || [])
    const cmap = {}; for (const c of (cr.data || [])) { (cmap[c.report_date] = cmap[c.report_date] || {})[c.pole_groupe] = c }
    setRecon(cmap)
    // Un jour "avec photos" ne veut rien dire en soi (il suffit d'UNE photo, même hors sujet, pour
    // que ce soit vrai) — ce qui compte, c'est que CHAQUE preuve exigée soit là : une photo par
    // compteur rempli, un justificatif par dépense cash, un bordereau par versement.
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
      // Les liens signés sont demandés par PhotoThumb au moment de l'affichage (lib/photos.jsx).
      setDetailExtra({ at: at.data || [], dep: dep.data || [], exp: exp.data || [] })
    })()
  }, [detailDate, stationId])

  const years = useMemo(() => [...new Set([...rows.map(r => r.report_date.slice(0, 4)), today.slice(0, 4)])].sort(), [rows])
  const frows = useMemo(() => rows.filter(r =>
    (year === 'all' || r.report_date.slice(0, 4) === year) &&
    (month === 'all' || r.report_date.slice(5, 7) === month)), [rows, year, month])

  // Statut du jour = pire cas des 3 pôles (carburant / gaz+lub / supérette) — sert au résumé,
  // au filtre rapide et au badge de la colonne "Statut" du tableau allégé.
  const dayStatus = (r) => {
    const g = recon[r.report_date] || {}
    const states = [
      poleState(g.carburant, g.carburant?.espece),
      poleState(g.gaz_lub, N(r.gaz_espece) + N(r.lubrifiant_espece)),
      poleState(g.superette, r.superette_espece),
    ]
    if (states.includes('ecart')) return 'ecart'
    if (states.includes('attente')) return 'attente'
    return 'ok'
  }
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
    // Un jour sans AUCUN relevé compteur n'a pas eu sa vraie saisie du gérant — souvent juste un
    // "daily_reports" créé en creux par autre chose (ex. une réception de commande qui ne stamp
    // que le stock). Sans ce garde-fou, expectedMeters=0 rendait la comparaison suivante vacueuse
    // (0 < 0 = faux) et un jour vide passait "Complet" (constaté en prod : 1er/2 sept. marqués
    // complets alors que rien n'était réellement rempli).
    if (expectedMeters === 0) return false
    if ((attCompteurByDate[date] || 0) < expectedMeters) return false
    if ((expByDate[date] || []).some(e => N(e.montant) > 0 && !e.non_cash && !e.photo_path)) return false
    if ((depByDate[date] || []).some(d => N(d.montant) > 0 && !d.photo_path)) return false
    return true
  }
  const nbEcarts = frows.filter(r => dayStatus(r) === 'ecart').length
  const nbAttente = frows.filter(r => dayStatus(r) === 'attente').length
  const nbPhotosManquantes = frows.filter(r => !photosOk(r)).length
  const shownRows = frows.filter(r =>
    quickFilter === 'ecarts' ? dayStatus(r) === 'ecart' :
    quickFilter === 'attente' ? dayStatus(r) === 'attente' :
    quickFilter === 'photos' ? !photosOk(r) : true)

  function exportCsv() {
    const columns = [
      ['Date', 'date'], ['CA Carbu.', 'ca_carb'], ['Espèce carbu.', 'esp_carb'], ['Versé carbu.', 'ver_carb'], ['Écart carbu.', 'ec_carb'],
      ['CA Gaz+Lub.', 'ca_gl'], ['Versé Gaz+Lub.', 'ver_gl'], ['Écart Gaz+Lub.', 'ec_gl'],
      ['CA Supérette', 'ca_sup'], ['Versé Sup.', 'ver_sup'], ['Écart Sup.', 'ec_sup'],
      ['Bon', 'bon'], ['Dépenses (cash)', 'dep'], ['Photos', 'photos'],
    ]
    const data = frows.map(r => {
      const g = recon[r.report_date] || {}
      const carb = g.carburant, gl = g.gaz_lub, sup = g.superette
      const caGL = N(r.gaz_espece) + N(r.lubrifiant_espece)
      return {
        date: frDate(r.report_date),
        ca_carb: Math.round(N(r.ca_carburant)), esp_carb: caVal(carb, carb?.espece), ver_carb: verseVal(carb), ec_carb: ecartVal(carb, carb?.espece),
        ca_gl: caVal(gl, caGL), ver_gl: verseVal(gl), ec_gl: ecartVal(gl, caGL),
        ca_sup: caVal(sup, r.superette_espece), ver_sup: verseVal(sup), ec_sup: ecartVal(sup, r.superette_espece),
        bon: Math.round(N(r.ventes_bon)), dep: Math.round(depenseCashJour(expByDate[r.report_date])), photos: photosOk(r) ? 'Complet' : 'Incomplet',
      }
    })
    // Ligne de total, jusqu'ici absente du CSV alors qu'elle existe déjà à l'écran (pied du
    // tableau) — sans elle, il fallait rouvrir l'app ou refaire la somme à la main pour avoir
    // le total du mois une fois le fichier exporté.
    const total = {
      date: `TOTAL (${frows.length} j)`,
      ca_carb: Math.round(frows.reduce((s, r) => s + N(r.ca_carburant), 0)),
      esp_carb: Math.round(frows.reduce((s, r) => s + N(recon[r.report_date]?.carburant?.espece), 0)),
      ver_carb: Math.round(frows.reduce((s, r) => s + N(recon[r.report_date]?.carburant?.verse), 0)),
      ca_gl: Math.round(frows.reduce((s, r) => s + N(r.gaz_espece) + N(r.lubrifiant_espece), 0)),
      ver_gl: Math.round(frows.reduce((s, r) => s + N(recon[r.report_date]?.gaz_lub?.verse), 0)),
      ca_sup: Math.round(frows.reduce((s, r) => s + N(r.superette_espece), 0)),
      ver_sup: Math.round(frows.reduce((s, r) => s + N(recon[r.report_date]?.superette?.verse), 0)),
      bon: Math.round(frows.reduce((s, r) => s + N(r.ventes_bon), 0)),
      dep: Math.round(frows.reduce((s, r) => s + depenseCashJour(expByDate[r.report_date]), 0)),
    }
    const label = (year === 'all' ? 'tout' : year) + (month !== 'all' ? '-' + month : '')
    const station = (current?.nom || 'station').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    exportRowsToCsv(`historique-${station}-${label}.csv`, columns, [...data, total])
  }

  // Colonnes détaillées par pôle (CA/Espèce/Versé/Écart), comme l'ancien tableau — poleFilter
  // choisit lesquels afficher au lieu d'imposer soit tout, soit un résumé compressé.
  const showCarb = poleFilter === 'tous' || poleFilter === 'carburant'
  const showGL = poleFilter === 'tous' || poleFilter === 'gaz_lub'
  const showSup = poleFilter === 'tous' || poleFilter === 'superette'
  const columns = [
    { key: 'date', header: 'Date', render: r => frDate(r.report_date) },
    ...(showCarb ? [
      { key: 'ca_carb', header: 'CA Carbu.', numeric: true, align: 'right', render: r => fcfa(r.ca_carburant) },
      { key: 'esp_carb', header: 'Espèce carbu.', numeric: true, align: 'right', render: r => (recon[r.report_date]?.carburant ? caCell(recon[r.report_date].carburant, recon[r.report_date].carburant.espece) : '—') },
      { key: 'ver_carb', header: 'Versé carbu.', numeric: true, align: 'right', render: r => verseCell(recon[r.report_date]?.carburant) },
      { key: 'ec_carb', header: 'Écart carbu.', numeric: true, align: 'right', render: r => ecartCell(recon[r.report_date]?.carburant, recon[r.report_date]?.carburant?.espece) },
    ] : []),
    ...(showGL ? [
      { key: 'ca_gl', header: 'CA Gaz+Lub.', numeric: true, align: 'right', render: r => caCell(recon[r.report_date]?.gaz_lub, N(r.gaz_espece) + N(r.lubrifiant_espece)) },
      { key: 'ver_gl', header: 'Versé Gaz+Lub.', numeric: true, align: 'right', render: r => verseCell(recon[r.report_date]?.gaz_lub) },
      { key: 'ec_gl', header: 'Écart Gaz+Lub.', numeric: true, align: 'right', render: r => ecartCell(recon[r.report_date]?.gaz_lub, N(r.gaz_espece) + N(r.lubrifiant_espece)) },
    ] : []),
    ...(showSup ? [
      { key: 'ca_sup', header: 'CA Supérette', numeric: true, align: 'right', render: r => caCell(recon[r.report_date]?.superette, r.superette_espece) },
      { key: 'ver_sup', header: 'Versé Sup.', numeric: true, align: 'right', render: r => verseCell(recon[r.report_date]?.superette) },
      { key: 'ec_sup', header: 'Écart Sup.', numeric: true, align: 'right', render: r => ecartCell(recon[r.report_date]?.superette, r.superette_espece) },
    ] : []),
    ...(showCarb ? [{ key: 'bon', header: 'Bon', numeric: true, align: 'right', render: r => fcfa(r.ventes_bon) }] : []),
    { key: 'dep', header: 'Dépenses', numeric: true, align: 'right', render: r => fcfa(depenseCashJour(expByDate[r.report_date])) },
    { key: 'photos', header: 'Photos', render: r => photosOk(r) ? <Badge tone="ok">Complet</Badge> : <Badge tone="alarm">Incomplet</Badge> },
  ]

  const footer = { date: `TOTAL (${shownRows.length} j)` }
  if (showCarb) {
    footer.ca_carb = fcfa(shownRows.reduce((s, r) => s + N(r.ca_carburant), 0))
    footer.esp_carb = fcfa(shownRows.reduce((s, r) => s + N(recon[r.report_date]?.carburant?.espece), 0))
    footer.ver_carb = fcfa(shownRows.reduce((s, r) => s + N(recon[r.report_date]?.carburant?.verse), 0))
    footer.bon = fcfa(shownRows.reduce((s, r) => s + N(r.ventes_bon), 0))
  }
  if (showGL) {
    footer.ca_gl = fcfa(shownRows.reduce((s, r) => s + N(r.gaz_espece) + N(r.lubrifiant_espece), 0))
    footer.ver_gl = fcfa(shownRows.reduce((s, r) => s + N(recon[r.report_date]?.gaz_lub?.verse), 0))
  }
  if (showSup) {
    footer.ca_sup = fcfa(shownRows.reduce((s, r) => s + N(r.superette_espece), 0))
    footer.ver_sup = fcfa(shownRows.reduce((s, r) => s + N(recon[r.report_date]?.superette?.verse), 0))
  }
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-4)' }}>
          <div onClick={() => setQuickFilter('tous')} style={{ cursor: 'pointer' }}><Kpi label="Jours saisis" value={frows.length} status={quickFilter === 'tous' ? 'info' : undefined} /></div>
          <div onClick={() => setQuickFilter('ecarts')} style={{ cursor: 'pointer' }}><Kpi label="Jours avec écart" value={nbEcarts} status={nbEcarts > 0 ? 'alarm' : 'ok'} /></div>
          <div onClick={() => setQuickFilter('attente')} style={{ cursor: 'pointer' }}><Kpi label="Jours en attente" value={nbAttente} status={nbAttente > 0 ? 'warn' : 'ok'} /></div>
          <div onClick={() => setQuickFilter('photos')} style={{ cursor: 'pointer' }}><Kpi label="Photos manquantes" value={nbPhotosManquantes} status={nbPhotosManquantes > 0 ? 'warn' : 'ok'} /></div>
        </div>
        {quickFilter !== 'tous' && <Button size="sm" onClick={() => setQuickFilter('tous')} style={{ alignSelf: 'flex-start' }}>Réinitialiser le filtre rapide</Button>}
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
          Cliquez sur une ligne pour voir le détail complet du jour (réconciliation, compteurs, stock, charges, photos).
        </p>
      </div>

      <div>
        {loading
          ? <div style={{ padding: 'var(--gutter-panel)', font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>Chargement…</div>
          : <DataTable columns={columns} rows={shownRows.map(r => ({ ...r, id: r.report_date }))} footer={footer} onRowClick={r => setDetailDate(r.report_date)} />}
      </div>
      <p style={{ font: '400 14px/1.5 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel)' }}>
        La colonne <b>CA</b> affiche toujours le déclaré du seul jour. Un versement couvre une <b>période</b>
        (gaz et lubrifiant sont cumulables dans un même bordereau) : tant qu'elle n'est pas clôturée, les jours
        sont « ✓ inclus » (écart 0). Le jour où la période se termine, l'<b>Écart</b> compare la <b>somme des
        recettes de toute la période</b> (carburant : <b>net des dépenses</b>) au <b>montant versé</b> — survole
        le montant de l'écart pour voir ce cumul. S'il reste un écart, il apparaît en rouge et une alerte est levée.
      </p>

      <Drawer open={!!detailRow} onClose={() => setDetailDate(null)}
        title={detailRow ? frDate(detailRow.report_date) : ''}
        footer={detailRow && <Button tone="primary" onClick={() => nav(`/saisie?date=${detailRow.report_date}`)}>{isAdmin ? 'Ouvrir / modifier' : 'Ouvrir'} cette journée</Button>}>
        {detailRow && (() => {
          const g = recon[detailRow.report_date] || {}
          const caGL = N(detailRow.gaz_espece) + N(detailRow.lubrifiant_espece)
          return (
            <>
              <Section title="Réconciliation">
                <Info l="CA carburant" v={caCell(g.carburant, g.carburant?.espece)} />
                <Info l="Versé / Écart carburant" v={<>{verseCell(g.carburant)} · {ecartCell(g.carburant, g.carburant?.espece)}</>} />
                <Info l="CA gaz + lubrifiant" v={caCell(g.gaz_lub, caGL)} />
                <Info l="Versé / Écart gaz + lubrifiant" v={<>{verseCell(g.gaz_lub)} · {ecartCell(g.gaz_lub, caGL)}</>} />
                <Info l="CA supérette" v={caCell(g.superette, detailRow.superette_espece)} />
                <Info l="Versé / Écart supérette" v={<>{verseCell(g.superette)} · {ecartCell(g.superette, detailRow.superette_espece)}</>} />
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

// poleState : état d'un pôle pour un jour donné, réutilisé par le résumé/filtre rapide et le
// badge Statut du tableau. Distinct de caCell/verseCell/ecartCell (JSX) — ici juste un mot-clé.
function poleState(g, espece) {
  // Tout manque réel (écart > 0) compte, pas seulement au-delà d'un seuil de tolérance —
  // l'épsilon (0.5) n'est là que pour absorber le bruit d'arrondi flottant, pas pour masquer
  // un vrai manque de quelques centaines de francs.
  if (g && N(g.nb_cloture) > 0 && g.ecart != null) return N(g.ecart) > 0.5 ? 'ecart' : 'ok'
  if (g?.couvert) return 'ok'
  if (N(espece) > 0) return 'attente'
  return null
}

// CA affiché = toujours le déclaré du SEUL jour, jamais le cumul de la période versée —
// sinon le jour de clôture affiche un montant qui ne correspond à aucune saisie du gérant
// pour ce jour précis, ce qui prête à confusion. Le cumul (base réelle de l'écart) reste
// visible via l'info-bulle de la colonne Écart, seule colonne qui a besoin de ce cumul.
function caCell(g, dayVal) {
  return fcfa(dayVal)
}
// 0 F explicite plutôt qu'un tiret quand rien n'a été versé ce jour-là — un tiret se lit comme
// "pas concerné" et peut passer inaperçu à côté d'une colonne CA non nulle ; un "0 F" bien visible
// ne laisse aucune ambiguïté sur le fait qu'aucun versement n'a encore été fait.
function verseCell(g) {
  return fcfa(N(g?.verse))
}
// dayVal (la même valeur que celle passée à caCell pour la colonne CA/Espèce voisine) sert de
// filet : si la caisse déclarée du jour est non nulle, le jour est "en attente" même si g.espece
// est absent/à 0 pour une raison quelconque — la colonne Écart ne doit jamais afficher un tiret
// à côté d'une colonne CA/Espèce qui montre un montant réel, ça n'a pas de sens pour le gérant.
function ecartCell(g, dayVal) {
  if (!g) return N(dayVal) > 0 ? <span style={{ color: 'var(--text-muted)' }}>en attente</span> : '—'
  if (N(g.nb_cloture) > 0) {
    const e = N(g.ecart)
    // écart > 0 = il manque du versé (rouge) ; écart < 0 = surplus versé (vert) ; ≈0 = ok (vert).
    // Tout manque compte, même petit — 0.5 F n'est qu'un épsilon anti-bruit d'arrondi, pas une
    // tolérance métier (825 F par ex. doit être rouge, pas "ok" parce que sous un seuil arbitraire).
    const title = g.recette_cloture != null ? `Basé sur la recette cumulée de la période versée (clôturée ce jour) : ${fcfa(g.recette_cloture)}` : undefined
    return <span title={title} style={{ fontWeight: 600, color: e > 0.5 ? 'var(--state-alarm)' : 'var(--state-ok)', borderBottom: title ? '1px dotted currentColor' : undefined, cursor: title ? 'help' : undefined }}>{fcfa(e)}{e < -0.5 ? ' (surplus)' : ''}</span>
  }
  if (g.couvert) return <span style={{ color: 'var(--state-ok)' }} title="Jour inclus dans une période versée ; l'écart sera calculé au dernier jour de la période.">✓ inclus</span>
  if (N(g.espece) > 0 || N(dayVal) > 0) return <span style={{ color: 'var(--text-muted)' }}>en attente</span>
  return '—'
}
// Équivalents en VALEUR BRUTE (nombres/texte, pas de JSX) — pour l'export CSV, miroir de caCell/verseCell/ecartCell.
function caVal(g, dayVal) {
  return Math.round(N(dayVal))
}
function verseVal(g) { return Math.round(N(g?.verse)) }
function ecartVal(g, dayVal) {
  if (!g) return N(dayVal) > 0 ? 'en attente' : ''
  if (N(g.nb_cloture) > 0) return Math.round(N(g.ecart))
  if (g.couvert) return 'inclus'
  if (N(g.espece) > 0 || N(dayVal) > 0) return 'en attente'
  return ''
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
