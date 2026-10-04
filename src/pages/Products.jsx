import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { numFR } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'
import PriceHistory from './PriceHistory.jsx'

const CATS = ['gaz', 'lubrifiant', 'superette', 'autre']
const UNITES = ['bouteille', 'bidon', 'carton', 'fût', 'unité', 'litre', 'valeur']
const UNITE_OPTIONS = UNITES.map(u => ({ value: u, label: u }))
const CAT_OPTIONS = CATS.map(c => ({ value: c, label: c }))

export default function Products() {
  const { isAdmin, can } = useAuth()
  // Catalogue : réservé à qui gère les produits. Historique des prix : aussi ouvert au
  // directeur (permission séparée, voir migration_v101) — simple consultation, pas d'édition.
  const TABS = [
    (isAdmin || can('manage_products')) && { value: 'catalogue', label: 'Catalogue' },
    (isAdmin || can('view_price_history')) && { value: 'prix', label: 'Historique des prix' },
  ].filter(Boolean)
  const [tab, setTab] = useState(() => TABS[0]?.value || 'catalogue')
  const [list, setList] = useState([])
  const [cat, setCat] = useState('gaz')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [dirty, setDirty] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [nf, setNf] = useState({ nom: '', unite: 'unité', prix_achat: '', prix_vente: '', seuil: '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  async function load() { setList((await supabase.from('products').select('*').order('categorie').order('ordre')).data || []) }
  useEffect(() => { load() }, [])
  useEffect(() => { setPage(1) }, [cat, search])
  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2000) }
  // Prix du gros (carton) renseigné + conditionnement connu => le prix d'achat unité se déduit
  // (gros ÷ qté/condit.) au lieu d'être tapé à la main ; reste modifiable ensuite si besoin.
  const up = (id, k, v) => {
    setDirty(d => new Set(d).add(id))
    setList(p => p.map(x => {
      if (x.id !== id) return x
      const next = { ...x, [k]: v }
      if (k === 'prix_achat_gros' || k === 'conditionnement_qte') {
        const gros = numFR(k === 'prix_achat_gros' ? v : next.prix_achat_gros)
        const qte = numFR(k === 'conditionnement_qte' ? v : next.conditionnement_qte)
        if (gros && qte) next.prix_achat = String(Math.round(gros / qte))
      }
      return next
    }))
  }

  async function add(e) {
    e.preventDefault(); setErr(''); if (!nf.nom) return
    const { error } = await supabase.from('products').insert({
      categorie: cat, nom: nf.nom, unite: nf.unite,
      prix_achat: numFR(nf.prix_achat), prix_vente: numFR(nf.prix_vente), seuil: numFR(nf.seuil) ?? 0,
      ordre: (list.filter(p => p.categorie === cat).length + 1) * 10 })
    if (error) setErr(error.message); else { setNf({ nom: '', unite: 'unité', prix_achat: '', prix_vente: '', seuil: '' }); flash('Produit ajouté'); load() }
  }
  const productPayload = (p) => ({
    nom: p.nom, unite: p.unite, prix_achat: numFR(p.prix_achat), prix_vente: numFR(p.prix_vente),
    seuil: numFR(p.seuil) ?? 0, actif: p.actif, ordre: numFR(p.ordre),
    unite_stock: p.unite_stock || null, conditionnement_nom: p.conditionnement_nom || null,
    conditionnement_qte: numFR(p.conditionnement_qte), prix_achat_gros: numFR(p.prix_achat_gros) })
  async function save(p) {
    const { error } = await supabase.from('products').update(productPayload(p)).eq('id', p.id)
    if (error) setErr(error.message)
    else { setDirty(d => { const n = new Set(d); n.delete(p.id); return n }); flash('Enregistré') }
  }
  async function saveAll() {
    const toSave = list.filter(p => dirty.has(p.id))
    if (!toSave.length) return
    setSaving(true)
    const results = await Promise.all(toSave.map(p => supabase.from('products').update(productPayload(p)).eq('id', p.id)))
    setSaving(false)
    const failed = results.find(r => r.error)
    if (failed) setErr(failed.error.message)
    else { setDirty(new Set()); flash(`${toSave.length} produit(s) enregistré(s)`); load() }
  }
  async function del(id) { await supabase.from('products').delete().eq('id', id); load() }

  async function validate(p) {
    const { error } = await supabase.from('products').update({
      categorie: p.categorie, nom: p.nom, unite: p.unite,
      prix_achat: numFR(p.prix_achat), prix_vente: numFR(p.prix_vente), seuil: numFR(p.seuil) ?? 0,
      statut: 'valide', actif: true }).eq('id', p.id)
    error ? setErr(error.message) : (flash('Produit validé'), load())
  }
  async function reject(id) { await supabase.from('products').delete().eq('id', id); load() }

  const pending = list.filter(p => p.statut === 'en_attente')
  const shownAll = list.filter(p => p.categorie === cat && p.statut !== 'en_attente'
    && (!search || (p.nom || '').toLowerCase().includes(search.toLowerCase())))
  const pageCount = Math.max(1, Math.ceil(shownAll.length / pageSize))
  const shown = shownAll.slice((page - 1) * pageSize, page * pageSize)

  const pendingColumns = [
    { key: 'nom', header: 'Nom', width: 240, render: p => <Input size="sm" value={p.nom || ''} onChange={e => up(p.id, 'nom', e.target.value)} style={{ width: '100%' }} /> },
    { key: 'categorie', header: 'Catégorie', render: p => <Select size="sm" value={p.categorie || 'superette'} onChange={e => up(p.id, 'categorie', e.target.value)} options={CAT_OPTIONS} style={{ width: '100%' }} /> },
    { key: 'unite', header: 'Unité', render: p => <Select size="sm" value={p.unite || 'unité'} onChange={e => up(p.id, 'unite', e.target.value)} options={UNITE_OPTIONS} style={{ width: '100%' }} /> },
    { key: 'prix_achat', header: 'Prix achat', align: 'right', render: p => <Input size="sm" numeric value={p.prix_achat ?? ''} onChange={e => up(p.id, 'prix_achat', e.target.value)} style={{ width: 90 }} /> },
    { key: 'prix_vente', header: 'Prix vente', align: 'right', render: p => <Input size="sm" numeric value={p.prix_vente ?? ''} onChange={e => up(p.id, 'prix_vente', e.target.value)} style={{ width: 90 }} /> },
    { key: 'seuil', header: 'Seuil', align: 'right', render: p => <Input size="sm" numeric value={p.seuil ?? ''} onChange={e => up(p.id, 'seuil', e.target.value)} style={{ width: 70 }} /> },
    { key: 'actions', header: '', align: 'right', render: p => (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <Button size="sm" tone="dark" onClick={() => validate(p)}>Valider</Button>
        <Button size="sm" onClick={() => reject(p.id)}>Rejeter</Button>
      </div>
    ) },
  ]

  const columns = [
    { key: 'nom', header: 'Nom', width: 280, render: p => <Input size="sm" value={p.nom || ''} onChange={e => up(p.id, 'nom', e.target.value)} style={{ width: '100%' }} /> },
    { key: 'unite', header: 'Unité', render: p => <Select size="sm" value={p.unite || 'unité'} onChange={e => up(p.id, 'unite', e.target.value)} options={UNITE_OPTIONS} style={{ width: '100%' }} /> },
    ...(cat === 'lubrifiant' || cat === 'superette' ? [
      { key: 'conditionnement_nom', header: 'Conditionnement', render: p => <Input size="sm" value={p.conditionnement_nom || ''} onChange={e => up(p.id, 'conditionnement_nom', e.target.value)} placeholder="ex : carton" style={{ width: 100 }} /> },
      { key: 'conditionnement_qte', header: 'Qté/condit.', align: 'right', render: p => <Input size="sm" numeric value={p.conditionnement_qte ?? ''} onChange={e => up(p.id, 'conditionnement_qte', e.target.value)} placeholder="ex : 12" style={{ width: 70 }} /> },
      { key: 'prix_achat_gros', header: 'Prix du gros', align: 'right', render: p => <Input size="sm" numeric value={p.prix_achat_gros ?? ''} onChange={e => up(p.id, 'prix_achat_gros', e.target.value)} placeholder="carton" style={{ width: 90 }} /> },
    ] : []),
    { key: 'prix_achat', header: 'Prix achat (unité)', align: 'right', render: p => <Input size="sm" numeric value={p.prix_achat ?? ''} onChange={e => up(p.id, 'prix_achat', e.target.value)} style={{ width: 90 }} /> },
    { key: 'prix_vente', header: 'Prix vente', align: 'right', render: p => <Input size="sm" numeric value={p.prix_vente ?? ''} onChange={e => up(p.id, 'prix_vente', e.target.value)} style={{ width: 90 }} /> },
    { key: 'seuil', header: 'Seuil', align: 'right', render: p => <Input size="sm" numeric value={p.seuil ?? ''} onChange={e => up(p.id, 'seuil', e.target.value)} style={{ width: 70 }} /> },
    { key: 'actif', header: 'Actif', render: p => <Checkbox checked={!!p.actif} onChange={v => up(p.id, 'actif', v)} /> },
    { key: 'actions', header: '', align: 'right', render: p => (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <Button size="sm" tone="dark" onClick={() => save(p)}>OK</Button>
        <Button size="sm" tone="danger" onClick={() => del(p.id)}>✕</Button>
      </div>
    ) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'catalogue' && (<>
      <Panel title="Produits & prix">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Catalogue par catégorie avec prix d'achat, prix de vente et seuil d'alerte. (Le carburant se règle dans « Prix &amp; marge ».)
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            {CATS.map(c => <Button key={c} size="sm" tone={cat === c ? 'dark' : 'neutral'} onClick={() => setCat(c)} style={{ textTransform: 'capitalize' }}>{c}</Button>)}
          </div>
          <Button size="sm" tone="primary" onClick={() => setShowAddForm(s => !s)}>{showAddForm ? 'Annuler' : '+ Nouveau produit'}</Button>
        </div>
        {showAddForm && (
          <form onSubmit={add} style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'end', marginTop: 'var(--sp-4)', padding: 'var(--sp-4)', background: 'var(--brume)', borderRadius: 'var(--radius-1)' }}>
            <Field label="Nouveau produit" style={{ flex: '2 1 200px' }}>
              <Input value={nf.nom} onChange={e => setNf({ ...nf, nom: e.target.value })} placeholder={cat === 'superette' ? 'ex : Eau 1,5L' : 'nom'} />
            </Field>
            <Field label="Prix achat" style={{ flex: '1 1 100px' }}>
              <Input numeric value={nf.prix_achat} onChange={e => setNf({ ...nf, prix_achat: e.target.value })} />
            </Field>
            <Field label="Prix vente" style={{ flex: '1 1 100px' }}>
              <Input numeric value={nf.prix_vente} onChange={e => setNf({ ...nf, prix_vente: e.target.value })} />
            </Field>
            <Button type="submit" tone="primary">+ Ajouter à « {cat} »</Button>
          </form>
        )}
      </Panel>

      {pending.length > 0 && (
        <Panel title="Produits à valider" meta={`${pending.length}`} status="warn" flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            Ajoutés par une vendeuse pendant la vente. Corrigez la catégorie ou les prix si besoin, puis <b>Valider</b> (ou rejeter).
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <DataTable columns={pendingColumns} rows={pending} />
          </div>
        </Panel>
      )}

      <Panel title={cat} meta={`${shownAll.length}`} flush>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center', padding: 'var(--gutter-panel)', paddingBottom: 0 }}>
          <Input size="sm" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un produit…" style={{ flex: '1 1 220px' }} />
          {dirty.size > 0 && <Button size="sm" tone="dark" disabled={saving} onClick={saveAll}>{saving ? 'Enregistrement…' : `Enregistrer tout (${dirty.size})`}</Button>}
        </div>
        {shown.length
          ? <DataTable columns={columns} rows={shown} />
          : <PanelEmpty icon="book-open" label={search ? 'Aucun produit ne correspond à la recherche.' : 'Aucun produit.'} />}
        {shownAll.length > pageSize && (
          <Pagination page={page} pageCount={pageCount} total={shownAll.length} pageSize={pageSize}
            onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />
        )}
      </Panel>
      </>)}

      {tab === 'prix' && <PriceHistory />}
    </div>
  )
}
