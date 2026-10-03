import { useEffect, useMemo, useState } from 'react'
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
import { MultiSelectPopover } from '../ds/pumpit/components/forms/MultiSelectPopover.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? Number(v) : 0)
const TOL = 200        // tolérance FCFA (timbre) pour l'appariement
const WIN = 7          // fenêtre en jours
const MONTHS = [['01','Janv'],['02','Févr'],['03','Mars'],['04','Avril'],['05','Mai'],['06','Juin'],['07','Juil'],['08','Août'],['09','Sept'],['10','Oct'],['11','Nov'],['12','Déc']]
const PAGE_DEFAULT = 25

export default function BankRecon() {
  const { session } = useAuth()
  const { stationId } = useStation()
  const [deposits, setDeposits] = useState([])
  const [bank, setBank] = useState([])
  const [categories, setCategories] = useState([])
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
  // Filtre période — plusieurs mois/années possibles, comme Commandes (voir MultiSelectPopover).
  const [years, setYears] = useState([])
  const [months, setMonths] = useState([])
  const [yearsOpen, setYearsOpen] = useState(false)
  const [monthsOpen, setMonthsOpen] = useState(false)
  // Pagination — une page distincte par tableau, pour ne pas désynchroniser l'un en changeant l'autre.
  const [pageMatched, setPageMatched] = useState(1)
  const [pageUnBank, setPageUnBank] = useState(1)
  const [pageUnDep, setPageUnDep] = useState(1)
  const [pageFlat, setPageFlat] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_DEFAULT)

  async function load() {
    if (!stationId) return
    const [d, b, c] = await Promise.all([
      supabase.from('deposits').select('*').eq('station_id', stationId).order('deposit_date', { ascending: false }),
      supabase.from('bank_lines').select('*').eq('station_id', stationId).order('date_operation', { ascending: false }),
      supabase.from('bank_line_categories').select('*').eq('actif', true).order('ordre'),
    ])
    setDeposits(d.data || [])
    setBank(b.data || [])
    setCategories(c.data || [])
    setCatTab(prev => prev && (c.data || []).some(x => x.key === prev) ? prev : (c.data || [])[0]?.key || null)
  }
  useEffect(() => { load() }, [stationId])
  useEffect(() => { setPageMatched(1); setPageUnBank(1); setPageUnDep(1); setPageFlat(1) }, [catTab, years, months])

  const toggleVal = (list, setList, v) => setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const inPeriod = (d) => {
    if (!d) return true
    if (years.length && !years.includes(d.slice(0, 4))) return false
    if (months.length && !months.includes(d.slice(5, 7))) return false
    return true
  }
  const availableYears = useMemo(() => [...new Set(bank.map(b => (b.date_operation || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [bank])

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
  // Seule la catégorie "versement gérant" se rapproche avec les versements déclarés — les
  // autres (frais, virements fournisseur…) n'ont pas encore de contrepartie app à ce stade
  // (voir le plan : comparaison avec Point financier, phase suivante).
  const isVersementTab = catTab === 'versement_gerant'

  const bankInTab = useMemo(() =>
    bank.filter(b => b.categorie_id === activeCat?.id && inPeriod(b.date_operation)),
    [bank, activeCat, years, months])

  // Appariement glouton : chaque crédit "versement gérant" ↔ un versement déclaré (montant ± TOL, date ± WIN j)
  const recon = useMemo(() => {
    if (!isVersementTab) return { matched: [], unmatchedBank: [], unmatchedDep: [] }
    const credits = bankInTab.filter(b => b.type === 'credit')
    const deps = deposits.filter(d => inPeriod(d.deposit_date || d.report_date)).map(d => ({ ...d, _used: false }))
    const matched = [], unmatchedBank = []
    for (const b of credits) {
      const bd = b.date_operation
      let hit = null
      if (b.matched_deposit_id) hit = deps.find(d => d.id === b.matched_deposit_id && !d._used)
      if (!hit) for (const d of deps) {
        if (d._used) continue
        const dd = d.deposit_date || d.report_date
        const days = Math.abs((new Date(bd) - new Date(dd)) / 86400000)
        if (Math.abs(N(b.montant) - N(d.montant)) <= TOL && days <= WIN) { hit = d; break }
      }
      if (hit) { hit._used = true; matched.push({ bank: b, dep: hit }) }
      else unmatchedBank.push(b)
    }
    const unmatchedDep = deps.filter(d => !d._used)
    return { matched, unmatchedBank, unmatchedDep }
  }, [bankInTab, deposits, isVersementTab, years, months])

  async function matcherManuellement(bankLine, depositId) {
    await supabase.from('bank_lines').update({ matched_deposit_id: depositId }).eq('id', bankLine.id)
    load()
  }
  async function dissocier(bankLine) {
    await supabase.from('bank_lines').update({ matched_deposit_id: null }).eq('id', bankLine.id)
    load()
  }

  const totDecl = deposits.filter(d => inPeriod(d.deposit_date || d.report_date)).reduce((s, d) => s + N(d.montant), 0)
  const totCredit = bankInTab.filter(b => b.type === 'credit').reduce((s, b) => s + N(b.montant), 0)
  const totDebit = bankInTab.filter(b => b.type === 'debit').reduce((s, b) => s + N(b.montant), 0)
  const nbNonRapproches = recon.unmatchedDep.length + recon.unmatchedBank.length

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
  ]
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
        options={[{ value: '', label: 'Rapprocher avec…' }, ...recon.unmatchedDep.map(d => ({ value: d.id, label: `${frDate(d.deposit_date || d.report_date)} · ${d.pole} · ${fcfa(d.montant)}` }))]} style={{ width: '100%' }} />
    ) },
    bankColumns[5],
  ]
  const matchedColumns = [
    { key: 'date_banque', header: 'Date banque', render: m => frDate(m.bank.date_operation) },
    { key: 'montant_banque', header: 'Montant banque', numeric: true, align: 'right', render: m => fcfa(m.bank.montant) },
    { key: 'versement', header: '↔ Versement déclaré', render: m => `${frDate(m.dep.deposit_date || m.dep.report_date)} · ${m.dep.pole}` },
    { key: 'montant_declare', header: 'Montant déclaré', numeric: true, align: 'right', render: m => fcfa(m.dep.montant) },
    { key: 'manuel', header: '', render: m => m.bank.matched_deposit_id ? <Button size="sm" onClick={() => dissocier(m.bank)}>Dissocier</Button> : null },
  ]

  const matchedPage = paginate(recon.matched, pageMatched)
  const unBankPage = paginate(recon.unmatchedBank, pageUnBank)
  const unDepPage = paginate(recon.unmatchedDep, pageUnDep)
  const flatPage = paginate(bankInTab, pageFlat)

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
        <MultiSelectPopover label="Années" allLabel="Toutes années" options={availableYears.map(y => [y, y])}
          selected={years} onToggle={v => toggleVal(years, setYears, v)}
          open={yearsOpen} onToggleOpen={() => { setYearsOpen(v => !v); setMonthsOpen(false) }} />
        <MultiSelectPopover label="Mois" allLabel="Tous mois" options={MONTHS}
          selected={months} onToggle={v => toggleVal(months, setMonths, v)}
          open={monthsOpen} onToggleOpen={() => { setMonthsOpen(v => !v); setYearsOpen(false) }} />
      </div>

      <Tabs items={categories.map(c => ({ value: c.key, label: c.label }))} value={catTab} onChange={setCatTab} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        {isVersementTab && <Kpi label="Versements déclarés" value={fcfa(totDecl)} />}
        <Kpi label="Crédits" value={fcfa(totCredit)} />
        <Kpi label="Débits" value={fcfa(totDebit)} />
        {isVersementTab && <>
          <Kpi label="Rapprochés" value={recon.matched.length} status="ok" />
          <Kpi label="Non rapprochés" value={nbNonRapproches} status={nbNonRapproches > 0 ? 'alarm' : 'ok'} />
        </>}
      </div>

      {isVersementTab ? (<>
        <Panel title="Versements déclarés SANS crédit en banque" meta={`${recon.unmatchedDep.length}`} status="alarm" flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            Argent déclaré versé par le gérant, mais introuvable sur le relevé → à vérifier en priorité.
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            {unDepPage.rows.length ? <DataTable columns={depColumns} rows={unDepPage.rows} /> : <PanelEmpty icon="check" label="Aucun — tout est couvert" />}
          </div>
          {pager(unDepPage, setPageUnDep)}
        </Panel>

        <Panel title="Crédits en banque SANS versement déclaré" meta={`${recon.unmatchedBank.length}`} status="warn" flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            Argent arrivé en banque non déclaré dans un point → à rattacher, ou à rapprocher manuellement ci-dessous si tu reconnais le versement.
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            {unBankPage.rows.length ? <DataTable columns={unmatchedBankColumns} rows={unBankPage.rows} /> : <PanelEmpty icon="landmark" label="Aucun" />}
          </div>
          {pager(unBankPage, setPageUnBank)}
        </Panel>

        <Panel title="Rapprochés" meta={`${recon.matched.length}`} status="ok" flush>
          {matchedPage.rows.length
            ? <DataTable columns={matchedColumns} rows={matchedPage.rows.map((m, i) => ({ ...m, id: i }))} />
            : <PanelEmpty icon="landmark" label="Rien encore rapproché" />}
          {pager(matchedPage, setPageMatched)}
        </Panel>
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
