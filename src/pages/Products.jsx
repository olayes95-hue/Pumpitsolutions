import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { numFR } from '../lib/format'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
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
  const [nf, setNf] = useState({ nom: '', unite: 'unité', prix_achat: '', prix_vente: '', seuil: '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  async function load() { setList((await supabase.from('products').select('*').order('categorie').order('ordre')).data || []) }
  useEffect(() => { load() }, [])
  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2000) }
  const up = (id, k, v) => setList(p => p.map(x => x.id === id ? { ...x, [k]: v } : x))

  async function add(e) {
    e.preventDefault(); setErr(''); if (!nf.nom) return
    const { error } = await supabase.from('products').insert({
      categorie: cat, nom: nf.nom, unite: nf.unite,
      prix_achat: numFR(nf.prix_achat), prix_vente: numFR(nf.prix_vente), seuil: numFR(nf.seuil) ?? 0,
      ordre: (list.filter(p => p.categorie === cat).length + 1) * 10 })
    if (error) setErr(error.message); else { setNf({ nom: '', unite: 'unité', prix_achat: '', prix_vente: '', seuil: '' }); flash('Produit ajouté'); load() }
  }
  async function save(p) {
    const { error } = await supabase.from('products').update({
      nom: p.nom, unite: p.unite, prix_achat: numFR(p.prix_achat), prix_vente: numFR(p.prix_vente),
      seuil: numFR(p.seuil) ?? 0, actif: p.actif, ordre: numFR(p.ordre),
      unite_stock: p.unite_stock || null, conditionnement_nom: p.conditionnement_nom || null,
      conditionnement_qte: numFR(p.conditionnement_qte) }).eq('id', p.id)
    error ? setErr(error.message) : flash('Enregistré')
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
  const shown = list.filter(p => p.categorie === cat && p.statut !== 'en_attente')

  const pendingColumns = [
    { key: 'nom', header: 'Nom', render: p => <Input size="sm" value={p.nom || ''} onChange={e => up(p.id, 'nom', e.target.value)} /> },
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
    { key: 'nom', header: 'Nom', render: p => <Input size="sm" value={p.nom || ''} onChange={e => up(p.id, 'nom', e.target.value)} /> },
    { key: 'unite', header: 'Unité', render: p => <Select size="sm" value={p.unite || 'unité'} onChange={e => up(p.id, 'unite', e.target.value)} options={UNITE_OPTIONS} style={{ width: '100%' }} /> },
    ...(cat === 'lubrifiant' ? [
      { key: 'conditionnement_nom', header: 'Conditionnement', render: p => <Input size="sm" value={p.conditionnement_nom || ''} onChange={e => up(p.id, 'conditionnement_nom', e.target.value)} placeholder="ex : carton" style={{ width: 100 }} /> },
      { key: 'conditionnement_qte', header: 'Qté/condit.', align: 'right', render: p => <Input size="sm" numeric value={p.conditionnement_qte ?? ''} onChange={e => up(p.id, 'conditionnement_qte', e.target.value)} placeholder="ex : 12" style={{ width: 70 }} /> },
    ] : []),
    { key: 'prix_achat', header: 'Prix achat', align: 'right', render: p => <Input size="sm" numeric value={p.prix_achat ?? ''} onChange={e => up(p.id, 'prix_achat', e.target.value)} style={{ width: 90 }} /> },
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
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          {CATS.map(c => <Button key={c} size="sm" tone={cat === c ? 'dark' : 'neutral'} onClick={() => setCat(c)} style={{ textTransform: 'capitalize' }}>{c}</Button>)}
        </div>
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

      <Panel title={cat} meta={`${shown.length}`} flush>
        {shown.length
          ? <DataTable columns={columns} rows={shown} />
          : <p style={{ padding: 'var(--gutter-panel)', font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Aucun produit.</p>}
        <form onSubmit={add} style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'end', padding: 'var(--gutter-panel)', borderTop: '1px solid var(--border-hairline)' }}>
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
      </Panel>
      </>)}

      {tab === 'prix' && <PriceHistory />}
    </div>
  )
}
