import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, today } from '../lib/format'
import { readCsvFile, parseCsv, detectColumns, buildBankLines, categoriser } from '../lib/bankImport'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { PeriodPicker } from '../ds/pumpit/components/forms/PeriodPicker.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? Number(v) : 0)
const TOL = 200        // tolérance FCFA (timbre) pour l'appariement
const WIN = 35         // fenêtre en jours — couvre un versement crédité le mois suivant (retard banque)
const PAGE_DEFAULT = 25

// Catégories pour lesquelles un rapprochement ligne-à-ligne a un sens — versement_gerant est
// la seule à avoir encore une contrepartie SAISIE séparément (deposits, saisie du jour) à
// confronter au relevé. virement_fournisseur et frais_bancaire sont devenus la source directe
// de Trésorerie (v_compte_bancaire, migrations v111/v112) et de la charge FRAIS_BANCAIRE de
// Point financier (voir comparaisonPF ci-dessous) — plus de double saisie à rapprocher.
const MATCH_CONFIG = {
  versement_gerant: { sens: 'credit', source: 'deposits', label: 'versement déclaré', unLabel: 'Versement déclaré', plurielSujet: 'Versements déclarés' },
}
const CAT_FRAIS_BANCAIRE = 'FRAIS_BANCAIRE'
const targetDateOf = (cfg, t) => cfg.source === 'deposits' ? (t.deposit_date || t.report_date) : t.date_mouvement
const targetLabelOf = (cfg, t) => cfg.source === 'deposits'
  ? `${frDate(targetDateOf(cfg, t))} · ${t.pole} · ${fcfa(t.montant)}`
  : `${frDate(targetDateOf(cfg, t))} · ${t.note || 'mouvement'} · ${fcfa(t.montant)}`
const matchFieldOf = (cfg) => cfg.source === 'deposits' ? 'matched_deposit_id' : 'matched_mouvement_id'

export default function BankRecon() {
  const nav = useNavigate()
  const { session } = useAuth()
  const { stationId } = useStation()
  const [deposits, setDeposits] = useState([])
  const [bank, setBank] = useState([])
  const [charges, setCharges] = useState([])   // Point financier — pour comparer/synchroniser FRAIS_BANCAIRE
  const [categories, setCategories] = useState([])
  const [busySync, setBusySync] = useState(false)
  const [catTab, setCatTab] = useState(null)
  const [nl, setNl] = useState({ date_operation: today(), type: 'credit', montant: '', reference: '', categorie_id: '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  // Import CSV du relevé — colonnes auto-détectées par nom d'en-tête ; si date/crédit ne sont
  // pas reconnues, l'admin les choisit lui-même dans la liste des colonnes du fichier.
  const [importHeaders, setImportHeaders] = useState([])
  const [importRows, setImportRows] = useState([])
  const [importCols, setImportCols] = useState(null)
  const [importNeedsMapping, setImportNeedsMapping] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showManual, setShowManual] = useState(false)
  // Filtre période — un seul sélecteur (PeriodPicker), année(s) + mois ensemble.
  // Par défaut : année + mois en cours (pas "toutes périodes"), pour ouvrir sur les lignes récentes.
  const [years, setYears] = useState([String(today().slice(0, 4))])
  const [months, setMonths] = useState([today().slice(5, 7)])
  // Le tableau "Rapprochés" ne s'affiche qu'au clic sur la tuile Kpi correspondante — sinon il
  // prend de la place à chaque chargement alors que c'est le moins souvent consulté des 3.
  const [showMatched, setShowMatched] = useState(false)
  // Pagination — une page distincte par tableau, pour ne pas désynchroniser l'un en changeant l'autre.
  const [pageMatched, setPageMatched] = useState(1)
  const [pageUnBank, setPageUnBank] = useState(1)
  const [pageUnDep, setPageUnDep] = useState(1)
  const [pageFlat, setPageFlat] = useState(1)
  const [pageDoublons, setPageDoublons] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_DEFAULT)

  async function load() {
    if (!stationId) return
    const [d, b, ch, c] = await Promise.all([
      supabase.from('deposits').select('*').eq('station_id', stationId).order('deposit_date', { ascending: false }),
      supabase.from('bank_lines').select('*').eq('station_id', stationId).order('date_operation', { ascending: false }),
      supabase.from('charges').select('*').eq('station_id', stationId),
      supabase.from('bank_line_categories').select('*').eq('actif', true).order('ordre'),
    ])
    setDeposits(d.data || [])
    setBank(b.data || [])
    setCharges(ch.data || [])
    setCategories(c.data || [])
    setCatTab(prev => prev && (c.data || []).some(x => x.key === prev) ? prev : (c.data || [])[0]?.key || null)
  }
  useEffect(() => { load() }, [stationId])
  useEffect(() => { setPageMatched(1); setPageUnBank(1); setPageUnDep(1); setPageFlat(1); setPageDoublons(1); setShowMatched(false) }, [catTab, years, months])

  const inPeriod = (d) => {
    if (!d) return true
    if (years.length && !years.includes(d.slice(0, 4))) return false
    if (months.length && !months.includes(d.slice(5, 7))) return false
    return true
  }
  // Toujours proposer l'année en cours même si aucune ligne n'y figure encore (relevé pas
  // encore importé pour ce mois) — sinon le filtre par défaut (année en cours) pointerait vers
  // une liste d'années qui ne la contient pas.
  const availableYears = useMemo(() => [...new Set([
    ...bank.map(b => (b.date_operation || '').slice(0, 4)).filter(Boolean),
    today().slice(0, 4),
  ])].sort().reverse(), [bank])

  async function addLine(e) {
    e.preventDefault(); setErr('')
    if (!nl.montant) return
    const { error } = await supabase.from('bank_lines').insert({
      station_id: stationId, date_operation: nl.date_operation, type: nl.type, montant: Number(nl.montant),
      reference: nl.reference || null, categorie_id: nl.categorie_id || null, created_by: session.user.id })
    if (error) setErr(error.message)
    else { setNl({ date_operation: today(), type: 'credit', montant: '', reference: '', categorie_id: '' }); setMsg('Ligne ajoutée'); setTimeout(() => setMsg(''), 2000); load() }
  }
  async function delLine(id) { await supabase.from('bank_lines').delete().eq('id', id); load() }
  async function recategoriser(line, categorie_id) {
    await supabase.from('bank_lines').update({ categorie_id: categorie_id || null }).eq('id', line.id)
    load()
  }

  async function onImportFile(e) {
    const file = e.target.files[0]; e.target.value = ''
    if (!file) return
    setErr(''); setMsg('')
    let text
    try { text = await readCsvFile(file) } catch { setErr('Impossible de lire ce fichier.'); return }
    const { headers, rows } = parseCsv(text)
    if (!headers.length || !rows.length) { setErr('Fichier vide ou illisible — vérifiez que c\'est bien un export CSV.'); return }
    // Re-charge les catégories juste avant de classer : si elles ont été modifiées (mots-clés,
    // nouvelle catégorie) depuis l'ouverture de cette page, sans ça l'import utiliserait encore
    // les anciennes, chargées une seule fois au montage.
    const { data: freshCats } = await supabase.from('bank_line_categories').select('*').eq('actif', true).order('ordre')
    if (freshCats) setCategories(freshCats)
    const cols = detectColumns(headers)
    setImportHeaders(headers); setImportRows(rows); setImportCols(cols); setImportNeedsMapping(true)
  }

  async function doImport(cols, rows) {
    setImportBusy(true)
    const lignes = buildBankLines(rows, cols, categories)
    // Une ligne "déjà présente" (même date + même montant + même sens — ex. relevé réimporté
    // en partie, ou période qui chevauche un import précédent) n'est pas réinsérée en double,
    // mais SA CATÉGORIE EST QUAND MÊME MISE À JOUR si les mots-clés ont changé depuis — sinon,
    // modifier une catégorie puis réimporter le même relevé ne changeait jamais rien.
    const existantesParCle = new Map(bank.map(b => [`${b.date_operation}|${Math.round(N(b.montant))}|${b.type}`, b]))
    const nouvelles = [], aRecategoriser = []
    for (const l of lignes) {
      const cle = `${l.date_operation}|${Math.round(l.montant)}|${l.type}`
      const existante = existantesParCle.get(cle)
      if (!existante) nouvelles.push(l)
      else if (existante.categorie_id !== l.categorie_id) aRecategoriser.push({ id: existante.id, categorie_id: l.categorie_id })
    }
    if (nouvelles.length) {
      const { error } = await supabase.from('bank_lines').insert(
        nouvelles.map(l => ({ ...l, station_id: stationId, created_by: session.user.id })))
      if (error) { setErr(error.message); setImportBusy(false); return }
    }
    for (const r of aRecategoriser) await supabase.from('bank_lines').update({ categorie_id: r.categorie_id }).eq('id', r.id)
    const inchangees = lignes.length - nouvelles.length - aRecategoriser.length
    setMsg(`${nouvelles.length} ligne(s) importée(s)`
      + (aRecategoriser.length ? `, ${aRecategoriser.length} recatégorisée(s)` : '')
      + (inchangees ? `, ${inchangees} déjà à jour` : '') + '.')
    setImportBusy(false); setImportNeedsMapping(false); setImportRows([]); setImportHeaders([]); setImportCols(null)
    load()
  }

  // Reclasse les lignes déjà en base avec les catégories ACTUELLES, sans avoir besoin de
  // réimporter le fichier — pour qu'une modification des mots-clés s'applique tout de suite.
  async function reclasserTout() {
    setImportBusy(true); setErr(''); setMsg('')
    const { data: freshCats } = await supabase.from('bank_line_categories').select('*').eq('actif', true).order('ordre')
    const cats = freshCats || categories
    if (freshCats) setCategories(freshCats)
    let n = 0
    for (const b of bank) {
      const nouvelleCat = categoriser(b.reference || '', cats)
      if (nouvelleCat !== b.categorie_id) { await supabase.from('bank_lines').update({ categorie_id: nouvelleCat }).eq('id', b.id); n++ }
    }
    setMsg(`${n} ligne(s) reclassée(s) selon les catégories actuelles${n === 0 ? ' (déjà à jour)' : ''}.`)
    setImportBusy(false)
    load()
  }

  const catByKey = (key) => categories.find(c => c.key === key)
  const catById = (id) => categories.find(c => c.id === id)
  const activeCat = catByKey(catTab)
  const matchCfg = MATCH_CONFIG[catTab] || null
  const isMatchableTab = !!matchCfg
  const isVersementTab = catTab === 'versement_gerant'   // seule catégorie dont le rapprochement vaut vérification de bordereau

  const bankInTab = useMemo(() =>
    bank.filter(b => b.categorie_id === activeCat?.id && inPeriod(b.date_operation)),
    [bank, activeCat, years, months])

  // MATCH_CONFIG ne contient plus que versement_gerant (source 'deposits') — virement_fournisseur
  // et frais_bancaire sont désormais directement sourcés du relevé (v111/v112), plus de
  // contrepartie manuelle à rapprocher ligne à ligne pour eux.
  const targetRowsAll = useMemo(() => (matchCfg ? deposits : []), [matchCfg, deposits])

  // Appariement glouton sur TOUT l'historique (pas seulement la période affichée) : un
  // versement/virement/frais déclaré fin de mois peut n'apparaître en banque que le mois
  // suivant — le restreindre à la période choisie dès la recherche de correspondance le
  // ferait manquer à tort, même si les deux lignes existent bien quelque part. Seul
  // l'AFFICHAGE est ensuite borné à la période (sur l'une ou l'autre date de la paire).
  const bankSideAll = useMemo(() =>
    matchCfg ? bank.filter(b => b.categorie_id === activeCat?.id && b.type === matchCfg.sens) : [],
    [matchCfg, bank, activeCat])

  const recon = useMemo(() => {
    if (!matchCfg) return { matched: [], unmatchedBank: [], unmatchedTarget: [] }
    const matchField = matchFieldOf(matchCfg)
    const targets = targetRowsAll.map(t => ({ ...t, _used: false }))
    const matched = [], unmatchedBank = []
    for (const b of bankSideAll) {
      const bd = b.date_operation
      let hit = null
      if (b[matchField]) hit = targets.find(t => t.id === b[matchField] && !t._used)
      if (!hit) for (const t of targets) {
        if (t._used) continue
        const days = Math.abs((new Date(bd) - new Date(targetDateOf(matchCfg, t))) / 86400000)
        if (Math.abs(N(b.montant) - N(t.montant)) <= TOL && days <= WIN) { hit = t; break }
      }
      if (hit) { hit._used = true; matched.push({ bank: b, target: hit }) }
      else unmatchedBank.push(b)
    }
    const unmatchedTarget = targets.filter(t => !t._used)
    return {
      matchedAll: matched,   // pour le marquage « bordereau vérifié » — jamais borné à la période affichée
      matched: matched.filter(m => inPeriod(m.bank.date_operation) || inPeriod(targetDateOf(matchCfg, m.target))),
      unmatchedBank: unmatchedBank.filter(b => inPeriod(b.date_operation)),
      unmatchedTarget: unmatchedTarget.filter(t => inPeriod(targetDateOf(matchCfg, t))),
    }
  }, [matchCfg, bankSideAll, targetRowsAll, years, months])

  // Un versement dont le crédit est retrouvé en banque est au moins aussi fiable qu'une
  // relecture à l'œil de la photo (la banque confirme le montant elle-même) — on marque donc
  // le bordereau "vérifié" automatiquement dès qu'il est rapproché, pour éviter au comptable
  // de revérifier à la main ce que le rapprochement vient de confirmer. Jamais l'inverse : on
  // ne dévérifie pas tout seul si un rapprochement est dissocié (voir matcherManuellement/
  // dissocier) — l'admin garde la main pour corriger via "Vérif bordereaux" si besoin. Ne
  // s'applique qu'au versement gérant — virement_fournisseur/frais_bancaire n'ont pas de
  // notion de "bordereau vérifié" (ce sont des mouvements, pas des déclarations photographiées).
  useEffect(() => {
    if (!isVersementTab) return
    const aVerifier = (recon.matchedAll || []).filter(m => !m.target.verifie).map(m => m.target.id)
    if (!aVerifier.length) return
    ;(async () => {
      const verifie_at = new Date().toISOString()
      await supabase.from('deposits').update({ verifie: true, verifie_par: session.user.id, verifie_at, verifie_source: 'rapprochement' }).in('id', aVerifier)
      setDeposits(prev => prev.map(d => aVerifier.includes(d.id) ? { ...d, verifie: true, verifie_par: session.user.id, verifie_at, verifie_source: 'rapprochement' } : d))
    })()
  }, [recon.matchedAll, isVersementTab])

  async function matcherManuellement(bankLine, targetId) {
    await supabase.from('bank_lines').update({ [matchFieldOf(matchCfg)]: targetId }).eq('id', bankLine.id)
    load()
  }
  async function dissocier(bankLine) {
    await supabase.from('bank_lines').update({ [matchFieldOf(matchCfg)]: null }).eq('id', bankLine.id)
    load()
  }
  async function delDeposit(d) { await supabase.from('deposits').delete().eq('id', d.id); load() }

  // Déclarations doublons : le gérant a pu valider deux fois le même versement (même jour,
  // même montant) — on les regroupe pour que l'admin vérifie et supprime le(s) doublon(s).
  const doublons = useMemo(() => {
    const groupes = new Map()
    for (const d of deposits.filter(x => inPeriod(x.report_date))) {
      const cle = `${d.report_date}|${d.pole}|${Math.round(N(d.montant))}`
      if (!groupes.has(cle)) groupes.set(cle, [])
      groupes.get(cle).push(d)
    }
    return [...groupes.values()].filter(g => g.length > 1).flat()
  }, [deposits, years, months])

  const totDecl = matchCfg ? targetRowsAll.filter(t => inPeriod(targetDateOf(matchCfg, t))).reduce((s, t) => s + N(t.montant), 0) : 0
  const totCredit = bankInTab.filter(b => b.type === 'credit').reduce((s, b) => s + N(b.montant), 0)
  const totDebit = bankInTab.filter(b => b.type === 'debit').reduce((s, b) => s + N(b.montant), 0)
  const nbNonRapproches = recon.unmatchedTarget.length + recon.unmatchedBank.length

  const paginate = (rows, page) => {
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
    const clamped = Math.min(page, pageCount)
    return { rows: rows.slice((clamped - 1) * pageSize, clamped * pageSize), pageCount, clamped, total: rows.length }
  }

  const depColumns = [
    { key: 'deposit_date', header: 'Date', render: r => frDate(r.deposit_date) },
    { key: 'pole', header: 'Pôle' },
    { key: 'montant', header: 'Montant', numeric: true, align: 'right', render: r => <span style={{ color: 'var(--state-alarm)' }}>{fcfa(r.montant)}</span> },
    { key: 'ref_bordereau', header: 'Réf', muted: true, render: r => r.ref_bordereau || '—' },
    { key: 'actions', header: '', align: 'right', render: r => <Button size="sm" onClick={() => nav(`/saisie?date=${r.report_date}`)}>Ouvrir la saisie</Button> },
  ]
  const doublonColumns = [
    { key: 'report_date', header: 'Jour déclaré', render: r => frDate(r.report_date) },
    { key: 'pole', header: 'Pôle' },
    { key: 'montant', header: 'Montant', numeric: true, align: 'right', render: r => fcfa(r.montant) },
    { key: 'deposit_date', header: 'Date bordereau', muted: true, render: r => r.deposit_date ? frDate(r.deposit_date) : '—' },
    { key: 'ref_bordereau', header: 'Réf', muted: true, render: r => r.ref_bordereau || '—' },
    { key: 'actions', header: '', align: 'right', render: r => (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <Button size="sm" onClick={() => nav(`/saisie?date=${r.report_date}`)}>Ouvrir la saisie</Button>
        <Button size="sm" tone="danger" onClick={() => delDeposit(r)}>Supprimer</Button>
      </div>
    ) },
  ]
  const targetColumns = depColumns   // MATCH_CONFIG ne contient plus que versement_gerant (source deposits)

  const catSelectOptions = [{ value: '', label: '— aucune —' }, ...categories.map(c => ({ value: c.id, label: c.label }))]
  const bankColumns = [
    { key: 'date_operation', header: 'Date', render: r => frDate(r.date_operation) },
    { key: 'type', header: 'Sens', render: r => <Badge tone={r.type === 'credit' ? 'ok' : 'alarm'}>{r.type === 'credit' ? 'Crédit' : 'Débit'}</Badge> },
    { key: 'montant', header: 'Montant', numeric: true, align: 'right', render: r => fcfa(r.montant) },
    { key: 'reference', header: 'Réf', muted: true, render: r => r.reference || '—' },
    { key: 'categorie', header: 'Catégorie', render: r => <Select size="sm" value={r.categorie_id || ''} onChange={e => recategoriser(r, e.target.value ? Number(e.target.value) : null)} options={catSelectOptions} style={{ width: '100%' }} /> },
    { key: 'actions', header: '', align: 'right', render: r => <Button size="sm" tone="danger" onClick={() => delLine(r.id)}>Suppr.</Button> },
  ]
  const unmatchedBankColumns = [
    ...bankColumns.slice(0, 4),
    { key: 'match', header: '', align: 'right', render: r => (
      <Select size="sm" value="" onChange={e => e.target.value && matcherManuellement(r, Number(e.target.value))}
        options={[{ value: '', label: 'Rapprocher avec…' }, ...recon.unmatchedTarget.map(t => ({ value: t.id, label: targetLabelOf(matchCfg, t) }))]} style={{ width: '100%' }} />
    ) },
    bankColumns[5],
  ]
  const matchedColumns = [
    { key: 'date_banque', header: 'Date banque', render: m => frDate(m.bank.date_operation) },
    { key: 'montant_banque', header: 'Montant banque', numeric: true, align: 'right', render: m => fcfa(m.bank.montant) },
    { key: 'cible', header: `↔ ${matchCfg?.unLabel || 'Correspondance'}`, render: m => targetLabelOf(matchCfg, m.target) },
    { key: 'montant_cible', header: 'Montant enregistré', numeric: true, align: 'right', render: m => fcfa(m.target.montant) },
    { key: 'manuel', header: '', render: m => m.bank[matchFieldOf(matchCfg)] ? <Button size="sm" onClick={() => dissocier(m.bank)}>Dissocier</Button> : null },
  ]

  const matchedPage = paginate(recon.matched, pageMatched)
  const unBankPage = paginate(recon.unmatchedBank, pageUnBank)
  const unTargetPage = paginate(recon.unmatchedTarget, pageUnDep)
  const flatPage = paginate(bankInTab, pageFlat)
  const doublonPage = paginate(doublons, pageDoublons)

  // Phase 6 du plan rapprochement : frais bancaires du relevé réel (import) comparés à la
  // charge FRAIS_BANCAIRE de Point financier pour le mois choisi — seul un mois unique (année +
  // mois, pas une sélection multiple) a un sens ici, puisque charges.mois est un mois unique.
  const moisUnique = years.length === 1 && months.length === 1 ? `${years[0]}-${months[0]}` : null
  const totFraisBanque = bank.filter(b => b.categorie_id === catByKey('frais_bancaire')?.id && b.type === 'debit' && inPeriod(b.date_operation)).reduce((s, b) => s + N(b.montant), 0)
  const chargeFraisMois = moisUnique ? charges.find(c => c.categorie === CAT_FRAIS_BANCAIRE && c.mois === moisUnique) : null
  const totFraisPF = N(chargeFraisMois?.montant)
  const ecartFrais = totFraisBanque - totFraisPF

  async function synchroniserFraisPF() {
    if (!moisUnique) return
    setBusySync(true); setErr('')
    try {
      // .select() après l'écriture : sans ça, une ligne bloquée par RLS (mois verrouillé dans
      // Point financier) renvoie 0 ligne modifiée SANS erreur — le message de succès s'afficherait
      // à tort alors que rien n'a changé. En vérifiant data.length on détecte ce cas et on prévient.
      if (chargeFraisMois) {
        const { data, error } = await supabase.from('charges')
          .update({ montant: totFraisBanque, note: `Synchronisé depuis Rapprochement le ${frDate(today())}` })
          .eq('id', chargeFraisMois.id).select('id')
        if (error) throw error
        if (!data?.length) throw new Error(`Aucune ligne modifiée — le mois ${moisUnique} est peut-être verrouillé dans Point financier (déverrouille-le puis réessaie).`)
      } else if (totFraisBanque > 0) {
        const { error } = await supabase.from('charges').insert({
          station_id: stationId, mois: moisUnique, categorie: CAT_FRAIS_BANCAIRE, montant: totFraisBanque,
          note: `Synchronisé depuis Rapprochement le ${frDate(today())}`, created_by: session.user.id })
        if (error) throw error
      }
      setMsg('Point financier mis à jour (frais bancaires).'); setTimeout(() => setMsg(''), 3000)
      load()
    } catch (e) { setErr('Synchronisation impossible : ' + (e.message || e)) }
    finally { setBusySync(false) }
  }

  const pager = (p, setPage) => <Pagination page={p.clamped} pageCount={p.pageCount} total={p.total} pageSize={pageSize} onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <Button tone={showImport ? 'dark' : 'neutral'} icon="upload" onClick={() => { setShowImport(v => !v); setShowManual(false) }}>Importer un relevé (CSV)</Button>
        <Button tone={showManual ? 'dark' : 'neutral'} icon="plus" onClick={() => { setShowManual(v => !v); setShowImport(false) }}>Saisir une ligne manuellement</Button>
        <Button icon="refresh-cw" disabled={importBusy || !bank.length} title="Réapplique les catégories actuelles (mots-clés) à toutes les lignes déjà importées, sans réimporter le fichier" onClick={reclasserTout}>{importBusy ? 'Reclassement…' : 'Reclasser avec les catégories actuelles'}</Button>
      </div>

      {showImport && (
      <Panel title="Importer un relevé (CSV)">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Exportez le relevé depuis le site de votre banque (CSV ou Excel exporté en CSV), pour la période voulue, puis importez-le ici. Crédits et débits sont importés et classés automatiquement (catégories réglables dans Stations & équipe → Paramètres).
        </p>
        <Input type="file" accept=".csv,text/csv" onChange={onImportFile} />

        {importNeedsMapping && (() => {
          const colOptions = [{ value: -1, label: '— aucune —' }, ...importHeaders.map((h, i) => ({ value: i, label: h }))]
          const lignes = buildBankLines(importRows, importCols, categories)
          const pret = importCols.date >= 0 && (importCols.credit >= 0 || importCols.debit >= 0)
          return (
            <div style={{ marginTop: 'var(--sp-4)', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
                Vérifiez (ou corrigez) à quoi correspond chaque colonne du fichier :
              </p>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Date opération *" style={{ flex: '1 1 160px' }}>
                  <Select value={importCols.date} onChange={e => setImportCols({ ...importCols, date: Number(e.target.value) })} options={colOptions} style={{ width: '100%' }} />
                </Field>
                <Field label="Montant crédité" style={{ flex: '1 1 160px' }}>
                  <Select value={importCols.credit} onChange={e => setImportCols({ ...importCols, credit: Number(e.target.value) })} options={colOptions} style={{ width: '100%' }} />
                </Field>
                <Field label="Montant débité" style={{ flex: '1 1 160px' }}>
                  <Select value={importCols.debit} onChange={e => setImportCols({ ...importCols, debit: Number(e.target.value) })} options={colOptions} style={{ width: '100%' }} />
                </Field>
                <Field label="Description" style={{ flex: '1 1 160px' }}>
                  <Select value={importCols.description} onChange={e => setImportCols({ ...importCols, description: Number(e.target.value) })} options={colOptions} style={{ width: '100%' }} />
                </Field>
                <Field label="Référence" style={{ flex: '1 1 160px' }}>
                  <Select value={importCols.reference} onChange={e => setImportCols({ ...importCols, reference: Number(e.target.value) })} options={colOptions} style={{ width: '100%' }} />
                </Field>
              </div>
              {pret ? (
                <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-body)', margin: 0 }}>
                  <b>{lignes.length}</b> ligne(s) détectée(s){lignes[0] ? ` — ex. ${frDate(lignes[0].date_operation)} : ${fcfa(lignes[0].montant)} (${lignes[0].type === 'credit' ? 'crédit' : 'débit'})` : ''}.
                </p>
              ) : (
                <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--state-alarm)', margin: 0 }}>Choisissez au moins la colonne date et une colonne de montant (crédit ou débit).</p>
              )}
              <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                <Button tone="primary" disabled={!pret || importBusy} onClick={() => doImport(importCols, importRows)}>{importBusy ? 'Import…' : `Importer ${lignes.length} ligne(s)`}</Button>
                <Button onClick={() => { setImportNeedsMapping(false); setImportRows([]); setImportHeaders([]); setImportCols(null) }}>Annuler</Button>
              </div>
            </div>
          )
        })()}
      </Panel>
      )}

      {showManual && (
      <Panel title="Saisir une ligne manuellement">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Pour une correction ponctuelle, ou si l'import CSV ci-dessus n'est pas possible.
        </p>
        <form onSubmit={addLine} style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'end' }}>
          <Field label="Date opération" style={{ flex: '1 1 150px' }}>
            <Input type="date" value={nl.date_operation} onChange={e => setNl({ ...nl, date_operation: e.target.value })} />
          </Field>
          <Field label="Sens" style={{ flex: '1 1 130px' }}>
            <Select value={nl.type} onChange={e => setNl({ ...nl, type: e.target.value })} options={[{ value: 'credit', label: 'Crédit' }, { value: 'debit', label: 'Débit' }]} style={{ width: '100%' }} />
          </Field>
          <Field label="Montant" style={{ flex: '1 1 150px' }}>
            <Input type="number" inputMode="decimal" numeric value={nl.montant} onChange={e => setNl({ ...nl, montant: e.target.value })} />
          </Field>
          <Field label="Catégorie" style={{ flex: '1 1 180px' }}>
            <Select value={nl.categorie_id} onChange={e => setNl({ ...nl, categorie_id: e.target.value })} options={catSelectOptions} style={{ width: '100%' }} />
          </Field>
          <Field label="Référence" style={{ flex: '1 1 150px' }}>
            <Input value={nl.reference} onChange={e => setNl({ ...nl, reference: e.target.value })} />
          </Field>
          <Button type="submit" tone="primary">Ajouter la ligne</Button>
        </form>
      </Panel>
      )}

      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <PeriodPicker years={years} months={months} setYears={setYears} setMonths={setMonths} availableYears={availableYears} />
      </div>

      {doublons.length > 0 && (
        <Panel title="Versements déclarés en double (même jour, même pôle, même montant)" meta={`${doublons.length}`} status="alarm" flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            Le gérant a peut-être validé deux fois la même déclaration — vérifiez les photos/réf avant de supprimer le doublon.
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <DataTable columns={doublonColumns} rows={doublonPage.rows} />
          </div>
          {pager(doublonPage, setPageDoublons)}
        </Panel>
      )}

      <Panel title="Comparaison avec Point financier" flush>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
          Frais bancaires du relevé réel comparés à la charge « Frais bancaire » du Point financier, pour le mois choisi (un seul mois à la fois — pas une sélection multiple). Indépendant de la catégorie sélectionnée ci-dessous.
        </p>
        <div style={{ margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
          {!moisUnique ? (
            <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Sélectionne une seule année et un seul mois ci-dessus pour comparer.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-4)', flexWrap: 'wrap', padding: 'var(--sp-3) var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)' }}>
              <span style={{ flex: '1 1 160px', font: '600 14px/1.3 var(--font-ui)' }}>Frais bancaires — {moisUnique}</span>
              <span style={{ font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>Relevé : <b style={{ color: 'var(--text-body)' }}>{fcfa(totFraisBanque)}</b></span>
              <span style={{ font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>Point financier : <b style={{ color: 'var(--text-body)' }}>{fcfa(totFraisPF)}</b></span>
              <span style={{ font: '600 14px/1.3 var(--font-ui)', color: Math.abs(ecartFrais) <= TOL ? 'var(--state-ok)' : 'var(--state-alarm)' }}>
                {Math.abs(ecartFrais) <= TOL ? '✓ cohérent' : `Écart ${ecartFrais > 0 ? '+' : ''}${fcfa(ecartFrais)}`}
              </span>
              {Math.abs(ecartFrais) > TOL && (
                <Button size="sm" tone="dark" disabled={busySync} onClick={synchroniserFraisPF}>
                  {busySync ? 'Mise à jour…' : 'Mettre à jour Point financier'}
                </Button>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Field label="Catégorie" style={{ maxWidth: 280 }}>
        <Select value={catTab || ''} onChange={e => setCatTab(e.target.value)} options={categories.map(c => ({ value: c.key, label: c.label }))} style={{ width: '100%' }} />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        {isMatchableTab && <Kpi label={matchCfg.plurielSujet} value={fcfa(totDecl)} />}
        <Kpi label="Crédits" value={fcfa(totCredit)} />
        <Kpi label="Débits" value={fcfa(totDebit)} />
        {isMatchableTab && <>
          <div onClick={() => setShowMatched(v => !v)} style={{ cursor: 'pointer' }} title="Cliquer pour afficher/masquer le détail">
            <Kpi label="Rapprochés" value={recon.matched.length} status="ok" />
          </div>
          <Kpi label="Non rapprochés" value={nbNonRapproches} status={nbNonRapproches > 0 ? 'alarm' : 'ok'} />
        </>}
      </div>

      {isMatchableTab ? (<>
        <Panel title={`${matchCfg.plurielSujet} SANS contrepartie en banque`} meta={`${recon.unmatchedTarget.length}`} status="alarm" flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            {matchCfg.plurielSujet}, mais introuvable(s) sur le relevé → à vérifier en priorité.
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            {unTargetPage.rows.length ? <DataTable columns={targetColumns} rows={unTargetPage.rows} /> : <PanelEmpty icon="check" label="Aucun — tout est couvert" />}
          </div>
          {pager(unTargetPage, setPageUnDep)}
        </Panel>

        <Panel title={`${matchCfg.sens === 'credit' ? 'Crédits' : 'Débits'} en banque SANS ${matchCfg.label}`} meta={`${recon.unmatchedBank.length}`} status="warn" flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            Mouvement présent en banque sans contrepartie saisie → à rattacher, ou à rapprocher manuellement ci-dessous si tu le reconnais.
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            {unBankPage.rows.length ? <DataTable columns={unmatchedBankColumns} rows={unBankPage.rows} /> : <PanelEmpty icon="landmark" label="Aucun" />}
          </div>
          {pager(unBankPage, setPageUnBank)}
        </Panel>

        {showMatched && (
          <Panel title="Rapprochés" meta={`${recon.matched.length}`} status="ok" flush>
            {matchedPage.rows.length
              ? <DataTable columns={matchedColumns} rows={matchedPage.rows.map((m, i) => ({ ...m, id: i }))} />
              : <PanelEmpty icon="landmark" label="Rien encore rapproché" />}
            {pager(matchedPage, setPageMatched)}
          </Panel>
        )}
      </>) : (
        <Panel title={activeCat?.label || 'Lignes'} meta={`${bankInTab.length}`} flush>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            {flatPage.rows.length ? <DataTable columns={bankColumns} rows={flatPage.rows} /> : <PanelEmpty icon="landmark" label="Aucune ligne dans cette catégorie pour la période choisie" />}
          </div>
          {pager(flatPage, setPageFlat)}
        </Panel>
      )}
    </div>
  )
}
