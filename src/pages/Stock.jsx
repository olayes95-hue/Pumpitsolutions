import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOffre } from '../lib/offre.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, numFR, today } from '../lib/format'
import { STOCK_MOVEMENT_TONES, STOCK_SOURCE_TONES } from '../lib/tones'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { Icon } from '../ds/pumpit/components/core/Icon.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { PeriodPicker } from '../ds/pumpit/components/forms/PeriodPicker.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? (numFR(v) ?? 0) : 0)
const PAGE_SIZE = 15

// Pagination simple et fixe (15 lignes/page) pour les tableaux de journalisation
// (Journal des mouvements, Sorties déduites, Historique quotidien) — pas de sélecteur
// de taille, juste précédent/suivant, pour rester léger sur des tableaux déjà denses.
function Pager({ page, setPage, total }) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const clamped = Math.min(Math.max(1, page), pageCount)
  if (pageCount <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)', font: '400 13px/1.25 var(--font-data)', color: 'var(--text-muted)' }}>
      <Button size="sm" disabled={clamped <= 1} onClick={() => setPage(clamped - 1)}>‹ Précédent</Button>
      <span>Page {clamped} / {pageCount}</span>
      <Button size="sm" disabled={clamped >= pageCount} onClick={() => setPage(clamped + 1)}>Suivant ›</Button>
    </div>
  )
}
const pageSlice = (rows, page) => { const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); const p = Math.min(Math.max(1, page), pageCount); return rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE) }
const CATS = [['gaz', 'Gaz'], ['lubrifiant', 'Lubrifiant'], ['superette', 'Supérette']]
const MOVEMENT_LABEL = { entree: 'Livraison', sortie: 'Sortie', ajustement: 'Inventaire' }

// Raisons proposées dans la tuile "Autre mouvement" — le sens (+/-) est dérivé
// automatiquement du type associé, l'utilisateur ne choisit jamais de signe.
const AUTRE_MOUVEMENT_SOURCES = [
  { source: 'casse', type: 'sortie' },
  { source: 'perte', type: 'sortie' },
  { source: 'consommation_interne', type: 'sortie' },
  { source: 'retour_fournisseur', type: 'sortie' },
  { source: 'retour_client', type: 'entree' },
  { source: 'vente', type: 'sortie' },
]

export default function Stock() {
  const { session, isAdmin, isVendeuse, isPompiste } = useAuth()
  const { stationId } = useStation()
  const { activite } = useOffre()   // activités incluses dans l'offre de la station courante
  const [stock, setStock] = useState([])
  const [valeur, setValeur] = useState([])
  const [mvts, setMvts] = useState([])
  const [sorties, setSorties] = useState([])
  const [theorique, setTheorique] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [products, setProducts] = useState([])
  const [histProduit, setHistProduit] = useState('')
  const [action, setAction] = useState(null)   // null | 'entree' | 'ajustement'
  const [nm, setNm] = useState(blank('entree'))
  const [fYears, setFYears] = useState([String(today().slice(0, 4))])
  const [fMonths, setFMonths] = useState([today().slice(5, 7)])
  const [fProduit, setFProduit] = useState('')
  const [catTab, setCatTab] = useState('gaz')   // onglet de catégorie actif (Gaz / Lubrifiant / Supérette) — regroupe toutes les infos de cette catégorie
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sortiesPage, setSortiesPage] = useState(1)
  const [histPage, setHistPage] = useState(1)
  const [journalPage, setJournalPage] = useState(1)
  const [stockPage, setStockPage] = useState(1)
  const [stockSearch, setStockSearch] = useState('')
  useEffect(() => { setSortiesPage(1); setHistPage(1); setJournalPage(1); setStockPage(1); setStockSearch('') }, [catTab])

  function openAction(action, overrides) { setNm({ ...blank(action), ...overrides }); setAction(action); setErr('') }
  function blank(action) {
    const base = { categorie: isVendeuse ? 'superette' : (activite('gaz') ? 'gaz' : activite('lubrifiant') ? 'lubrifiant' : 'superette'), produit: '', quantite: '', qteCartons: '', qteUnites: '', valeur: '', note: '', date_mouvement: today() }
    if (action === 'sortie') return { ...base, type: 'sortie', source: 'casse' }
    if (action === 'ajustement') return { ...base, type: 'ajustement', source: 'inventaire' }
    if (action === 'correction') return { ...base, type: 'ajustement', source: 'correction_inventaire' }
    return { ...base, type: 'entree', source: 'achat' }
  }

  async function load() {
    if (!stationId) return
    const [sp, sv, mv, so, pr, th, sn] = await Promise.all([
      supabase.from('v_stock_produits').select('*').eq('station_id', stationId),
      supabase.from('v_stock_valeur').select('*').eq('station_id', stationId),
      supabase.from('stock_movements').select('*').eq('station_id', stationId).order('date_mouvement', { ascending: false }).limit(400),
      supabase.from('v_sorties_deduites').select('*').eq('station_id', stationId).order('report_date', { ascending: false }).limit(400),
      supabase.from('products').select('*').eq('actif', true).order('ordre'),
      supabase.from('v_stock_theorique').select('*').eq('station_id', stationId),
      supabase.from('stock_declarations_snapshot').select('*').eq('station_id', stationId).order('report_date', { ascending: false }).limit(200),
    ])
    setStock(sp.data || []); setValeur(sv.data || []); setMvts(mv.data || []); setSorties(so.data || []); setProducts(pr.data || [])
    setTheorique(th.data || []); setSnapshots(sn.data || [])
  }
  useEffect(() => { load() }, [stationId])
  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500) }

  async function addMvt(e) {
    e.preventDefault(); setErr('')
    if (busy) return   // garde anti double-clic/double-soumission (pas de protection côté DB sur cet insert)
    if (action === 'correction' && !nm.note.trim()) { setErr("Motif obligatoire pour une correction d'inventaire."); return }
    const row = { station_id: stationId, categorie: nm.categorie, type: nm.type, source: nm.source || null, note: nm.note || null, date_mouvement: nm.date_mouvement, created_by: session.user.id }
    if (!nm.produit) { setErr('Choisissez un produit.'); return }
    const pr = products.find(p => p.categorie === nm.categorie && p.nom === nm.produit)
    const hasCondit = pr && N(pr.conditionnement_qte) > 0
    row.produit = nm.produit
    if (hasCondit) {
      const cartons = N(nm.qteCartons), unites = N(nm.qteUnites)
      const total = cartons * N(pr.conditionnement_qte) + unites
      if (!total) { setErr('Renseignez une quantité.'); return }
      row.quantite = total
      row.facteur_conversion = N(pr.conditionnement_qte)
      if (cartons && unites) {
        row.unite_saisie = 'mixte'; row.qte_saisie = total
        row.detail_saisie = `${cartons} ${pr.conditionnement_nom || 'carton'}${cartons > 1 ? 's' : ''} + ${unites} ${pr.unite || 'unité'}${unites > 1 ? 's' : ''}`
      } else if (cartons) { row.unite_saisie = pr.conditionnement_nom || 'carton'; row.qte_saisie = cartons }
      else { row.unite_saisie = pr.unite || 'unite'; row.qte_saisie = unites }
    } else {
      if (!nm.quantite) { setErr('Renseignez une quantité.'); return }
      row.quantite = numFR(nm.quantite)
      row.unite_saisie = pr?.unite || 'unite'; row.qte_saisie = row.quantite
    }
    // Supérette : suivie en valeur en plus de la quantité (valorisation existante, v_stock_valeur) —
    // le montant se déduit du prix catalogue plutôt que d'être tapé à la main.
    if (nm.categorie === 'superette') row.valeur = row.quantite * N(pr?.prix_achat)
    setBusy(true)
    const { error } = await supabase.from('stock_movements').insert(row)
    setBusy(false)
    if (error) setErr(error.message)
    else {
      setAction(null)
      flash({ entree: 'Livraison enregistrée', sortie: 'Mouvement enregistré', ajustement: 'Inventaire corrigé', correction: "Correction d'inventaire enregistrée" }[action] || 'Mouvement enregistré')
      load()
    }
  }
  async function delMvt(id) { await supabase.from('stock_movements').delete().eq('id', id); load() }

  const valTotal = valeur.reduce((s, v) => s + N(v.valeur), 0)
  const stockByCat = useMemo(() => { const o = {}; stock.forEach(s => { (o[s.categorie] = o[s.categorie] || []).push(s) }); return o }, [stock])
  // Catégories limitées aux activités de l'offre de la station.
  const cats = (isVendeuse ? [['superette', 'Supérette']] : CATS).filter(([k]) => activite(k))
  const premiereCat = cats[0]?.[0]
  useEffect(() => { if (premiereCat && !cats.some(([k]) => k === catTab)) setCatTab(premiereCat) }, [premiereCat, catTab])

  // Produits sous seuil, toutes catégories confondues (gaz, lubrifiant, supérette).
  const lowStockItems = useMemo(() => stock
    .map(s => ({ ...s, pr: products.find(p => p.categorie === s.categorie && p.nom === s.produit) }))
    .filter(s => s.pr && N(s.stock) < N(s.pr.seuil)), [stock, products])

  // Tendance = dernier écart (jour − veille) connu par produit, tiré de v_sorties_deduites
  // (déjà trié report_date desc) : le premier match par produit est donc le plus récent.
  const latestTrendByProduct = useMemo(() => {
    const o = {}
    for (const s of sorties) {
      const key = s.categorie + '|' + s.produit
      if (!(key in o)) o[key] = N(s.stock_jour) - N(s.stock_veille)
    }
    return o
  }, [sorties])

  // Théorique vs déclaré (points 7-9 du cahier des charges lubrifiant) : le stock déclaré
  // reste la référence affichée ailleurs (Stock restant) — ce panneau compare en plus au
  // stock reconstruit depuis les mouvements, pour faire apparaître un écart à justifier.
  const ecartRows = useMemo(() => theorique
    .filter(t => t.categorie === 'lubrifiant')
    .map(t => ({ ...t, ecart: N(t.stock_declare) - N(t.stock_theorique) })), [theorique])

  const REGUL_SOURCES = ['casse', 'perte', 'consommation_interne', 'retour_fournisseur', 'retour_client', 'vente', 'correction_inventaire']
  const histRows = useMemo(() => snapshots
    .filter(s => s.categorie === 'lubrifiant' && (!histProduit || s.produit === histProduit))
    .map(s => {
      const regularisations = mvts.filter(m => m.categorie === s.categorie && m.produit === s.produit && m.date_mouvement === s.report_date && REGUL_SOURCES.includes(m.source)).length
      const cur = theorique.find(t => t.categorie === s.categorie && t.produit === s.produit)
      const isLatest = cur && cur.date_declare === s.report_date
      return { ...s, id: s.id, regularisations, ecartFinal: isLatest ? N(cur.stock_declare) - N(cur.stock_theorique) : null }
    }), [snapshots, mvts, theorique, histProduit])

  const ecartColumns = [
    { key: 'produit', header: 'Produit' },
    { key: 'stock_declare', header: 'Déclaré', numeric: true, align: 'right', render: t => N(t.stock_declare) },
    { key: 'stock_theorique', header: 'Théorique', numeric: true, align: 'right', muted: true, render: t => N(t.stock_theorique) },
    { key: 'ecart', header: 'Écart', numeric: true, align: 'right', render: t => (
      <span style={{ fontWeight: 600, color: Math.abs(t.ecart) < 0.5 ? 'var(--state-ok)' : 'var(--state-alarm)' }}>{t.ecart > 0 ? '+' : ''}{t.ecart}</span>
    ) },
    { key: 'actions', header: '', align: 'right', render: t => Math.abs(t.ecart) >= 0.5 && !isVendeuse ? (
      <Button size="sm" tone="alarm" onClick={() => openAction('sortie', { categorie: 'lubrifiant', produit: t.produit })}>Expliquer l'écart</Button>
    ) : null },
  ]


  const histColumns = [
    { key: 'report_date', header: 'Date', render: s => frDate(s.report_date) },
    { key: 'produit', header: 'Produit' },
    { key: 'stock_theorique_a_la_declaration', header: 'Théorique', numeric: true, align: 'right', muted: true, render: s => N(s.stock_theorique_a_la_declaration) },
    { key: 'stock_declare', header: 'Déclaré', numeric: true, align: 'right', render: s => N(s.stock_declare) },
    { key: 'ecart_initial', header: 'Écart initial', numeric: true, align: 'right', render: s => <span style={{ color: Math.abs(N(s.ecart_initial)) < 0.5 ? 'var(--state-ok)' : 'var(--state-alarm)' }}>{N(s.ecart_initial) > 0 ? '+' : ''}{N(s.ecart_initial)}</span> },
    { key: 'regularisations', header: 'Mvts régul.', numeric: true, align: 'right', muted: true, render: s => s.regularisations || '—' },
    { key: 'ecartFinal', header: 'Écart final', numeric: true, align: 'right', render: s => s.ecartFinal == null ? <span style={{ color: 'var(--text-muted)' }}>figé</span> : <span style={{ fontWeight: 600, color: Math.abs(s.ecartFinal) < 0.5 ? 'var(--state-ok)' : 'var(--state-alarm)' }}>{s.ecartFinal > 0 ? '+' : ''}{s.ecartFinal}</span> },
  ]

  const productColumns = (cat) => [
    { key: 'produit', header: 'Produit' },
    { key: 'stock', header: 'Reste', numeric: true, align: 'right', render: s => {
      const pr = products.find(p => p.categorie === cat && p.nom === s.produit)
      const low = pr && N(s.stock) < N(pr.seuil)
      const trend = latestTrendByProduct[cat + '|' + s.produit]
      return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <span style={{ fontWeight: 600 }}>{N(s.stock)}</span>{low && <Badge tone="alarm">Bas</Badge>}
        </span>
        {!!trend && <span style={{ font: '400 12px/1.25 var(--font-data)', color: trend < 0 ? 'var(--state-alarm)' : 'var(--state-ok)' }}>
          {trend < 0 ? '↓' : '↑'}{Math.abs(trend)} depuis hier
        </span>}
      </div>
    } },
    { key: 'seuil', header: 'Seuil', numeric: true, align: 'right', muted: true, render: s => { const pr = products.find(p => p.categorie === cat && p.nom === s.produit); return pr ? N(pr.seuil) : '—' } },
  ]

  const sortieColumns = [
    { key: 'report_date', header: 'Date', render: s => frDate(s.report_date) },
    { key: 'produit', header: 'Produit' },
    { key: 'stock_veille', header: 'Veille', numeric: true, align: 'right', muted: true, render: s => N(s.stock_veille) },
    { key: 'entrees', header: 'Entrées', numeric: true, align: 'right', muted: true, render: s => N(s.entrees) },
    { key: 'stock_jour', header: 'Jour', numeric: true, align: 'right', muted: true, render: s => N(s.stock_jour) },
    { key: 'sortie_deduite', header: 'Sortie déduite', numeric: true, align: 'right', render: s => <span style={{ fontWeight: 600, color: N(s.sortie_deduite) < 0 ? 'var(--state-alarm)' : 'inherit' }}>{N(s.sortie_deduite)}</span> },
  ]

  const journalColumns = [
    { key: 'date_mouvement', header: 'Date', render: m => frDate(m.date_mouvement) },
    { key: 'produit', header: 'Produit', render: m => m.produit || '—' },
    { key: 'type', header: 'Type', render: m => <Badge tone={STOCK_MOVEMENT_TONES[m.type] || 'idle'}>{m.type}</Badge> },
    { key: 'source', header: 'Source', render: m => m.source ? <Badge tone={STOCK_SOURCE_TONES[m.source]?.tone || 'idle'}>{STOCK_SOURCE_TONES[m.source]?.label || m.source}</Badge> : '—' },
    { key: 'valeur', header: 'Qté / Valeur', numeric: true, align: 'right', render: m => m.valeur != null ? fcfa(m.valeur) : N(m.quantite) },
    { key: 'actions', header: '', align: 'right', render: m => <Button size="sm" tone="danger" onClick={() => delMvt(m.id)}>✕</Button> },
  ]

  const recentColumns = [
    { key: 'date_mouvement', header: 'Date', render: m => frDate(m.date_mouvement) },
    { key: 'produit', header: 'Produit', render: m => m.produit || m.categorie },
    { key: 'type', header: 'Type', render: m => <Badge tone={STOCK_MOVEMENT_TONES[m.type] || 'idle'}>{STOCK_SOURCE_TONES[m.source]?.label || MOVEMENT_LABEL[m.type] || m.type}</Badge> },
    { key: 'valeur', header: 'Qté / Montant', numeric: true, align: 'right', render: m => m.valeur != null ? fcfa(m.valeur) : N(m.quantite) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      {/* ===== ACTIONS GUIDÉES — tout le monde, en premier ===== */}
      <Panel title={isVendeuse ? 'Supérette' : 'Que voulez-vous faire ?'}>
        {!action ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-4)' }}>
            <ActionTile icon="download" title="J'ai reçu une livraison" desc="Ajouter au stock ce qui vient d'arriver" onClick={() => openAction('entree')} />
            <ActionTile icon="rotate-ccw" title="Autre mouvement" desc="Casse, perte, consommation interne, retour…" onClick={() => openAction('sortie')} />
            <ActionTile icon="wrench" title="Corriger après inventaire" desc="Ajuster si le compte réel diffère" onClick={() => openAction('ajustement')} />
            {isAdmin && <ActionTile icon="shield-alert" title="Correction d'inventaire" desc="Dernier recours — écart inexpliqué, motif obligatoire" onClick={() => openAction('correction')} />}
          </div>
        ) : (
          <form onSubmit={addMvt} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <AlertBanner tone={action === 'entree' ? 'ok' : action === 'correction' ? 'alarm' : 'warn'} title={{ entree: 'Livraison', sortie: 'Autre mouvement', ajustement: 'Correction', correction: "Correction d'inventaire" }[action]}>
              {{
                entree: 'Livraison reçue — indique ce qui est entré en stock.',
                sortie: 'Choisissez la raison : le sens (+/-) est appliqué automatiquement.',
                ajustement: "Correction d'inventaire — indique l'écart constaté (positif si trouvé en plus, négatif si manquant).",
                correction: "Dernier recours si l'écart ne s'explique par aucun mouvement normal — motif obligatoire, mouvement identifié distinctement.",
              }[action]}
            </AlertBanner>
            {!isVendeuse && (
              <Field label="Type de produit">
                <Select value={nm.categorie} onChange={e => setNm({ ...nm, categorie: e.target.value, produit: '', quantite: '', qteCartons: '', qteUnites: '' })} options={cats.map(([v, l]) => ({ value: v, label: l }))} style={{ width: '100%' }} />
              </Field>
            )}
            {action === 'sortie' && (
              <Field label="Raison">
                <Select value={nm.source} onChange={e => {
                  const s = AUTRE_MOUVEMENT_SOURCES.find(s => s.source === e.target.value)
                  setNm({ ...nm, source: e.target.value, type: s?.type || 'sortie' })
                }} options={AUTRE_MOUVEMENT_SOURCES.map(s => ({ value: s.source, label: STOCK_SOURCE_TONES[s.source]?.label || s.source }))} style={{ width: '100%' }} />
              </Field>
            )}
            <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              <Field label="Produit" style={{ flex: '2 1 200px' }}>
                <Select value={nm.produit} onChange={e => setNm({ ...nm, produit: e.target.value, quantite: '', qteCartons: '', qteUnites: '' })}
                  options={[{ value: '', label: '— choisir —' }, ...products.filter(p => p.categorie === nm.categorie).map(p => ({ value: p.nom, label: p.nom }))]} style={{ width: '100%' }} />
              </Field>
              {(() => {
                const pr = products.find(p => p.categorie === nm.categorie && p.nom === nm.produit)
                const hasCondit = pr && N(pr.conditionnement_qte) > 0
                if (!hasCondit) {
                  return (
                    <Field label={`Quantité${action === 'ajustement' ? ' (écart)' : ''}`} style={{ flex: '1 1 140px' }}>
                      <Input type="text" inputMode="decimal" numeric value={nm.quantite} onChange={e => setNm({ ...nm, quantite: e.target.value })} />
                    </Field>
                  )
                }
                const total = N(nm.qteCartons) * N(pr.conditionnement_qte) + N(nm.qteUnites)
                return (
                  <>
                    <Field label={`Nb. ${pr.conditionnement_nom || 'carton'}s`} style={{ flex: '1 1 120px' }}>
                      <Input type="text" inputMode="decimal" numeric value={nm.qteCartons} onChange={e => setNm({ ...nm, qteCartons: e.target.value })} />
                    </Field>
                    <Field label={`Nb. ${pr.unite || 'unité'}s`} style={{ flex: '1 1 120px' }}>
                      <Input type="text" inputMode="decimal" numeric value={nm.qteUnites} onChange={e => setNm({ ...nm, qteUnites: e.target.value })} />
                    </Field>
                    <div style={{ flex: '1 1 140px', display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                      <Tag>= {total} {pr.unite || 'unité'}{total > 1 ? 's' : ''}</Tag>
                    </div>
                  </>
                )
              })()}
              <Field label="Date" style={{ flex: '1 1 160px' }}>
                <Input type="date" value={nm.date_mouvement} max={today()} onChange={e => setNm({ ...nm, date_mouvement: e.target.value })} />
              </Field>
            </div>
            <Field label={action === 'correction' ? 'Motif (obligatoire)' : 'Note (facultatif)'}>
              <Input value={nm.note} onChange={e => setNm({ ...nm, note: e.target.value })} placeholder={action === 'entree' ? 'ex. bon de livraison n°…' : action === 'correction' ? "ex. écart d'inventaire du 18/08/2026" : 'ex. casse, écart constaté…'} />
            </Field>
            <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
              <Button type="submit" tone="primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
              <Button type="button" onClick={() => setAction(null)}>Annuler</Button>
            </div>
          </form>
        )}
      </Panel>

      {/* ===== MÉTRIQUES — stock bas + valorisation, une seule ligne — gérant/pompiste/admin ===== */}
      {!isVendeuse && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
          <Kpi label="Produits sous seuil" value={lowStockItems.length} status={lowStockItems.length > 0 ? 'alarm' : 'ok'} />
          {isAdmin && valeur.map(v => <Kpi key={v.categorie} label={`Valeur stock ${v.categorie}`} value={fcfa(v.valeur)} />)}
          {isAdmin && <Kpi label="VALEUR TOTALE" value={fcfa(valTotal)} status="accent" />}
        </div>
      )}
      {!isVendeuse && lowStockItems.length > 0 && (
        <AlertBanner tone="alarm" title="Stock bas">
          {lowStockItems.map(s => `${s.produit} (${N(s.stock)}/${N(s.pr.seuil)})`).join(' · ')}
        </AlertBanner>
      )}

      {/* ===== 3 ONGLETS PAR CATÉGORIE — chacun regroupe TOUTES les infos de son pôle
          (stock, suggestions de commande, écarts, historique, sorties déduites, journal) —
          au lieu de panneaux séparés dispersés sur la page. ===== */}
      {!isVendeuse && (() => {
        const catLabel = { gaz: 'Gaz', lubrifiant: 'Lubrifiant', superette: 'Supérette' }[catTab]
        const inPeriod = (d) => (!fYears.length || fYears.includes((d || '').slice(0, 4))) && (!fMonths.length || fMonths.includes((d || '').slice(5, 7)))
        const sortiesCat = sorties.filter(s => s.categorie === catTab && inPeriod(s.report_date))
        const mvtsCat = mvts.filter(m => m.categorie === catTab)
        const years = [...new Set([...mvtsCat.map(m => (m.date_mouvement || '').slice(0, 4)).filter(Boolean), today().slice(0, 4)])].sort()
        const jm = mvtsCat.filter(m =>
          inPeriod(m.date_mouvement)
          && (!fProduit || (m.produit || '').toLowerCase().includes(fProduit.toLowerCase())))
        const totVal = jm.reduce((s, m) => s + (m.valeur != null ? N(m.valeur) * (m.type === 'sortie' ? -1 : 1) : 0), 0)
        const valeurCat = valeur.find(v => v.categorie === catTab)
        const recent = mvtsCat.slice(0, 15)
        const SectionLabel = ({ children }) => (
          <div style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>{children}</div>
        )

        return (
          <Panel title={`${catLabel} — toutes les infos`} flush>
            <Tabs items={cats.map(([value, label]) => ({ value, label }))} value={catTab} onChange={setCatTab} />
            <div style={{ padding: 'var(--gutter-panel)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>

              <div>
                <SectionLabel>Stock restant</SectionLabel>
                <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                  {catTab !== 'superette'
                    ? <>Ce qu'il reste, d'après le <b>dernier comptage déclaré dans la Saisie du jour</b>. Ici, vous n'ajoutez que les <b>entrées</b> (livraisons) — les sorties/ventes sont calculées toutes seules.</>
                    : <>Ce qu'il reste, calculé depuis les livraisons, sorties et corrections enregistrées ici — pas de déclaration quotidienne à faire, contrairement au gaz et au lubrifiant.</>}
                </p>
                {(stockByCat[catTab] || []).length ? (() => {
                  const all = (stockByCat[catTab] || []).map(s => ({ ...s, id: s.produit }))
                  const rows = all.filter(s => !stockSearch || (s.produit || '').toLowerCase().includes(stockSearch.toLowerCase()))
                  return (<>
                    {all.length > PAGE_SIZE && <Input size="sm" value={stockSearch} onChange={e => setStockSearch(e.target.value)} placeholder="Rechercher un produit…" style={{ maxWidth: 280, marginBottom: 'var(--sp-3)' }} />}
                    {rows.length
                      ? (<><DataTable columns={productColumns(catTab)} rows={pageSlice(rows, stockPage)} /><Pager page={stockPage} setPage={setStockPage} total={rows.length} /></>)
                      : <PanelEmpty icon="search" label="Aucun produit ne correspond à la recherche." />}
                  </>)
                })() : <p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>{catTab !== 'superette' ? 'Aucun comptage encore.' : 'Aucun mouvement encore.'}</p>}
              </div>

              {catTab === 'superette' && isAdmin && (
                <div>
                  <SectionLabel>Valorisation</SectionLabel>
                  <Kpi label="Valeur stock supérette" value={fcfa(N(valeurCat?.valeur))} />
                </div>
              )}

              {catTab === 'superette' && isAdmin && (() => {
                const refAujourdhui = `saisie-vendeuse-${today()}`
                const saisieJour = mvtsCat.filter(m => m.ref === refAujourdhui)
                const vendu = saisieJour.filter(m => m.source === 'vente')
                const recu = saisieJour.filter(m => m.source === 'achat')
                const perime = saisieJour.filter(m => m.source === 'perte')
                return (
                  <div>
                    <SectionLabel>Saisie vendeuse du jour</SectionLabel>
                    {saisieJour.length ? (<>
                      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
                        <Tag>{vendu.length} vendu{vendu.length > 1 ? 's' : ''}</Tag>
                        <Tag>{recu.length} reçu{recu.length > 1 ? 's' : ''}</Tag>
                        <Tag>{perime.length} périmé{perime.length > 1 ? 's' : ''}</Tag>
                      </div>
                      <DataTable columns={journalColumns} rows={saisieJour} />
                    </>) : <PanelEmpty icon="calendar-days" label="Rien saisi par la vendeuse aujourd'hui pour l'instant." />}
                  </div>
                )
              })()}


              {catTab === 'lubrifiant' && ecartRows.length > 0 && (
                <div>
                  <SectionLabel>Théorique vs déclaré</SectionLabel>
                  <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                    Théorique = dernier stock déclaré + mouvements enregistrés depuis. Si l'écart n'est pas nul, cherche la cause (casse, perte…) avant de recourir à une correction d'inventaire.
                  </p>
                  <DataTable columns={ecartColumns} rows={ecartRows.map((r, i) => ({ ...r, id: i }))} />
                </div>
              )}

              {catTab === 'lubrifiant' && isAdmin && snapshots.length > 0 && (
                <div>
                  <SectionLabel>Historique quotidien</SectionLabel>
                  <div style={{ marginBottom: 'var(--sp-3)' }}>
                    <Select size="sm" value={histProduit} onChange={e => setHistProduit(e.target.value)}
                      options={[{ value: '', label: 'Tous les produits' }, ...products.filter(p => p.categorie === 'lubrifiant').map(p => ({ value: p.nom, label: p.nom }))]} />
                  </div>
                  {histRows.length ? (<>
                    <DataTable columns={histColumns} rows={pageSlice(histRows, histPage)} />
                    <Pager page={histPage} setPage={setHistPage} total={histRows.length} />
                  </>) : <PanelEmpty icon="calendar-days" label="Aucune déclaration figée pour l'instant" />}
                </div>
              )}

              {isAdmin && catTab !== 'superette' && (
                <div>
                  <SectionLabel>Sorties déduites (consommation)</SectionLabel>
                  <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                    Sortie = stock déclaré la veille + entrées du jour − stock déclaré du jour. Négatif = entrée oubliée (à vérifier).
                  </p>
                  {sortiesCat.length ? (<>
                    <DataTable columns={sortieColumns} rows={pageSlice(sortiesCat.map((s, i) => ({ ...s, id: i })), sortiesPage)} />
                    <Pager page={sortiesPage} setPage={setSortiesPage} total={sortiesCat.length} />
                  </>) : <PanelEmpty icon="package" label="Rien à afficher (il faut au moins deux relevés consécutifs)" />}
                </div>
              )}

              {isAdmin ? (
                <div>
                  <SectionLabel>Journal des mouvements</SectionLabel>
                  <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
                    <Input size="sm" value={fProduit} onChange={e => setFProduit(e.target.value)} placeholder="Rechercher un produit…" style={{ flex: '1 1 180px' }} />
                    <PeriodPicker years={fYears} months={fMonths} setYears={setFYears} setMonths={setFMonths} availableYears={years} />
                    {(fYears.length || fMonths.length || fProduit) && <Button size="sm" onClick={() => { setFYears([]); setFMonths([]); setFProduit('') }}>Réinit.</Button>}
                    <Tag>Solde : {fcfa(totVal)}</Tag>
                  </div>
                  {jm.length ? (<>
                    <DataTable columns={journalColumns} rows={pageSlice(jm, journalPage)} />
                    <Pager page={journalPage} setPage={setJournalPage} total={jm.length} />
                  </>) : <PanelEmpty icon="calendar-days" label="Aucun mouvement sur cette période" />}
                </div>
              ) : (
                <div>
                  <SectionLabel>Mes dernières entrées</SectionLabel>
                  {recent.length ? <DataTable columns={recentColumns} rows={recent} /> : <PanelEmpty icon="calendar-days" label="Rien enregistré pour l'instant" />}
                </div>
              )}
            </div>
          </Panel>
        )
      })()}

      {/* ===== VENDEUSE — pas d'onglets par catégorie, juste ses dernières entrées supérette ===== */}
      {isVendeuse && (() => {
        const recent = mvts.filter(m => m.categorie === 'superette').slice(0, 15)
        return (
          <Panel title="Mes dernières entrées" flush>
            {recent.length ? <DataTable columns={recentColumns} rows={recent} /> : <PanelEmpty icon="calendar-days" label="Rien enregistré pour l'instant" />}
          </Panel>
        )
      })()}
    </div>
  )
}

function ActionTile({ icon, title, desc, onClick }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-6)', textAlign: 'center', cursor: 'pointer', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-1)', transition: 'var(--t-control)' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)' }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)' }}>
      <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent-quiet)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} />
      </span>
      <div style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ font: '400 14px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>{desc}</div>
    </div>
  )
}
