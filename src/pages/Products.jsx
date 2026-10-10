import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa } from '../lib/format'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
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
// « Carburant » est un bouton d'onglet en plus, pas une catégorie de la table `products` :
// un seul essence + un seul gasoil par station (table `settings`), jamais un catalogue.
const DISPLAY_CATS = ['carburant', ...CATS]

function FormSection({ title, children }) {
  return (
    <div style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)' }}>
      <div style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>{title}</div>
      {children}
    </div>
  )
}

export default function Products() {
  const { isAdmin, can, session } = useAuth()
  const { stationId } = useStation()
  // peutEditerDirect : écrit directement products.prix_* (admin). peutProposer : accès en
  // mode "proposition" (chef de piste, voir migration_v139) — toute modification de prix
  // passe par product_price_requests, jamais d'écriture directe sur products pour ce profil.
  const peutEditerDirect = isAdmin || can('manage_products')
  const peutProposer = !peutEditerDirect && can('propose_prices')
  // Catalogue : réservé à qui gère les produits, ou qui peut proposer un prix. Historique
  // des prix : aussi ouvert au directeur (permission séparée, voir migration_v101) — simple
  // consultation, pas d'édition.
  const TABS = [
    (peutEditerDirect || peutProposer) && { value: 'catalogue', label: 'Catalogue' },
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
  const [nf, setNf] = useState({ nom: '', unite: 'unité', prix_achat: '', prix_vente: '', seuil: '', consigne_prix: '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [settings, setSettings] = useState(null)
  // Mode "proposition" : valeur d'origine (pour calculer prix_actuel) + mes demandes en
  // cours, pour ne pas en reproposer une deuxième tant que la première n'est pas traitée.
  const [original, setOriginal] = useState({})
  const [mesDemandes, setMesDemandes] = useState([])

  async function load() {
    const { data } = await supabase.from('products').select('*').order('categorie').order('ordre')
    setList(data || [])
    setOriginal(Object.fromEntries((data || []).map(p => [p.id, { prix_achat: p.prix_achat, prix_vente: p.prix_vente, consigne_prix: p.consigne_prix }])))
  }
  async function loadMesDemandes() {
    if (!peutProposer || !session?.user?.id) return
    const { data } = await supabase.from('product_price_requests').select('*, products(nom, categorie)').eq('demande_par', session.user.id).order('demande_at', { ascending: false })
    setMesDemandes(data || [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => { loadMesDemandes() }, [peutProposer, session?.user?.id])
  useEffect(() => { supabase.from('settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => setSettings(data || {})) }, [])
  // Marge = prix de vente − prix d'achat : ce n'est pas une donnée saisie indépendamment,
  // juste l'écart entre deux prix déjà renseignés ci-dessus — jamais modifiable à la main.
  // L'essence sert de référence pour marge_unitaire (colonne unique côté base, voir
  // commission_carburant dans v_ventes_mensuelles — même marge appliquée aux deux
  // carburants) ; le gasoil est affiché à côté pour repérer un écart éventuel.
  const margeEssence = (numFR(settings?.essence_pv) != null && numFR(settings?.essence_pa) != null) ? numFR(settings.essence_pv) - numFR(settings.essence_pa) : null
  const margeGasoil = (numFR(settings?.gasoil_pv) != null && numFR(settings?.gasoil_pa) != null) ? numFR(settings.gasoil_pv) - numFR(settings.gasoil_pa) : null
  async function saveCarburant(e) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('settings').update({
      essence_pv: numFR(settings.essence_pv), gasoil_pv: numFR(settings.gasoil_pv),
      marge_unitaire: margeEssence ?? margeGasoil ?? 0,
      essence_pa: numFR(settings.essence_pa), gasoil_pa: numFR(settings.gasoil_pa),
    }).eq('id', 1)
    error ? setErr(error.message) : flash('Prix carburant enregistrés')
  }
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
      consigne_prix: cat === 'gaz' ? numFR(nf.consigne_prix) : null,
      ordre: (list.filter(p => p.categorie === cat).length + 1) * 10 })
    if (error) setErr(error.message); else { setNf({ nom: '', unite: 'unité', prix_achat: '', prix_vente: '', seuil: '', consigne_prix: '' }); flash('Produit ajouté'); load() }
  }
  const productPayload = (p) => ({
    nom: p.nom, unite: p.unite, prix_achat: numFR(p.prix_achat), prix_vente: numFR(p.prix_vente),
    seuil: numFR(p.seuil) ?? 0, actif: p.actif, ordre: numFR(p.ordre),
    unite_stock: p.unite_stock || null, conditionnement_nom: p.conditionnement_nom || null,
    conditionnement_qte: numFR(p.conditionnement_qte), prix_achat_gros: numFR(p.prix_achat_gros),
    consigne_prix: numFR(p.consigne_prix) })
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

  // Mode "proposition" (chef de piste) : jamais d'écriture directe sur products — une ligne
  // par champ de prix réellement changé dans product_price_requests (migration_v139), que la
  // hiérarchie devra valider. prix_actuel vient de `original` (valeur au chargement), pas de
  // la valeur en cours de saisie dans `list`, pour rester correct même après plusieurs frappes.
  const PRICE_FIELDS = ['prix_achat', 'prix_vente', 'consigne_prix']
  function pendingDemande(productId, champ) {
    return mesDemandes.find(d => d.product_id === productId && d.champ === champ && d.statut === 'en_attente')
  }
  async function proposer(p) {
    const rows = PRICE_FIELDS
      .filter(champ => numFR(p[champ]) !== numFR(original[p.id]?.[champ]) && !pendingDemande(p.id, champ))
      .map(champ => ({ product_id: p.id, station_id: stationId, champ, prix_actuel: numFR(original[p.id]?.[champ]), prix_demande: numFR(p[champ]), demande_par: session.user.id }))
    if (!rows.length) return
    const { error } = await supabase.from('product_price_requests').insert(rows)
    if (error) setErr(error.message)
    else { setDirty(d => { const n = new Set(d); n.delete(p.id); return n }); flash(`${rows.length} proposition(s) envoyée(s) à votre hiérarchie`); load(); loadMesDemandes() }
  }

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

  // Champ de prix en mode "proposition" : badge si une demande est déjà en attente sur ce
  // champ pour ce produit (évite les doublons), sinon un Input normal (passe par up(), lu
  // ensuite par proposer() au clic — jamais d'écriture directe sur products).
  function champPrix(p, champ, placeholder) {
    const en_attente = peutProposer && pendingDemande(p.id, champ)
    if (en_attente) return <Badge tone="warn" title={`Proposé : ${fcfa(en_attente.prix_demande)}`}>En attente</Badge>
    return <Input size="sm" numeric value={p[champ] ?? ''} onChange={e => up(p.id, champ, e.target.value)} placeholder={placeholder} style={{ width: 90 }} />
  }
  const texte = (v) => <span style={{ font: '400 14px/1.3 var(--font-ui)', color: 'var(--text-body)' }}>{v}</span>
  const columns = [
    { key: 'nom', header: 'Nom', width: 280, render: p => peutProposer ? texte(p.nom) : <Input size="sm" value={p.nom || ''} onChange={e => up(p.id, 'nom', e.target.value)} style={{ width: '100%' }} /> },
    { key: 'unite', header: 'Unité', render: p => peutProposer ? texte(p.unite) : <Select size="sm" value={p.unite || 'unité'} onChange={e => up(p.id, 'unite', e.target.value)} options={UNITE_OPTIONS} style={{ width: '100%' }} /> },
    ...(cat === 'lubrifiant' || cat === 'superette' ? [
      { key: 'conditionnement_nom', header: 'Conditionnement', render: p => peutProposer ? texte(p.conditionnement_nom || '—') : <Input size="sm" value={p.conditionnement_nom || ''} onChange={e => up(p.id, 'conditionnement_nom', e.target.value)} placeholder="ex : carton" style={{ width: 100 }} /> },
      { key: 'conditionnement_qte', header: 'Qté/condit.', align: 'right', render: p => peutProposer ? texte(p.conditionnement_qte ?? '—') : <Input size="sm" numeric value={p.conditionnement_qte ?? ''} onChange={e => up(p.id, 'conditionnement_qte', e.target.value)} placeholder="ex : 12" style={{ width: 70 }} /> },
      { key: 'prix_achat_gros', header: 'Prix du gros', align: 'right', render: p => peutProposer ? texte(p.prix_achat_gros ?? '—') : <Input size="sm" numeric value={p.prix_achat_gros ?? ''} onChange={e => up(p.id, 'prix_achat_gros', e.target.value)} placeholder="carton" style={{ width: 90 }} /> },
    ] : []),
    { key: 'prix_achat', header: 'Prix achat (unité)', align: 'right', render: p => champPrix(p, 'prix_achat') },
    { key: 'prix_vente', header: 'Prix vente', align: 'right', render: p => champPrix(p, 'prix_vente') },
    ...(cat === 'gaz' ? [
      { key: 'consigne_prix', header: 'Prix consigne', align: 'right', render: p => champPrix(p, 'consigne_prix', '—') },
    ] : []),
    { key: 'seuil', header: 'Seuil', align: 'right', render: p => peutProposer ? texte(p.seuil ?? 0) : <Input size="sm" numeric value={p.seuil ?? ''} onChange={e => up(p.id, 'seuil', e.target.value)} style={{ width: 70 }} /> },
    { key: 'actif', header: 'Actif', render: p => peutProposer ? texte(p.actif ? 'Oui' : 'Non') : <Checkbox checked={!!p.actif} onChange={v => up(p.id, 'actif', v)} /> },
    { key: 'actions', header: '', align: 'right', render: p => peutProposer ? (
      dirty.has(p.id) && <Button size="sm" tone="dark" onClick={() => proposer(p)}>Proposer</Button>
    ) : (
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
          {cat === 'carburant'
            ? "Prix de vente (pré-remplis dans la saisie), prix d'achat (coût des commandes) et marge, en FCFA/L."
            : peutProposer
            ? "Catalogue en lecture. Proposez un nouveau prix d'achat, de vente ou de consigne : il ne s'applique qu'après validation de votre hiérarchie."
            : "Catalogue par catégorie avec prix d'achat, prix de vente et seuil d'alerte."}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            {(peutEditerDirect ? DISPLAY_CATS : CATS).map(c => <Button key={c} size="sm" tone={cat === c ? 'dark' : 'neutral'} onClick={() => setCat(c)} style={{ textTransform: 'capitalize' }}>{c}</Button>)}
          </div>
          {peutEditerDirect && cat !== 'carburant' && <Button size="sm" tone="primary" onClick={() => setShowAddForm(s => !s)}>{showAddForm ? 'Annuler' : '+ Nouveau produit'}</Button>}
        </div>
        {peutEditerDirect && cat !== 'carburant' && showAddForm && (
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
            {cat === 'gaz' && <Field label="Prix consigne" style={{ flex: '1 1 100px' }}>
              <Input numeric value={nf.consigne_prix} onChange={e => setNf({ ...nf, consigne_prix: e.target.value })} />
            </Field>}
            <Button type="submit" tone="primary">+ Ajouter à « {cat} »</Button>
          </form>
        )}
      </Panel>

      {cat === 'carburant' ? (
        settings && <Panel title="Carburant">
          <form onSubmit={saveCarburant} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
            <FormSection title="Prix de vente">
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Essence" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.essence_pv ?? ''} onChange={e => setSettings({ ...settings, essence_pv: e.target.value })} /></Field>
                <Field label="Gasoil" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.gasoil_pv ?? ''} onChange={e => setSettings({ ...settings, gasoil_pv: e.target.value })} /></Field>
              </div>
            </FormSection>
            <FormSection title="Prix d'achat">
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Essence" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.essence_pa ?? ''} onChange={e => setSettings({ ...settings, essence_pa: e.target.value })} /></Field>
                <Field label="Gasoil" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.gasoil_pa ?? ''} onChange={e => setSettings({ ...settings, gasoil_pa: e.target.value })} /></Field>
              </div>
            </FormSection>
            <FormSection title="Marge (calculée automatiquement)">
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Essence (F/L)" style={{ flex: '1 1 140px' }}><Input type="text" numeric disabled value={margeEssence ?? '—'} /></Field>
                <Field label="Gasoil (F/L)" style={{ flex: '1 1 140px' }}><Input type="text" numeric disabled value={margeGasoil ?? '—'} /></Field>
              </div>
              <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-3) 0 0' }}>
                Prix de vente − prix d'achat : jamais saisie à la main. {margeEssence != null && margeGasoil != null && margeEssence !== margeGasoil
                  ? `Les deux diffèrent — c'est la marge essence (${margeEssence} F/L) qui est utilisée pour la commission carburant.`
                  : "Utilisée pour la commission carburant et le seuil de rentabilité."}
              </p>
            </FormSection>
            <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
          </form>
        </Panel>
      ) : (<>
      {peutEditerDirect && pending.length > 0 && (
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
          {peutEditerDirect && dirty.size > 0 && <Button size="sm" tone="dark" disabled={saving} onClick={saveAll}>{saving ? 'Enregistrement…' : `Enregistrer tout (${dirty.size})`}</Button>}
        </div>
        {shown.length
          ? <DataTable columns={columns} rows={shown} />
          : <PanelEmpty icon="book-open" label={search ? 'Aucun produit ne correspond à la recherche.' : 'Aucun produit.'} />}
        {shownAll.length > pageSize && (
          <Pagination page={page} pageCount={pageCount} total={shownAll.length} pageSize={pageSize}
            onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />
        )}
      </Panel>

      {peutProposer && (
        <Panel title="Mes propositions de prix" meta={`${mesDemandes.length}`} flush>
          {mesDemandes.length
            ? <DataTable columns={[
                { key: 'produit', header: 'Produit', render: d => d.products?.nom || '—' },
                { key: 'champ', header: 'Champ', render: d => ({ prix_achat: "Prix d'achat", prix_vente: 'Prix de vente', consigne_prix: 'Prix de consigne' }[d.champ] || d.champ) },
                { key: 'prix_actuel', header: 'Actuel', align: 'right', render: d => d.prix_actuel != null ? fcfa(d.prix_actuel) : '—' },
                { key: 'prix_demande', header: 'Demandé', align: 'right', render: d => fcfa(d.prix_demande) },
                { key: 'statut', header: 'Statut', render: d => <Badge tone={d.statut === 'validee' ? 'ok' : d.statut === 'refusee' ? 'alarm' : 'warn'}>{d.statut === 'validee' ? 'Validée' : d.statut === 'refusee' ? 'Refusée' : 'En attente'}</Badge> },
              ]} rows={mesDemandes} />
            : <PanelEmpty icon="book-open" label="Aucune proposition de prix envoyée pour le moment." />}
        </Panel>
      )}
      </>)}
      </>)}

      {tab === 'prix' && <PriceHistory />}
    </div>
  )
}
