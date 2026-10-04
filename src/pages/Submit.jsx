import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { useOffre } from '../lib/offre.jsx'
import { PhotoThumb } from '../lib/photos.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, today, numFR, frDate, formatThousands } from '../lib/format'
import { compressImage, compressStoredPhoto } from '../lib/image'
import OrderReception from '../components/OrderReception.jsx'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { IconButton } from '../ds/pumpit/components/core/IconButton.jsx'
import { Icon } from '../ds/pumpit/components/core/Icon.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { NumericStepper } from '../ds/pumpit/components/forms/NumericStepper.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { EvidenceThumb } from '../ds/pumpit/components/evidence/EvidenceThumb.jsx'
import { MetricTile } from '../ds/pumpit/components/data/MetricTile.jsx'

const N = (v) => (v === '' || v === null || v === undefined ? 0 : (numFR(v) ?? 0))
const LUB_TYPES = ['5W30 1L','5W30 5L','20W50 5L','15W40 5L','80W90 1L','50 SAE 5L','Dexron 1L','Dot4 1L','10W40 5L','5W40 5L','Graisse','Liquide refroid.','Nettoyant injecteur','Nettoyant essence']
  .map(nom => ({ nom, conditionnement_nom: null, conditionnement_qte: null, unite: 'bidon' }))
const GAZ = [['3','3 kg'],['6','6 kg'],['12','12 kg'],['38','38 kg']]
// Repli affiché le temps que expense_categories charge (catalogue admin, voir migration_v100) —
// jamais utilisé une fois la requête terminée, même si elle revient vide.
const FALLBACK_EXP_CATS = [
  { key: 'SBEE', label: 'SBEE', non_cash: false },
  { key: 'SUPERETTE', label: 'SUPERETTE', non_cash: false },
  { key: 'CARBURANT', label: 'Carburant / déplacement (propriétaire)', non_cash: true },
  { key: 'AUTRE', label: 'AUTRE', non_cash: false },
]
// Jusqu'à 10 machines par station (chacune : une pompe essence + une gasoil) — voir
// stations.nombre_machines (Stations & équipe). Les colonnes au-delà du nombre réellement
// utilisé par une station restent vides en base, sans impact.
const MAX_MACHINES = 10
const machineNums = (n) => Array.from({ length: n }, (_, i) => i + 1)
const pumpKeys = (suffix) => [...machineNums(MAX_MACHINES).map(n => `e${n}${suffix}`), ...machineNums(MAX_MACHINES).map(n => `g${n}${suffix}`)]
const NUMFIELDS = [
  'ess_litres','ess_pu','ess_bon','ess_espece','gas_litres','gas_pu','gas_bon','gas_espece',
  'gaz_espece','superette_espece','lubrifiant_espece',
  ...pumpKeys(''),   // relevés 16h (contrôle) : e1..e10, g1..g10
  ...pumpKeys('_m'), // relevés d'ouverture (matin) : e1_m..e10_m, g1_m..g10_m
  'total_bon_cumul',
  'ess_stock','gas_stock','gaz_stock_3','gaz_stock_6','gaz_stock_12','gaz_stock_38',
  'gaz_vendu_3','gaz_vendu_6','gaz_vendu_12','gaz_vendu_38',
]
// Champs pilotés par NumericStepper (compteurs de bouteilles) : jamais formatés avec des
// espaces, NumericStepper attend une valeur numérique brute (Number(f[k])), pas une chaîne.
const STEPPER_FIELDS = ['gaz_stock_3','gaz_stock_6','gaz_stock_12','gaz_stock_38','gaz_vendu_3','gaz_vendu_6','gaz_vendu_12','gaz_vendu_38']
const THOUSANDS_FIELDS = NUMFIELDS.filter(k => !STEPPER_FIELDS.includes(k))
const EMPTY = Object.fromEntries([...NUMFIELDS.map(k => [k, '']), ['note', '']])

// Brouillon local (localStorage), protège contre une saisie perdue au complet — cas réel
// rencontré : sur mobile, prendre une photo (l'appareil photo natif prend le dessus sur la
// mémoire du navigateur) peut recharger l'onglet en revenant, effaçant tout ce qui n'était
// encore qu'en mémoire React. Ne protège pas les photos déjà sélectionnées (des File(), non
// sérialisables) mais protège tous les chiffres/textes déjà saisis — sans ça, tout repartait
// à zéro. Effacé automatiquement dès que la journée est réellement enregistrée en base.
const draftKey = (stationId, date) => `station_draft_${stationId}_${date}`
const stripFiles = (rows) => rows.map(({ _file, ...r }) => r)
function saveDraft(stationId, date, data) {
  try { localStorage.setItem(draftKey(stationId, date), JSON.stringify(data)) } catch { /* stockage plein/indisponible — tant pis, pas bloquant */ }
}
function readDraft(stationId, date) {
  try { const raw = localStorage.getItem(draftKey(stationId, date)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function clearDraft(stationId, date) {
  try { localStorage.removeItem(draftKey(stationId, date)) } catch { /* ignore */ }
}

export default function Submit() {
  const { session, isAdmin, isPompiste, isVendeuse, profile, can } = useAuth()
  const { stationId, current } = useStation()
  const { activite } = useOffre()   // activités incluses dans l'offre de la station (carburant, lubrifiant, gaz, superette)
  const [params] = useSearchParams()
  const [date, setDate] = useState(params.get('date') || today())
  const [moment, setMoment] = useState(['matin', 'apres-midi', 'soir'].includes(params.get('moment')) ? params.get('moment') : defaultMoment())
  const [showAll, setShowAll] = useState(!!params.get('date'))
  const [f, setF] = useState(EMPTY)
  const [lub, setLub] = useState({})
  const [lubVendu, setLubVendu] = useState({})   // {nom: quantité vendue aujourd'hui} — pour la commission réelle (prix vente − prix achat), plus une estimation à %
  const [lubVenduSplit, setLubVenduSplit] = useState({})
  // Espèces gaz/lubrifiant : préremplies depuis les quantités vendues × prix (voir
  // gazEspeceCalc/lubEspeceCalc), mais le gérant peut corriger (ex. bouteille offerte, rabais) —
  // dès qu'il touche le champ, le préremplissage s'arrête de l'écraser pour cette journée.
  const [gazEspeceTouched, setGazEspeceTouched] = useState(false)
  const [lubEspeceTouched, setLubEspeceTouched] = useState(false)
  const [lubTheorique, setLubTheorique] = useState({})   // {nom: stock_theorique} — v_stock_theorique, pour l'écart en direct
  const [expenses, setExpenses] = useState([])
  const [deposits, setDeposits] = useState([])
  const [deliveries, setDeliveries] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [attachments, setAttachments] = useState([])   // photos déjà envoyées
  const [newPhotos, setNewPhotos] = useState([])        // {file, categorie}
  const [recvTotals, setRecvTotals] = useState({})       // {orderId: {quantite_recue_total, reste, complet}}
  const [meterPhotoBusy, setMeterPhotoBusy] = useState({}) // {champCompteur: true} pendant l'envoi immédiat de la photo
  const [expPhotoBusy, setExpPhotoBusy] = useState({})    // {index: true} pendant l'envoi immédiat du justificatif
  const [depPhotoBusy, setDepPhotoBusy] = useState({})    // {index: true} pendant l'envoi immédiat du bordereau
  // Chemins des photos envoyées BRUTES (non compressées) cette session — recompressées en place
  // au submit final, un moment plus sûr que juste après la prise de vue (voir lib/image.js).
  const rawPhotoPathsRef = useRef([])
  const [lubTypes, setLubTypes] = useState(LUB_TYPES)    // références lubrifiant (dynamiques)
  const [gazPrices, setGazPrices] = useState({})          // {"3 kg": prix_vente, ...} — pour déduire les espèces gaz des bouteilles vendues
  const [expenseCategories, setExpenseCategories] = useState([])   // catalogue admin (table expense_categories), à la place de la liste figée
  const [settings, setSettings] = useState({ essence_pv: 725, gasoil_pv: 750, marge_unitaire: 25 })
  const [prods, setProds] = useState([])                 // catalogue supérette/autre (vendeuse)
  // Saisie du jour par produit : { [product_id]: { vendu, recu, perime } } — une seule liste
  // cherchable au lieu de choisir un produit à la fois dans une liste déroulante (plus rapide
  // avec ~200 articles supérette). Le prix de vente est celui du catalogue (Produits & prix),
  // plus modifiable ligne à ligne ici.
  const [entries, setEntries] = useState({})
  const [prodSearch, setProdSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newProd, setNewProd] = useState({ nom: '', prix_achat: '', prix_vente: '' })
  const [prevMorning, setPrevMorning] = useState(null) // index compteur matin du dernier jour saisi
  const [meterWarn, setMeterWarn] = useState('')       // avertissement index incohérent
  const [forceMeter, setForceMeter] = useState(false)  // forcer malgré l'avertissement
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [errTarget, setErrTarget] = useState('top')
  const [submittedMoments, setSubmittedMoments] = useState(new Set())
  const [openAchats, setOpenAchats] = useState(null)     // null = auto (ouvert si déjà des lignes)
  const [openDepenses, setOpenDepenses] = useState(null)
  const [openVersements, setOpenVersements] = useState(null)
  const [openPhotosJour, setOpenPhotosJour] = useState(false)  // galerie "Photos du jour" repliée par défaut
  const [openReception, setOpenReception] = useState(false)    // "Commandes à réceptionner" repliée par défaut
  const matinMetersRef = useRef(null)
  const apresmidiMetersRef = useRef(null)
  const expensesRef = useRef(null)
  const depositsRef = useRef(null)
  const orderReceptionRef = useRef(null)

  function fail(message, target = 'top', ref) {
    setBusy(false)
    setErr(message); setErrTarget(target)
    if (target === 'expenses') setOpenDepenses(true)
    if (target === 'deposits') setOpenVersements(true)
    const el = ref?.current
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => { supabase.from('settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => data && setSettings(data)) }, [])
  useEffect(() => { supabase.from('suppliers').select('id,nom,categorie').order('nom').then(({ data }) => setSuppliers(data || [])) }, [])
  useEffect(() => { supabase.from('products').select('nom, unite, conditionnement_nom, conditionnement_qte, prix_vente').eq('categorie', 'lubrifiant').eq('actif', true).order('ordre').then(({ data }) => { if (data && data.length) setLubTypes(data) }) }, [])
  useEffect(() => { supabase.from('products').select('nom,prix_vente').eq('categorie', 'gaz').then(({ data }) => { const m = {}; (data || []).forEach(p => m[p.nom] = N(p.prix_vente)); setGazPrices(m) }) }, [])
  useEffect(() => { supabase.from('expense_categories').select('*').eq('actif', true).order('ordre').then(({ data }) => setExpenseCategories(data || [])) }, [])
  useEffect(() => { if (!stationId) return; supabase.from('v_stock_theorique').select('produit, stock_theorique').eq('station_id', stationId).eq('categorie', 'lubrifiant').then(({ data }) => { const m = {}; (data || []).forEach(r => m[r.produit] = N(r.stock_theorique)); setLubTheorique(m) }) }, [stationId])
  useEffect(() => { if (stationId) load(date) }, [date, stationId])

  // Index compteur MATIN du dernier jour saisi avant `date` — sert de garde-fou
  // (l'index d'une pompe ne peut que monter ; sinon décalage de l'écart compteur).
  useEffect(() => {
    if (!stationId || isVendeuse) return
    setForceMeter(false); setMeterWarn('')
    supabase.from('daily_reports')
      .select(['report_date', ...pumpKeys('_m')].join(','))
      .eq('station_id', stationId).lt('report_date', date)
      .order('report_date', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (!data) { setPrevMorning(null); return }
        // Somme sur les 10 emplacements possibles : les machines au-delà de celles réellement
        // utilisées par la station restent toujours nulles en base, donc n'affectent pas le total.
        setPrevMorning({
          ess: machineNums(MAX_MACHINES).reduce((s, n) => s + N(data['e' + n + '_m']), 0),
          gas: machineNums(MAX_MACHINES).reduce((s, n) => s + N(data['g' + n + '_m']), 0),
          date: data.report_date,
          raw: data,   // valeurs pompe par pompe — nécessaire pour détecter une baisse sur UNE pompe même si le total semble correct
        })
      })
  }, [stationId, date, isVendeuse])

  // Vendeuse : catalogue supérette (produits validés) + lignes de vente déjà saisies pour la journée
  useEffect(() => {
    if (!isVendeuse) return
    supabase.from('products').select('*').in('categorie', ['superette', 'autre']).eq('actif', true).eq('statut', 'valide').order('nom')
      .then(({ data }) => setProds(data || []))
  }, [isVendeuse])
  useEffect(() => {
    if (!isVendeuse || !stationId) return
    supabase.from('superette_sales').select('*').eq('station_id', stationId).eq('report_date', date).order('id')
      .then(({ data }) => {
        const e = {}
        for (const r of (data || [])) e[r.product_id] = { vendu: String(r.quantite ?? ''), recu: '', perime: '' }
        setEntries(e)
      })
  }, [isVendeuse, stationId, date])

  async function load(d) {
    setMsg(''); setErr(''); setErrTarget('top')
    // Les 6 requêtes du jour sont lancées EN PARALLÈLE (avant : en série ≈ 6× la latence réseau).
    const [r, ex, dep, dl, at, rt, sub] = await Promise.all([
      supabase.from('daily_reports').select('*').eq('report_date', d).eq('station_id', stationId).maybeSingle(),
      supabase.from('expenses').select('*').eq('report_date', d).eq('station_id', stationId),
      supabase.from('deposits').select('*').eq('report_date', d).eq('station_id', stationId),
      supabase.from('deliveries').select('*').eq('report_date', d).eq('station_id', stationId),
      supabase.from('attachments').select('*').eq('report_date', d).eq('station_id', stationId).order('id'),
      supabase.from('v_order_reception').select('*').eq('station_id', stationId),
      supabase.from('submissions').select('moment').eq('report_date', d).eq('station_id', stationId),
    ])
    setSubmittedMoments(new Set((sub.data || []).map(x => x.moment)))
    const draft = r.data ? null : readDraft(stationId, d)
    if (r.data) {
      const c = { ...EMPTY }
      Object.keys(EMPTY).forEach(k => c[k] = r.data[k] ?? '')
      THOUSANDS_FIELDS.forEach(k => { if (c[k] !== '') c[k] = formatThousands(String(c[k])) })
      setF(c); setLub(r.data.lubrifiant_stock || {}); setLubVendu(r.data.lubrifiant_vendu || {})
      // La journée est réellement enregistrée en base : le brouillon local n'a plus lieu d'être.
      clearDraft(stationId, d)
      // Valeurs déjà déclarées (espèces) : ne jamais les recalculer silencieusement par-dessus
      // à la relecture d'un jour passé (les prix peuvent avoir changé depuis) — seule une vraie
      // modification du gérant doit les changer, via le champ lui-même.
      setGazEspeceTouched(true); setLubEspeceTouched(true)
    }
    // Restauration silencieuse (pas de bannière) : un brouillon existe dès qu'une saisie du
    // jour est en cours, que la page ait redémarré ou non — l'afficher à chaque fois serait
    // trompeur (laisserait croire à un incident alors que c'est le cas normal).
    else if (draft?.f) {
      setF(draft.f); setLub(draft.lub || {}); setLubVendu(draft.lubVendu || {})
      setGazEspeceTouched(false); setLubEspeceTouched(false)
    } else {
      setF({ ...EMPTY, ess_pu: settings.essence_pv, gas_pu: settings.gasoil_pv }); setLub({}); setLubVendu({})
      setGazEspeceTouched(false); setLubEspeceTouched(false)
    }
    setLubVenduSplit({})
    // Dépenses/versements/achats : la base fait autorité dès qu'il y a quelque chose ; sinon,
    // on retombe sur le brouillon local (ex. après un rechargement inattendu de la page).
    setExpenses(ex.data?.length ? ex.data : (draft?.expenses || []))
    setDeposits(dep.data?.length ? dep.data : (draft?.deposits || []))
    setDeliveries(dl.data?.length ? dl.data : (draft?.deliveries || []))
    setAttachments(at.data || [])
    setNewPhotos([])
    const tmap = {}; for (const x of (rt.data || [])) tmap[x.order_id] = x; setRecvTotals(tmap)
    setMeterPhotoBusy({})
    setOpenReception(false)
  }

  // Sauvegarde continue du brouillon local — voir le commentaire sur saveDraft plus haut.
  // Ne sauvegarde pas les fichiers (photos) : seulement ce qui est sérialisable et donc
  // récupérable après un rechargement inattendu de l'onglet.
  useEffect(() => {
    if (!stationId || !date) return
    saveDraft(stationId, date, { f, lub, lubVendu, expenses: stripFiles(expenses), deposits: stripFiles(deposits), deliveries: stripFiles(deliveries) })
  }, [f, lub, lubVendu, expenses, deposits, deliveries, stationId, date])

  // champ compteur avec photo-preuve par pompe — envoyée immédiatement à la sélection (voir handleMeterPhoto)
  // Photo recommandée mais plus bloquante à l'envoi (voir save()) : le gérant doit pouvoir
  // envoyer son relevé même si la prise de photo échoue sur son téléphone. Le bouton reflète donc
  // seulement l'état de la photo elle-même, indépendamment de l'index tapé à côté.
  const meterField = (k, label) => (
    <Field label={label} key={k}>
      <Input type="text" inputMode="decimal" numeric {...numProps(k)} />
      <Button type="button" size="sm" icon="camera" block disabled={!!meterPhotoBusy[k]}
        style={{ marginTop: 'var(--sp-2)', ...(meterHasPhoto(k, label) ? { color: 'var(--state-ok)', borderColor: 'var(--state-ok)' } : {}) }}
        onClick={() => document.getElementById(`meter-photo-${k}`)?.click()}>
        {meterPhotoBusy[k] ? 'Envoi…' : meterHasPhoto(k, label) ? 'Photo ✓' : 'Photo'}
      </Button>
      {/* Pas de capture="environment" : forcer l'appareil photo natif en plein écran est le
          changement d'activité le plus lourd pour l'OS — sur téléphone à mémoire faible, c'est ce
          qui fait le plus souvent recharger l'onglet pendant la prise de vue (photo perdue). Laisser
          le sélecteur standard (appareil photo / galerie / fichiers) réduit ce risque. */}
      <input id={`meter-photo-${k}`} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const file = e.target.files[0]; e.target.value = ''; if (file) handleMeterPhoto(k, label, file) }} />
    </Field>
  )

  // regroupe une pompe essence + gasoil de la même machine (E1+G1 sur la machine 1, etc.)
  const meterMachine = (n, eKey, eLabel, gKey, gLabel) => (
    <div key={n} style={{ padding: 'var(--sp-4)', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <Icon name="fuel" size={12} color="var(--text-muted)" />
        <span style={{ font: 'var(--fw-semibold) 12px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>Machine {n}</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 110px', minWidth: 0 }}>{meterField(eKey, eLabel)}</div>
        <div style={{ flex: '1 1 110px', minWidth: 0 }}>{meterField(gKey, gLabel)}</div>
      </div>
    </div>
  )


  // un compteur a-t-il déjà sa photo (nouvelle ou déjà enregistrée) ?
  const meterHasPhoto = (k, label) => !!meterPhotoBusy[k] || attachments.some(a => a.categorie === 'compteur' && (a.note || '').startsWith(label))

  // Photo compteur envoyée immédiatement à la sélection (pas au submit final) : sur téléphone,
  // l'appareil photo natif peut faire recharger l'onglet en arrière-plan (mémoire faible) —
  // si on attendait le submit, la photo (jamais sérialisable dans le brouillon local) disparaissait
  // à chaque fois, obligeant à tout ressaisir. En l'envoyant tout de suite, elle est en sécurité
  // dans le stockage dès la sélection, quoi qu'il arrive à l'onglet ensuite.
  async function handleMeterPhoto(k, label, file) {
    if (!file || !stationId) return
    setMeterPhotoBusy(p => ({ ...p, [k]: true }))
    try {
      // remplace une éventuelle photo précédente pour ce compteur (reprise après un flou, etc.)
      const anciennes = attachments.filter(a => a.categorie === 'compteur' && (a.note || '').startsWith(label))
      for (const a of anciennes) await supabase.from('attachments').delete().eq('id', a.id)
      const path = `${stationId}/compteurs/${date}/${k}_${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: up } = await supabase.storage.from(BORDEREAUX_BUCKET).upload(path, file)
      if (up) throw up
      rawPhotoPathsRef.current.push(path)
      const { data: ins, error: ai } = await supabase.from('attachments').insert({
        station_id: stationId, report_date: date, categorie: 'compteur', note: `${label} — index ${f[k] || '?'}`, photo_path: path, created_by: session.user.id,
      }).select().single()
      if (ai) throw ai
      setAttachments(a => [...a.filter(x => !anciennes.some(old => old.id === x.id)), ins])
    } catch (e) {
      fail(`Échec de l'envoi de la photo (${label}) : ${e.message || e}. Vérifiez votre connexion et réessayez.`)
    } finally {
      setMeterPhotoBusy(p => { const c = { ...p }; delete c[k]; return c })
    }
  }

  // Même fix que les photos compteur : justificatif de dépense et bordereau de versement envoyés
  // au stockage dès la sélection (plus au submit final) — sinon la photo, jamais sérialisable
  // dans le brouillon local, disparaissait si l'onglet rechargeait après la prise de vue.
  async function handleExpensePhoto(i, file) {
    if (!file || !stationId) return
    setExpPhotoBusy(p => ({ ...p, [i]: true }))
    try {
      const path = `${stationId}/depenses/${date}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: up } = await supabase.storage.from(BORDEREAUX_BUCKET).upload(path, file)
      if (up) throw up
      rawPhotoPathsRef.current.push(path)
      setExpenses(p => p.map((x, j) => j === i ? { ...x, photo_path: path, _file: undefined } : x))
    } catch (e) {
      fail(`Échec de l'envoi de la photo du justificatif : ${e.message || e}. Vérifiez votre connexion et réessayez.`, 'expenses')
    } finally {
      setExpPhotoBusy(p => { const c = { ...p }; delete c[i]; return c })
    }
  }
  async function handleDepositPhoto(i, file) {
    if (!file || !stationId) return
    setDepPhotoBusy(p => ({ ...p, [i]: true }))
    try {
      const path = `${stationId}/${date}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: up } = await supabase.storage.from(BORDEREAUX_BUCKET).upload(path, file)
      if (up) throw up
      rawPhotoPathsRef.current.push(path)
      setDeposits(p => p.map((x, j) => j === i ? { ...x, photo_path: path, _file: undefined } : x))
    } catch (e) {
      fail(`Échec de l'envoi de la photo du bordereau : ${e.message || e}. Vérifiez votre connexion et réessayez.`, 'deposits')
    } finally {
      setDepPhotoBusy(p => { const c = { ...p }; delete c[i]; return c })
    }
  }

  function addFiles(e) {
    const files = Array.from(e.target.files || [])
    setNewPhotos(p => [...p, ...files.map(file => ({ file, categorie: 'compteur' }))])
    e.target.value = ''
  }
  async function delAttachment(a) {
    await supabase.from('attachments').delete().eq('id', a.id)
    setAttachments(p => p.filter(x => x.id !== a.id))
  }

  // Catégories de dépense (catalogue admin, expense_categories) : seule CARBURANT (prélèvement
  // propriétaire) est non-cash par défaut — une catégorie créée par l'admin peut aussi l'être.
  // Si le catalogue n'a pas encore chargé, on retombe sur l'ancien comportement figé.
  const expCats = expenseCategories.length ? expenseCategories : FALLBACK_EXP_CATS
  const nonCashCat = (categorie) => {
    const cat = expCats.find(c => c.key === categorie)
    return cat ? cat.non_cash : (categorie || '').toUpperCase() === 'CARBURANT'
  }
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  // valeur brute pendant la frappe, reformatée avec séparateurs de milliers à la sortie du champ
  const numProps = (k) => ({ value: f[k], onChange: e => set(k, e.target.value), onBlur: () => set(k, formatThousands(f[k])) })
  // Comme numProps, mais marque le champ "touché" dès la première frappe — pour que le
  // préremplissage (gaz/lubrifiant, voir plus haut) ne vienne plus écraser une correction du gérant.
  const touchedNumProps = (k, setTouched) => ({ value: f[k], onChange: e => { setTouched(true); set(k, e.target.value) }, onBlur: () => set(k, formatThousands(f[k])) })
  const cashDeclare = N(f.ess_espece)+N(f.gas_espece)+N(f.gaz_espece)+N(f.superette_espece)+N(f.lubrifiant_espece)
  const totDepense = expenses.reduce((s, e) => s + N(e.montant), 0)
  const totVerse = deposits.reduce((s, d) => s + N(d.montant), 0)
  const totLivr = deliveries.reduce((s, d) => s + N(d.montant), 0)
  const marge = (N(f.ess_litres) + N(f.gas_litres)) * N(settings.marge_unitaire)
  const show = (m) => showAll || moment === m
  // gérant/pompiste/vendeuse : verrouillage aligné sur la règle RLS réelle côté base
  // (migration v47, configurable par l'admin dans Stations & équipe — settings.jours_correction_gerant).
  const joursCorrection = Number(settings.jours_correction_gerant) || 2
  // Accès lecture seule (directeur/comptable arrivés ici via un lien "Ouvrir la saisie"
  // depuis Alertes/Historique/Journal/Rapprochement — voir App.jsx, route /saisie — sans
  // avoir le droit d'opérer la saisie). Ils voient tout, y compris les photos, mais ne
  // peuvent rien envoyer.
  const lectureSeule = !(isAdmin || isPompiste || isVendeuse || profile?.role === 'gerant' || can('manage_orders'))
  const locked = lectureSeule || (!isAdmin && date < daysAgoIso(joursCorrection))
  const lockedMsg = lectureSeule
    ? 'Accès en lecture — vous pouvez consulter cette journée et ses photos, mais pas la modifier.'
    : `Journée verrouillée : vous pouvez créer ou corriger un jour des ${joursCorrection} derniers jours seulement. Au-delà, demandez à la direction.`
  const nombreMachines = Math.min(MAX_MACHINES, Math.max(1, Number(current?.nombre_machines) || 4))
  // Choix admin par station (Stations & équipe) : déclarer le STOCK (matin, réconciliation),
  // la quantité VENDUE (16h, commission réelle), ou les deux (comportement historique, par défaut).
  const suiviMode = current?.suivi_lub_gaz || 'les_deux'
  const showStockLubGaz = suiviMode === 'stock' || suiviMode === 'les_deux'
  const showVenduLubGaz = suiviMode === 'vendu' || suiviMode === 'les_deux'
  // Espèces gaz/lubrifiant déduites des quantités vendues déjà saisies ci-dessous (× prix de
  // vente actuel) — le gérant ne les retape plus. Uniquement quand la quantité vendue est
  // effectivement déclarée (showVenduLubGaz) ; sinon (station en mode "stock" seul) il n'y a
  // rien dont les déduire, et le champ reste une saisie manuelle (voir plus bas).
  const gazEspeceCalc = GAZ.reduce((s, [k, lab]) => s + N(f['gaz_vendu_' + k]) * N(gazPrices[lab]), 0)
  const lubEspeceCalc = lubTypes.reduce((s, pr) => s + N(lubVendu[pr.nom]) * N(pr.prix_vente), 0)
  // Libellés des compteurs — réutilisés pour l'affichage (meterMachine) ET pour la vérification
  // "photo obligatoire" dans save() : doivent rester identiques aux deux endroits, sinon
  // meterHasPhoto (qui compare au préfixe de attachments.note) ne retrouverait pas la photo.
  const matinMeterDefs = machineNums(nombreMachines).flatMap(n => [[`e${n}_m`, `Essence ${n}`], [`g${n}_m`, `Gasoil ${n}`]])
  const meters16hDefs = machineNums(nombreMachines).flatMap(n => [[`e${n}`, `Pompe E${n}`], [`g${n}`, `Pompe G${n}`]])
  // Mouvement compteur du matin (aujourd'hui − dernier relevé matin saisi) : dispo dès que les
  // relevés d'ouverture sont remplis, avant même d'atteindre l'étape « Ventes carburant ».
  const eOpenNow = machineNums(nombreMachines).reduce((s, n) => s + N(f['e' + n + '_m']), 0)
  const gOpenNow = machineNums(nombreMachines).reduce((s, n) => s + N(f['g' + n + '_m']), 0)
  const essCompteur = prevMorning && eOpenNow > prevMorning.ess && (eOpenNow - prevMorning.ess) < 30000 ? Math.round(eOpenNow - prevMorning.ess) : null
  const gasCompteur = prevMorning && gOpenNow > prevMorning.gas && (gOpenNow - prevMorning.gas) < 30000 ? Math.round(gOpenNow - prevMorning.gas) : null
  // Pré-remplit « Litres » avec le mouvement compteur dès qu'il est calculable — le gérant
  // n'a plus qu'à confirmer/corriger au lieu de tout retaper depuis les relevés qu'il vient
  // de saisir. Ne touche jamais un champ déjà rempli (saisie manuelle ou rechargement du jour).
  useEffect(() => {
    if (essCompteur != null && f.ess_litres === '') set('ess_litres', String(essCompteur))
    if (gasCompteur != null && f.gas_litres === '') set('gas_litres', String(gasCompteur))
  }, [essCompteur, gasCompteur])
  useEffect(() => {
    if (!showVenduLubGaz || gazEspeceTouched) return
    set('gaz_espece', gazEspeceCalc ? formatThousands(String(Math.round(gazEspeceCalc))) : '0')
  }, [gazEspeceCalc, showVenduLubGaz, gazEspeceTouched])
  useEffect(() => {
    if (!showVenduLubGaz || lubEspeceTouched) return
    set('lubrifiant_espece', lubEspeceCalc ? formatThousands(String(Math.round(lubEspeceCalc))) : '0')
  }, [lubEspeceCalc, showVenduLubGaz, lubEspeceTouched])
  // Litres/Prix/Bon/Espèces sont 4 champs saisis indépendamment — rien ne garantit que
  // Bon + Espèces corresponde à Litres × Prix/L. Vérification en temps réel, non bloquante
  // (juste un repère visuel), pour repérer une saisie incohérente avant l'envoi.
  const essAttendu = N(f.ess_litres) * N(f.ess_pu)
  const essDeclare = N(f.ess_bon) + N(f.ess_espece)
  const gasAttendu = N(f.gas_litres) * N(f.gas_pu)
  const gasDeclare = N(f.gas_bon) + N(f.gas_espece)
  const achatsOpen = openAchats ?? (deliveries.length > 0)
  const depensesOpen = openDepenses ?? (expenses.length > 0)
  const versementsOpen = openVersements ?? (deposits.length > 0)

  // Récap du footer adapté au moment actif : les KPI cash n'ont de sens qu'une fois le Soir
  // en cours de saisie ; Matin/16h ont leur propre repère pertinent. Volontairement PAS
  // d'écart calculé ici (recette − dépenses − versé) : ces 3 montants ne portent que sur le
  // jour affiché et sont mélangés tous pôles confondus, alors qu'un versement peut couvrir
  // plusieurs jours et que chaque pôle (carburant / gaz+lub / supérette) a son propre
  // bordereau — un tel écart combiné-jour-unique serait faux dès qu'un versement est en
  // retard ou groupé (constaté en prod : « surplus » affiché alors qu'il manquait 3 425 F
  // sur un pôle). L'écart fiable, par pôle et cumulé sur la vraie période, est dans Historique.
  function footerKpis() {
    if (moment === 'matin' && !showAll) return (<>
      <MetricTile label="Essence en cuve" value={f.ess_stock !== '' ? Math.round(N(f.ess_stock)).toLocaleString('fr-FR') : '—'} unit={f.ess_stock !== '' ? 'L' : ''} />
      <MetricTile label="Gasoil en cuve" value={f.gas_stock !== '' ? Math.round(N(f.gas_stock)).toLocaleString('fr-FR') : '—'} unit={f.gas_stock !== '' ? 'L' : ''} />
      {activite('gaz') && <MetricTile label="Bouteilles de gaz" value={GAZ.reduce((s, [k]) => s + N(f['gaz_stock_' + k]), 0)} unit="b." />}
    </>)
    if (moment === 'apres-midi' && !showAll) return (<>
      <MetricTile label="Litres vendus" value={(N(f.ess_litres) + N(f.gas_litres)).toLocaleString('fr-FR')} unit="L" />
      <MetricTile label="Marge carburant estimée" value={fcfa(marge)} status="ok" />
    </>)
    return (<>
      <MetricTile label="Recette espèces (jour)" value={fcfa(cashDeclare)} />
      <MetricTile label="Dépenses (jour)" value={fcfa(totDepense)} />
      <MetricTile label="Versé saisi ce jour" value={fcfa(totVerse)} />
    </>)
  }

  async function save() {
    // Garde-fou anti-double-clic : posé AVANT toute vérification (certaines font de vraies
    // requêtes réseau, ex. la détection de versement en double) — sans ça, le bouton restait
    // cliquable pendant cette fenêtre, et un double-tap sur téléphone lent pouvait lancer deux
    // exécutions en parallèle. Repéré comme cause probable de doublons dans les mouvements de
    // stock (ex. la sortie supérette du soir, écrite deux fois). fail() remet busy à false sur
    // chaque sortie anticipée ; le succès passe par le finally plus bas.
    if (busy) return
    setBusy(true); setErr(''); setErrTarget('top'); setMsg('')
    if (!stationId) { fail('Aucune station sélectionnée.'); return }
    if (locked) { fail(lockedMsg); return }
    // 16h obligatoire : tous les relevés de la station doivent être remplis pour l'envoi de 16h
    const meters16h = [...machineNums(nombreMachines).map(n => `e${n}`), ...machineNums(nombreMachines).map(n => `g${n}`)]
    if (moment === 'apres-midi' && meters16h.some(k => f[k] === '' || f[k] === null || f[k] === undefined)) {
      fail(`Relevés 16 h obligatoires : remplis les ${meters16h.length} index des pompes avant d'envoyer.`, 'meters-16h', apresmidiMetersRef); return
    }
    // Même garde-fou pour le matin — sans lui, "matin" pouvait être envoyé (et marqué "validé" sur
    // le bouton de choix du moment) avec les relevés d'ouverture complètement vides.
    const metersMatin = [...machineNums(nombreMachines).map(n => `e${n}_m`), ...machineNums(nombreMachines).map(n => `g${n}_m`)]
    if (moment === 'matin' && metersMatin.some(k => f[k] === '' || f[k] === null || f[k] === undefined)) {
      fail(`Relevés du matin obligatoires : remplis les ${metersMatin.length} index des pompes avant d'envoyer.`, 'meters-matin', matinMetersRef); return
    }
    // Les photos (justificatif dépense, bordereau versement, compteur) sont recommandées mais
    // pas bloquantes par défaut — le gérant doit pouvoir envoyer ses chiffres même quand la
    // prise de photo échoue (rechargement d'écran, appareil bas de gamme). L'admin peut changer
    // ça (Stations & équipe → Paramètres → « Photo obligatoire ») : dans ce cas, elles deviennent
    // bloquantes comme n'importe quel autre champ obligatoire.
    if (settings.photo_obligatoire) {
      if (moment === 'apres-midi') {
        const manquantes = meters16hDefs.filter(([k, label]) => !meterHasPhoto(k, label))
        if (manquantes.length) {
          fail(`Photo obligatoire : ajoutez la photo du compteur pour ${manquantes.map(([, l]) => l).join(', ')} avant d'envoyer.`, 'meters-16h', apresmidiMetersRef); return
        }
      }
      if (moment === 'matin' || showAll) {
        const manquantes = matinMeterDefs.filter(([k, label]) => !meterHasPhoto(k, label))
        if (manquantes.length) {
          fail(`Photo obligatoire : ajoutez la photo du compteur pour ${manquantes.map(([, l]) => l).join(', ')} avant d'envoyer.`, 'meters-matin', matinMetersRef); return
        }
      }
      if (expenses.some(e => N(e.montant) > 0 && !nonCashCat(e.categorie) && !e.photo_path)) {
        fail('Photo obligatoire : ajoutez le justificatif de chaque dépense avant d\'envoyer.', 'expenses', expensesRef); return
      }
      if (deposits.some(d => N(d.montant) > 0 && !d.photo_path)) {
        fail('Photo obligatoire : ajoutez la photo du bordereau pour chaque versement avant d\'envoyer.', 'deposits', depositsRef); return
      }
    }
    if (deposits.some(d => N(d.montant) > 0 && (!d.periode_debut || !d.periode_fin))) {
      fail('Indiquez la période concernée (du… au…) pour chaque versement.', 'deposits', depositsRef); return
    }
    if (deposits.some(d => N(d.montant) > 0 && d.periode_debut > d.periode_fin)) {
      fail('La date de début d\'un versement doit être avant sa date de fin.', 'deposits', depositsRef); return
    }
    // Doublon DANS la même saisie : deux lignes identiques (même pôle/période/montant) ajoutées
    // par erreur — repéré en prod (double-tap sur "+ Ajouter un versement" sur un téléphone lent,
    // photo du même bordereau collée deux fois sans que le gérant remarque la 2e ligne créée).
    for (let i = 0; i < deposits.length; i++) {
      const d = deposits[i]
      if (N(d.montant) <= 0 || !d.periode_debut || !d.periode_fin || d.forceDoublon) continue
      const twin = deposits.find((x, j) => j !== i && N(x.montant) > 0 && !x.forceDoublon
        && x.pole === d.pole && x.periode_debut === d.periode_debut && x.periode_fin === d.periode_fin
        && Math.abs(N(x.montant) - N(d.montant)) < 1)
      if (twin) {
        setDeposits(p => p.map(x => x === d ? { ...x, _dupWarn: `Deux lignes identiques (${d.pole}, ${frDate(d.periode_debut)} → ${frDate(d.periode_fin)}, ${fcfa(N(d.montant))}) dans cette saisie — retire l'une des deux, ou coche « forcer » si ce sont bien deux versements distincts.` } : x))
        fail('Versement en double dans cette saisie — voir le détail ci-dessous.', 'deposits', depositsRef)
        return
      }
    }
    // Doublon : même pôle + même période + même montant déjà déclaré un AUTRE jour (celui-ci
    // remplace déjà ses propres versements à l'enregistrement, donc on ne se compare pas à
    // soi-même) — signale sans bloquer définitivement, le gérant/admin peut forcer si ce sont
    // réellement deux bordereaux distincts.
    for (const d of deposits) {
      if (N(d.montant) <= 0 || !d.periode_debut || !d.periode_fin || d.forceDoublon) continue
      const { data: existing } = await supabase.from('deposits').select('report_date,montant')
        .eq('station_id', stationId).eq('pole', d.pole)
        .eq('periode_debut', d.periode_debut).eq('periode_fin', d.periode_fin)
        .neq('report_date', date)
      const dup = (existing || []).find(x => Math.abs(N(x.montant) - N(d.montant)) < 1)
      if (dup) {
        setDeposits(p => p.map(x => x === d ? { ...x, _dupWarn: `Un versement identique (${d.pole}, ${frDate(d.periode_debut)} → ${frDate(d.periode_fin)}, ${fcfa(N(d.montant))}) est déjà déclaré le ${frDate(dup.report_date)}.` } : x))
        fail('Versement en double détecté — voir le détail ci-dessous.', 'deposits', depositsRef)
        return
      }
    }
    // Garde-fou décalage compteur : l'index du matin doit être > au dernier jour saisi —
    // vérifié POMPE PAR POMPE (pas seulement sur le total), sinon une pompe en baisse peut
    // passer inaperçue si une autre pompe compense dans la somme globale. Cas réel repéré :
    // un index gasoil mal saisi sur une seule pompe (baisse de ~30000) n'était pas assez
    // visible via le seul contrôle sur le total.
    if ((moment === 'matin' || showAll) && prevMorning && !forceMeter) {
      const parts = []
      for (const n of machineNums(nombreMachines)) {
        const essNow = N(f['e' + n + '_m']), essPrev = N(prevMorning.raw?.['e' + n + '_m'])
        if (essNow > 0 && essPrev > 0 && essNow < essPrev) parts.push(`essence pompe ${n} : ${Math.round(essNow)} < ${Math.round(essPrev)}`)
        const gasNow = N(f['g' + n + '_m']), gasPrev = N(prevMorning.raw?.['g' + n + '_m'])
        if (gasNow > 0 && gasPrev > 0 && gasNow < gasPrev) parts.push(`gasoil pompe ${n} : ${Math.round(gasNow)} < ${Math.round(gasPrev)}`)
      }
      if (parts.length) {
        setMeterWarn(`Index du matin incohérent — ${parts.join(', ')} — relevé du ${frDate(prevMorning.date)}. Un index de pompe ne peut que MONTER : sans ça, l'écart compteur sera décalé d'un jour.`)
        fail('Relevé compteur du matin incohérent — voir la section « Relevés compteurs à l\'ouverture » ci-dessus.', 'meters-matin', matinMetersRef)
        return
      }
    }
    const sid = stationId
    try {
      const payload = { report_date: date, station_id: sid, created_by: session.user.id, lubrifiant_stock: Object.keys(lub).length ? lub : null, lubrifiant_vendu: Object.keys(lubVendu).length ? lubVendu : null }
      NUMFIELDS.forEach(k => payload[k] = f[k] === '' ? null : numFR(f[k]))
      payload.note = f.note || null
      // Relevé du matin FIGÉ, distinct de ess_stock/gas_stock (qui continuent de refléter le
      // dernier niveau connu et sont réécrits par toute réception de livraison, même tard le
      // soir). Sans cette copie séparée, une livraison reçue le même jour après le relevé du
      // matin écrase ess_stock — et la réconciliation anti-coulage, qui compare le relevé du
      // matin d'un jour à l'autre, comptait alors la livraison une seconde fois par-dessus une
      // valeur qui la contenait déjà. Écrit UNIQUEMENT lors d'une saisie du pas "Matin".
      if (moment === 'matin' || showAll) {
        payload.ess_stock_matin = payload.ess_stock
        payload.gas_stock_matin = payload.gas_stock
      }
      const { error: e1 } = await supabase.from('daily_reports').upsert(payload, { onConflict: 'station_id,report_date' })
      if (e1) throw e1

      // Fige théorique + écart au moment de la déclaration (sinon "écart initial" n'est plus
      // reconstructible une fois que des mouvements de régularisation sont ajoutés ensuite).
      if (moment === 'matin' || showAll) {
        const snapRows = Object.keys(lub)
          .filter(t => lub[t] != null && lubTheorique[t] != null)
          .map(t => ({
            station_id: sid, categorie: 'lubrifiant', produit: t, report_date: date,
            stock_theorique_a_la_declaration: lubTheorique[t], stock_declare: N(lub[t]), ecart_initial: N(lub[t]) - lubTheorique[t],
          }))
        if (snapRows.length) await supabase.from('stock_declarations_snapshot').upsert(snapRows, { onConflict: 'station_id,categorie,produit,report_date' })
      }

      await supabase.from('expenses').delete().eq('report_date', date).eq('station_id', sid)
      const exRows = []
      for (const e of expenses) {
        if (N(e.montant) <= 0) continue
        const isCarb = nonCashCat(e.categorie)
        const row = { report_date: date, station_id: sid, categorie: e.categorie || "AUTRE", montant: numFR(e.montant),
          motif: e.motif || (isCarb ? 'Carburant / déplacement propriétaire' : null),
          justificatif: true, photo_path: e.photo_path || null, created_by: session.user.id,
          // Toujours explicite (jamais omis) : un insert groupé où certaines lignes ont
          // non_cash et d'autres non fait envoyer NULL (pas le DEFAULT false) sur les lignes
          // qui l'omettent — violait la contrainte NOT NULL dès qu'un lot mélangeait une
          // dépense carburant (non-cash) avec une autre catégorie.
          non_cash: isCarb }
        exRows.push(row)
      }
      if (exRows.length) { const { error } = await supabase.from('expenses').insert(exRows); if (error) throw error }

      await supabase.from('deliveries').delete().eq('report_date', date).eq('station_id', sid)
      const lvRows = deliveries.filter(d => N(d.quantite) > 0 || N(d.montant) > 0).map(d => ({
        report_date: date, station_id: sid, type: d.type || 'autre', quantite: d.quantite ? numFR(d.quantite) : null,
        unite: d.unite || null, pu_achat: d.pu_achat ? numFR(d.pu_achat) : null,
        montant: d.montant ? numFR(d.montant) : null, fournisseur: d.fournisseur || null,
        supplier_id: d.supplier_id ? Number(d.supplier_id) : null, note: d.note || null, created_by: session.user.id }))
      if (lvRows.length) { const { error } = await supabase.from('deliveries').insert(lvRows); if (error) throw error }

      await supabase.from('deposits').delete().eq('report_date', date).eq('station_id', sid)
      const depRows = []
      for (const d of deposits) {
        if (N(d.montant) <= 0) continue
        depRows.push({ report_date: date, station_id: sid, pole: d.pole || "carburant", montant: numFR(d.montant),
          periode_debut: d.periode_debut || null, periode_fin: d.periode_fin || null,
          deposit_date: d.periode_fin || null, photo_path: d.photo_path || null, created_by: session.user.id })
      }
      if (depRows.length) { const { error } = await supabase.from('deposits').insert(depRows); if (error) throw error }
      // photos-preuves envoyées
      for (const np of newPhotos) {
        const path = `${sid}/photos/${date}/${Date.now()}_${np.file.name.replace(/[^\w.\-]/g, '_')}`
        const { error: up } = await supabase.storage.from(BORDEREAUX_BUCKET).upload(path, await compressImage(np.file))
        if (up) throw up
        const { error: ai } = await supabase.from('attachments').insert({
          station_id: sid, report_date: date, categorie: np.categorie || 'autre', photo_path: path, created_by: session.user.id })
        if (ai) throw ai
      }
      // photos des compteurs : déjà envoyées à la prise de vue (voir handleMeterPhoto), rien à faire ici.

      // NB : plus de sortie automatique pour le GAZ / LUBRIFIANT.
      // Le stock est DÉCLARÉ chaque jour (gaz_stock_*, lubrifiant_stock) ; la sortie
      // (consommation) est DÉDUITE de deux relevés consécutifs par la vue v_sorties_deduites :
      //   sortie(J) = stock_déclaré(J-1) + entrées(J) − stock_déclaré(J).
      // On nettoie d'éventuelles anciennes sorties auto gaz/lubrifiant (doublons → stock négatif).
      await supabase.from('stock_movements').delete()
        .eq('station_id', sid).eq('date_mouvement', date).eq('source', 'vente')
        .in('categorie', ['gaz', 'lubrifiant'])
      // Supérette : suivie en VALEUR (pas de comptage déclaré) → sortie au coût de revient.
      await supabase.from('stock_movements').delete()
        .eq('station_id', sid).eq('date_mouvement', date).eq('source', 'vente').eq('categorie', 'superette')
      const tauxSup = N(settings.taux_superette) || 8
      const cogs = numFR(f.superette_espece) ? Math.round(numFR(f.superette_espece) * (1 - tauxSup / 100)) : 0
      if (cogs) await supabase.from('stock_movements').insert([{ station_id: sid, categorie: 'superette', type: 'sortie', valeur: cogs, source: 'vente', note: 'coût de revient', date_mouvement: date, created_by: session.user.id }])

      await supabase.from('submissions').insert({ report_date: date, station_id: sid, moment, created_by: session.user.id })

      // Recompresse en arrière-plan les photos envoyées brutes cette session (voir handleMeterPhoto
      // /handleExpensePhoto/handleDepositPhoto) — pas de await : ça ne doit pas retarder le retour
      // "Enregistré" à l'écran, et un échec ici (réseau...) n'a aucune conséquence sur la saisie
      // déjà enregistrée (compressStoredPhoto ne fait jamais échouer l'appelant).
      const toCompress = rawPhotoPathsRef.current.splice(0, rawPhotoPathsRef.current.length)
      for (const p of toCompress) compressStoredPhoto(supabase, BORDEREAUX_BUCKET, p)

      setMsg(`Enregistré ! (${momentLabel(moment)} — ${date})`)
      load(date)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { fail(e.message || String(e)) } finally { setBusy(false) }
  }

  // ===== VENDEUSE : saisie du jour par produit (vendu / reçu / périmé) =====
  const entry = (id) => entries[id] || { vendu: '', recu: '', perime: '' }
  const setEntry = (id, k, v) => setEntries(p => ({ ...p, [id]: { ...entry(id), [k]: v } }))
  const touched = (id) => { const e = entry(id); return N(e.vendu) > 0 || N(e.recu) > 0 || N(e.perime) > 0 }
  const lineMontant = (p) => N(entry(p.id).vendu) * N(p.prix_vente)
  const salesTotal = prods.reduce((a, p) => a + lineMontant(p), 0)
  async function addNewProduct() {
    const nom = (newProd.nom || '').trim()
    if (!nom) { setErr('Donne un nom au produit.'); return }
    setErr('')
    const payload = {
      categorie: 'superette', nom, unite: 'unité',
      prix_achat: numFR(newProd.prix_achat), prix_vente: numFR(newProd.prix_vente),
      statut: 'en_attente', actif: true, station_id: stationId, created_by: session.user.id, ordre: 100,
    }
    let { data, error } = await supabase.from('products').insert(payload).select().single()
    if (error && /duplicate|unique/i.test(error.message)) {
      const ex = await supabase.from('products').select('*').eq('categorie', 'superette').eq('nom', nom).maybeSingle()
      data = ex.data
    } else if (error) { setErr(error.message); return }
    if (!data) { setErr('Produit introuvable après ajout.'); return }
    setProds(p => [...p.filter(x => x.id !== data.id), data])
    setEntry(data.id, 'vendu', '1')
    setProdSearch(''); setNewProd({ nom: '', prix_achat: '', prix_vente: '' }); setShowNew(false)
  }

  async function saveVendeuse() {
    if (!stationId) { setErr('Aucune station sélectionnée.'); return }
    if (locked) { setErr(lockedMsg); return }
    const venduLines = prods.filter(p => N(entry(p.id).vendu) > 0)
    const recuLines = prods.filter(p => N(entry(p.id).recu) > 0)
    const perimeLines = prods.filter(p => N(entry(p.id).perime) > 0)
    setBusy(true); setErr(''); setMsg('')
    try {
      const { error } = await supabase.from('daily_reports').upsert(
        { station_id: stationId, report_date: date, superette_espece: salesTotal, created_by: session.user.id },
        { onConflict: 'station_id,report_date' })
      if (error) throw error
      // Remplace les lignes de vente du jour (idempotent → la vendeuse peut re-saisir/corriger)
      await supabase.from('superette_sales').delete().eq('station_id', stationId).eq('report_date', date)
      if (venduLines.length) {
        const { error: si } = await supabase.from('superette_sales').insert(venduLines.map(p => ({
          station_id: stationId, report_date: date, product_id: p.id, nom: p.nom,
          quantite: N(entry(p.id).vendu), prix_vente: N(p.prix_vente), montant: lineMontant(p), created_by: session.user.id,
        })))
        if (si) throw si
      }
      // Mouvements de stock par article (sans valeur : la valorisation globale reste celle
      // du champ "Espèces supérette" ci-dessus — éviter un double comptage dans v_stock_valeur).
      // Tagués par ref=saisie-vendeuse-<date> et remplacés en bloc à chaque enregistrement
      // (idempotent, comme superette_sales) sans toucher aux mouvements saisis ailleurs (Stock).
      const ref = `saisie-vendeuse-${date}`
      await supabase.from('stock_movements').delete().eq('station_id', stationId).eq('categorie', 'superette').eq('ref', ref)
      const mvts = [
        ...venduLines.map(p => ({ type: 'sortie', source: 'vente', produit: p.nom, quantite: N(entry(p.id).vendu), note: null })),
        ...recuLines.map(p => ({ type: 'entree', source: 'achat', produit: p.nom, quantite: N(entry(p.id).recu), note: 'Saisie vendeuse' })),
        ...perimeLines.map(p => ({ type: 'sortie', source: 'perte', produit: p.nom, quantite: N(entry(p.id).perime), note: 'Périmé / à jeter — saisie vendeuse' })),
      ]
      if (mvts.length) {
        const { error: mi } = await supabase.from('stock_movements').insert(mvts.map(m => ({
          station_id: stationId, categorie: 'superette', date_mouvement: date, created_by: session.user.id, ref, ...m,
        })))
        if (mi) throw mi
      }
      await supabase.from('submissions').insert({ report_date: date, station_id: stationId, moment: 'superette', created_by: session.user.id })
      setMsg('Supérette enregistrée')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  // Listes limitées aux activités de l'offre de la station.
  const typesAchat = [{ value: 'gaz', label: 'Gaz' }, { value: 'lubrifiant', label: 'Lubrifiant' }, { value: 'superette', label: 'Supérette' }, { value: 'autre', label: 'Autre' }]
    .filter(o => o.value === 'autre' || activite(o.value))
  const polesVersement = [
    { value: 'carburant', label: 'Carburant' },
    activite('gaz') && activite('lubrifiant') && { value: 'gaz_lubrifiant', label: 'Gaz + Lubrifiant' },
    activite('gaz') && { value: 'gaz', label: 'Gaz seul' },
    activite('lubrifiant') && { value: 'lubrifiant', label: 'Lubrifiant seul' },
    activite('superette') && { value: 'superette', label: 'Supérette' },
  ].filter(Boolean)

  // ===== VENDEUSE : accès à la Saisie du jour, UNIQUEMENT la partie supérette =====
  if (isVendeuse && !activite('superette')) return (
    <AlertBanner tone="info" title="Supérette non incluse">La supérette ne fait pas partie de l'offre de cette station. Contactez votre administrateur.</AlertBanner>
  )
  if (isVendeuse) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      <Panel title="Date" bodyStyle={{ display: 'none' }} actions={<Input size="sm" type="date" value={date} onChange={e => setDate(e.target.value)} max={today()} />} />
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {locked && <AlertBanner tone="alarm" title="Verrouillé">{lockedMsg}</AlertBanner>}
      <Panel title="Supérette — saisie du jour">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Recherchez un produit puis indiquez ce qui a été <b>vendu</b>, <b>reçu</b> (livraison non enregistrée ailleurs) ou <b>périmé/à jeter</b>. Chaque produit cherché reste affiché pour que vous puissiez continuer avec le suivant.
        </p>
        <Input size="sm" value={prodSearch} onChange={e => setProdSearch(e.target.value)} placeholder="Rechercher un produit…" style={{ marginBottom: 'var(--sp-4)' }} />

        {(() => {
          const visible = prods.filter(p => touched(p.id) || (prodSearch && p.nom.toLowerCase().includes(prodSearch.toLowerCase())))
          if (!visible.length) return <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>{prodSearch ? 'Aucun produit ne correspond.' : 'Recherchez un produit ci-dessus pour commencer la saisie.'}</p>
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
              <div style={{ display: 'flex', gap: 'var(--sp-3)', padding: '0 var(--sp-3)', font: '600 12px/1.2 var(--font-ui)', color: 'var(--text-muted)' }}>
                <span style={{ flex: 1 }}>Produit</span>
                <span style={{ width: 64, textAlign: 'center' }}>Vendu</span>
                <span style={{ width: 64, textAlign: 'center' }}>Reçu</span>
                <span style={{ width: 64, textAlign: 'center' }}>Périmé</span>
              </div>
              {visible.map(p => {
                const e = entry(p.id)
                return (
                  <div key={p.id} style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', padding: 'var(--sp-3)', background: touched(p.id) ? 'var(--surface-raised)' : 'transparent', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)' }}>
                    <span style={{ flex: 1, font: '400 15px/1.3 var(--font-ui)', color: 'var(--text-body)' }}>{p.nom}{p.prix_vente != null && <span style={{ color: 'var(--text-muted)' }}> · {fcfa(p.prix_vente)}</span>}</span>
                    <Input size="sm" type="text" inputMode="decimal" numeric value={e.vendu} onChange={ev => setEntry(p.id, 'vendu', ev.target.value)} style={{ width: 64 }} />
                    <Input size="sm" type="text" inputMode="decimal" numeric value={e.recu} onChange={ev => setEntry(p.id, 'recu', ev.target.value)} style={{ width: 64 }} />
                    <Input size="sm" type="text" inputMode="decimal" numeric value={e.perime} onChange={ev => setEntry(p.id, 'perime', ev.target.value)} style={{ width: 64 }} />
                  </div>
                )
              })}
            </div>
          )
        })()}

        <div style={{ marginTop: 'var(--sp-4)' }}>
          {!showNew
            ? <Button onClick={() => setShowNew(true)}>+ Produit absent de la liste</Button>
            : (
              <div style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <Field label="Nouveau produit (à valider par l'admin)">
                  <Input value={newProd.nom} onChange={e => setNewProd({ ...newProd, nom: e.target.value })} placeholder="ex : Eau 1,5L" />
                </Field>
                <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                  <Field label="Prix d'achat (F)" style={{ flex: 1 }}><Input type="text" inputMode="decimal" numeric value={newProd.prix_achat} onChange={e => setNewProd({ ...newProd, prix_achat: e.target.value })} /></Field>
                  <Field label="Prix de vente (F)" style={{ flex: 1 }}><Input type="text" inputMode="decimal" numeric value={newProd.prix_vente} onChange={e => setNewProd({ ...newProd, prix_vente: e.target.value })} /></Field>
                </div>
                <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                  <Button tone="dark" onClick={addNewProduct}>Ajouter &amp; vendre</Button>
                  <Button onClick={() => { setShowNew(false); setNewProd({ nom: '', prix_achat: '', prix_vente: '' }) }}>Annuler</Button>
                </div>
              </div>
            )}
        </div>
      </Panel>

      <div style={{ position: 'sticky', bottom: 0, background: 'var(--surface-panel)', border: 'var(--border-panel)', borderRadius: 'var(--radius-1)', padding: 'var(--gutter-panel)', boxShadow: '0 -4px 16px rgba(0,0,0,.12)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        <MetricTile label="Recette supérette" value={fcfa(salesTotal)} />
        <Button tone="primary" block onClick={saveVendeuse} disabled={busy || locked}>{busy ? 'Enregistrement…' : locked ? 'Verrouillé' : 'Envoyer'}</Button>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {/* ---- En-tête : date + moment ---- */}
      <Panel>
        <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} max={today()} style={{ maxWidth: 200 }} /></Field>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) 0' }}>Choisissez le moment de l'envoi. Seuls les champs à remplir s'affichent.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-3)' }}>
          <MomentTile icon="calendar-days" t="Matin (8h)" d="Stock + ouverture" active={moment === 'matin'} done={submittedMoments.has('matin')} onClick={() => setMoment('matin')} />
          <MomentTile icon="clock" t="16 h" d="Ventes &amp; compteurs" active={moment === 'apres-midi'} done={submittedMoments.has('apres-midi')} onClick={() => setMoment('apres-midi')} />
          <MomentTile icon="moon" t="Soir" d="Clôture &amp; versement" active={moment === 'soir'} done={submittedMoments.has('soir')} onClick={() => setMoment('soir')} />
        </div>
        {!isPompiste && !isVendeuse && (
          <Button tone="dark" icon="truck" block style={{ marginTop: 'var(--sp-4)' }} onClick={() => {
            setOpenReception(true)
            orderReceptionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}>J'ai reçu une commande</Button>
        )}
        <Checkbox label="Tout afficher (avancé)" checked={showAll} onChange={v => setShowAll(v)} style={{ marginTop: 'var(--sp-4)' }} />
      </Panel>

      {err && errTarget === 'top' && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {locked && <AlertBanner tone="alarm" title="Verrouillé">{lockedMsg} Lecture seule.</AlertBanner>}
      {isPompiste && <AlertBanner tone="info" title="Mode pompiste">Vous saisissez les compteurs, le stock et les photos. Les ventes et versements sont gérés par le gérant.</AlertBanner>}

      {/* ---- PHOTOS DU JOUR (vue seule, pour vérification admin) — accordéon replié par défaut ---- */}
      {attachments.length > 0 && (
        <Panel title="Photos du jour" meta={`${attachments.length}`} bodyStyle={openPhotosJour ? undefined : { display: 'none' }}
          actions={<IconButton icon="chevron-down" size="sm" title={openPhotosJour ? 'Masquer' : 'Afficher'}
            onClick={() => setOpenPhotosJour(v => !v)} style={{ transform: openPhotosJour ? 'rotate(180deg)' : 'none' }} />}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
            {attachments.map(a => (
              <PhotoThumb key={a.id} path={a.photo_path} label={a.categorie} timestamp={a.note} status="none" size={92}
                onRemove={() => delAttachment(a)} />
            ))}
          </div>
        </Panel>
      )}

      {/* ---- MATIN : STOCK ---- */}
      {show('matin') && (
        <Panel>
          <StepHead n="1" title="Stock du matin" />
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Combien reste-t-il en cuve et en boutiques ce matin ?</p>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <Field label="Essence en cuve (litres)" style={{ flex: '1 1 180px' }}><Input type="text" inputMode="decimal" numeric {...numProps('ess_stock')} /></Field>
            <Field label="Gasoil en cuve (litres)" style={{ flex: '1 1 180px' }}><Input type="text" inputMode="decimal" numeric {...numProps('gas_stock')} /></Field>
          </div>
          <FormSection title="Relevés compteurs à l'ouverture" style={{ marginTop: 'var(--sp-4)' }} innerRef={matinMetersRef}>
            <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>Index de chaque pompe ce matin (obligatoire), avec sa photo si possible (recommandée, mais pas bloquante). Sert à vérifier les ventes de la veille.</p>
            {err && errTarget === 'meters-matin' && !meterWarn && <AlertBanner tone="alarm" title="Erreur" style={{ marginBottom: 'var(--sp-3)' }}>{err}</AlertBanner>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--sp-3)' }}>
              {machineNums(nombreMachines).map(n => meterMachine(n, `e${n}_m`, `Essence ${n}`, `g${n}_m`, `Gasoil ${n}`))}
            </div>
            {prevMorning && <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 'var(--sp-3)' }}>Repère — index du matin du {frDate(prevMorning.date)} : essence <b>{Math.round(prevMorning.ess).toLocaleString('fr-FR')}</b>, gasoil <b>{Math.round(prevMorning.gas).toLocaleString('fr-FR')}</b>. Le nouvel index doit être supérieur.</p>}
            {meterWarn && (
              <AlertBanner tone="alarm" title="Index incohérent" style={{ marginTop: 'var(--sp-3)' }}>
                {meterWarn}
                {isAdmin
                  ? <Checkbox label="Forcer l'envoi (l'index est correct malgré tout)" checked={forceMeter} onChange={v => { setForceMeter(v); if (v) { setMeterWarn(''); setErr('') } }} style={{ marginTop: 'var(--sp-3)' }} />
                  : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-3) 0 0' }}>Corrigez l'index avant d'envoyer, ou prévenez l'administrateur si vous êtes sûr(e) qu'il est correct — seul un compte admin peut forcer l'envoi malgré cet avertissement.</p>}
              </AlertBanner>
            )}
          </FormSection>
          {activite('gaz') && showStockLubGaz && <FormSection title="Bouteilles de gaz en stock" style={{ marginTop: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {GAZ.map(([k, lab]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
                  <span style={{ flex: 1, font: '400 15px/1.25 var(--font-ui)', color: 'var(--text-body)' }}>{lab}</span>
                  <NumericStepper value={Number(f['gaz_stock_' + k]) || 0} onChange={v => set('gaz_stock_' + k, String(v))} suffix="b." />
                </div>
              ))}
            </div>
          </FormSection>}
          {activite('lubrifiant') && showStockLubGaz && <FormSection title="Lubrifiants en stock" style={{ marginTop: 'var(--sp-4)' }}>
            <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>Nombre de bidons en stock, par référence — c'est cette info que vous mettez à jour chaque matin.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--sp-4)' }}>
              {lubTypes.map(pr => {
                const t = pr.nom
                const th = lubTheorique[t]
                const ecart = (th != null && lub[t] != null) ? N(lub[t]) - th : null
                return (
                  <div key={t} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                    <span style={{ font: '400 14px/1.2 var(--font-ui)', color: 'var(--text-body)' }}>{t}</span>
                    <Input size="sm" type="text" inputMode="numeric" numeric value={lub[t] ?? ''} placeholder="0" style={{ width: 90 }}
                      onChange={e => setLub(p => ({ ...p, [t]: e.target.value === '' ? undefined : Number(e.target.value) }))} />
                    {ecart != null && (
                      <span style={{ font: '400 12px/1.3 var(--font-ui)', color: Math.abs(ecart) < 0.5 ? 'var(--state-ok)' : 'var(--state-alarm)' }}>
                        Théorique {th} — écart {ecart > 0 ? '+' : ''}{ecart}{Math.abs(ecart) >= 0.5 ? ' à justifier' : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </FormSection>}
        </Panel>
      )}

      {/* ---- 16h : VENTES + COMPTEURS ---- */}
      {show('apres-midi') && (<>
        {!isPompiste && <Panel>
          <StepHead n="2" title="Ventes carburant (de la veille)" />
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Ce sont les ventes du jour écoulé. Les litres sont pré-remplis depuis les relevés compteur du matin — vérifie et corrige si besoin, puis sépare Bon / Espèces.</p>
          <FormSection title={`Essence — ${settings.essence_pv} F/L`}>
            <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              <Field label="Litres" style={{ flex: '1 1 140px' }} hint={essCompteur != null ? `Compteurs : ${essCompteur.toLocaleString('fr-FR')} L` : undefined}><Input type="text" inputMode="decimal" numeric {...numProps('ess_litres')} /></Field>
              <Field label="Vente à bon" style={{ flex: '1 1 140px' }}><Input type="text" inputMode="decimal" numeric {...numProps('ess_bon')} /></Field>
            </div>
            <Field label="Vente en espèces" style={{ marginTop: 'var(--sp-3)' }}><Input type="text" inputMode="decimal" numeric {...numProps('ess_espece')} /></Field>
            {essAttendu > 0 && (
              <p style={{ font: '400 13px/1.4 var(--font-ui)', color: Math.abs(essAttendu - essDeclare) > 1 ? 'var(--state-alarm)' : 'var(--state-ok)', margin: 'var(--sp-2) 0 0' }}>
                {Math.round(essAttendu).toLocaleString('fr-FR')} L × {N(f.ess_pu)} F = {Math.round(essAttendu).toLocaleString('fr-FR')} F attendu — bon + espèces = {Math.round(essDeclare).toLocaleString('fr-FR')} F
                {Math.abs(essAttendu - essDeclare) > 1 ? ` (écart ${Math.round(essAttendu - essDeclare).toLocaleString('fr-FR')} F)` : ' ✓'}
              </p>
            )}
          </FormSection>
          <FormSection title={`Gasoil — ${settings.gasoil_pv} F/L`} style={{ marginTop: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              <Field label="Litres" style={{ flex: '1 1 140px' }} hint={gasCompteur != null ? `Compteurs : ${gasCompteur.toLocaleString('fr-FR')} L` : undefined}><Input type="text" inputMode="decimal" numeric {...numProps('gas_litres')} /></Field>
              <Field label="Vente à bon" style={{ flex: '1 1 140px' }}><Input type="text" inputMode="decimal" numeric {...numProps('gas_bon')} /></Field>
            </div>
            <Field label="Vente en espèces" style={{ marginTop: 'var(--sp-3)' }}><Input type="text" inputMode="decimal" numeric {...numProps('gas_espece')} /></Field>
            {gasAttendu > 0 && (
              <p style={{ font: '400 13px/1.4 var(--font-ui)', color: Math.abs(gasAttendu - gasDeclare) > 1 ? 'var(--state-alarm)' : 'var(--state-ok)', margin: 'var(--sp-2) 0 0' }}>
                {Math.round(gasAttendu).toLocaleString('fr-FR')} L × {N(f.gas_pu)} F = {Math.round(gasAttendu).toLocaleString('fr-FR')} F attendu — bon + espèces = {Math.round(gasDeclare).toLocaleString('fr-FR')} F
                {Math.abs(gasAttendu - gasDeclare) > 1 ? ` (écart ${Math.round(gasAttendu - gasDeclare).toLocaleString('fr-FR')} F)` : ' ✓'}
              </p>
            )}
          </FormSection>
          <AlertBanner tone="ok" title="Marge" style={{ marginTop: 'var(--sp-4)' }}>Marge carburant estimée : <b>{fcfa(marge)}</b> ({settings.marge_unitaire} F/L)</AlertBanner>
        </Panel>}

        {!isPompiste && <Panel>
          <StepHead n="3" title={activite('gaz') ? 'Gaz et autres ventes' : 'Autres ventes'} />
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>
            {showVenduLubGaz ? 'Bouteilles et quantités vendues aujourd\'hui, et recettes en espèces des autres pôles.' : 'Recettes en espèces des autres pôles.'}
          </p>
          {activite('gaz') && showVenduLubGaz && <FormSection title="Bouteilles de gaz vendues">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {GAZ.map(([k, lab]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
                  <span style={{ flex: 1, font: '400 15px/1.25 var(--font-ui)', color: 'var(--text-body)' }}>{lab}</span>
                  <NumericStepper value={Number(f['gaz_vendu_' + k]) || 0} onChange={v => set('gaz_vendu_' + k, String(v))} suffix="b." />
                </div>
              ))}
            </div>
          </FormSection>}
          {activite('lubrifiant') && showVenduLubGaz && <FormSection title="Lubrifiants vendus" style={{ marginTop: 'var(--sp-4)' }}>
            <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
              Quantité vendue par référence aujourd'hui — sert à calculer la vraie commission (prix de vente − prix d'achat), plus une estimation à %.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--sp-4)' }}>
              {lubTypes.map(pr => {
                const t = pr.nom
                const hasCondit = N(pr.conditionnement_qte) > 0
                return (
                  <div key={t} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                    <span style={{ font: '400 14px/1.2 var(--font-ui)', color: 'var(--text-body)' }}>{t}</span>
                    {!hasCondit ? (
                      <Input size="sm" type="text" inputMode="numeric" numeric value={lubVendu[t] ?? ''} placeholder="0" style={{ width: 90 }}
                        onChange={e => setLubVendu(p => ({ ...p, [t]: e.target.value === '' ? undefined : Number(e.target.value) }))} />
                    ) : (() => {
                      const split = lubVenduSplit[t] || { cartons: '', unites: '' }
                      const updateSplit = (patch) => {
                        const next = { ...split, ...patch }
                        setLubVenduSplit(p => ({ ...p, [t]: next }))
                        const total = N(next.cartons) * N(pr.conditionnement_qte) + N(next.unites)
                        setLubVendu(p => ({ ...p, [t]: total || undefined }))
                      }
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                          <Input size="sm" type="text" inputMode="numeric" numeric value={split.cartons} placeholder="0" style={{ width: 55 }}
                            onChange={e => updateSplit({ cartons: e.target.value })} />
                          <span style={{ font: '400 12px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>{pr.conditionnement_nom || 'carton'}(s) +</span>
                          <Input size="sm" type="text" inputMode="numeric" numeric value={split.unites} placeholder="0" style={{ width: 55 }}
                            onChange={e => updateSplit({ unites: e.target.value })} />
                          <span style={{ font: '400 12px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>{pr.unite || 'unité'}(s) = {N(lubVendu[t])}</span>
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          </FormSection>}
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', marginTop: 'var(--sp-4)' }}>
            {activite('gaz') && <Field label="Espèces gaz" style={{ flex: '1 1 160px' }}><Input type="text" inputMode="decimal" numeric {...touchedNumProps('gaz_espece', setGazEspeceTouched)} /></Field>}
            {activite('superette') && <Field label="Espèces supérette" style={{ flex: '1 1 160px' }}><Input type="text" inputMode="decimal" numeric {...numProps('superette_espece')} /></Field>}
            {activite('lubrifiant') && <Field label="Espèces lubrifiant" style={{ flex: '1 1 160px' }}><Input type="text" inputMode="decimal" numeric {...touchedNumProps('lubrifiant_espece', setLubEspeceTouched)} /></Field>}
          </div>
          {/* Préremplies depuis les quantités vendues × prix, mais modifiables (bouteille offerte,
              rabais…) — l'écart avec l'attendu reste visible, comme pour essence/gasoil plus haut :
              un repère pour le gérant, jamais bloquant à l'envoi. */}
          {activite('gaz') && showVenduLubGaz && gazEspeceCalc > 0 && (
            <p style={{ font: '400 13px/1.4 var(--font-ui)', color: Math.abs(gazEspeceCalc - N(f.gaz_espece)) > 1 ? 'var(--state-alarm)' : 'var(--state-ok)', margin: 'var(--sp-2) 0 0' }}>
              Espèces gaz attendues (bouteilles vendues × prix) : {Math.round(gazEspeceCalc).toLocaleString('fr-FR')} F — déclaré {Math.round(N(f.gaz_espece)).toLocaleString('fr-FR')} F
              {Math.abs(gazEspeceCalc - N(f.gaz_espece)) > 1 ? ` (écart ${Math.round(N(f.gaz_espece) - gazEspeceCalc).toLocaleString('fr-FR')} F)` : ' ✓'}
            </p>
          )}
          {activite('lubrifiant') && showVenduLubGaz && lubEspeceCalc > 0 && (
            <p style={{ font: '400 13px/1.4 var(--font-ui)', color: Math.abs(lubEspeceCalc - N(f.lubrifiant_espece)) > 1 ? 'var(--state-alarm)' : 'var(--state-ok)', margin: 'var(--sp-2) 0 0' }}>
              Espèces lubrifiant attendues (lubrifiants vendus × prix) : {Math.round(lubEspeceCalc).toLocaleString('fr-FR')} F — déclaré {Math.round(N(f.lubrifiant_espece)).toLocaleString('fr-FR')} F
              {Math.abs(lubEspeceCalc - N(f.lubrifiant_espece)) > 1 ? ` (écart ${Math.round(N(f.lubrifiant_espece) - lubEspeceCalc).toLocaleString('fr-FR')} F)` : ' ✓'}
            </p>
          )}
          <Field label="Total des bons en cours (cumul)" style={{ marginTop: 'var(--sp-3)' }}><Input type="text" inputMode="decimal" numeric {...numProps('total_bon_cumul')} /></Field>
        </Panel>}

        <Panel sectionRef={apresmidiMetersRef}>
          <StepHead n="4" title="Relevés 16 h — obligatoire" />
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Index de chaque pompe à 16 h — <b>obligatoire</b>. Photo recommandée si possible, mais pas bloquante.</p>
          {err && errTarget === 'meters-16h' && <AlertBanner tone="alarm" title="Erreur" style={{ marginBottom: 'var(--sp-4)' }}>{err}</AlertBanner>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--sp-3)' }}>
            {machineNums(nombreMachines).map(n => meterMachine(n, `e${n}`, `Pompe E${n}`, `g${n}`, `Pompe G${n}`))}
          </div>
        </Panel>
      </>)}

      {/* ---- RÉCEPTION COMMANDES : affichage PARTAGÉ avec « Commandes », à tout moment ---- */}
      {!isPompiste && !isVendeuse && (
        <div ref={orderReceptionRef}>
          {openReception && (
            <OrderReception stationId={stationId} date={date} settings={settings} onDone={() => load(date)}
              open={openReception} onToggle={() => setOpenReception(v => !v)} />
          )}
        </div>
      )}

      {/* ---- SOIR : ACHATS / DÉPENSES / VERSEMENTS ---- */}
      {show('soir') && !isPompiste && (<>
        <Panel>
          <CollapsibleHead n="6" title="Achats hors carburant" open={achatsOpen} onToggle={() => setOpenAchats(!achatsOpen)} count={deliveries.length} total={totLivr} />
          {achatsOpen && <>
            <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Gaz, lubrifiant, supérette, autre — avec fournisseur. (Le carburant se réceptionne via les commandes ci-dessus.)</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {deliveries.map((d, i) => (
                <div key={i} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                    <Field label="Type" style={{ flex: '1 1 160px' }}>
                      <Select value={d.type || typesAchat[0].value} onChange={e => upd(setDeliveries, i, 'type', e.target.value)} style={{ width: '100%' }}
                        options={typesAchat} />
                    </Field>
                    <Field label="Quantité" style={{ flex: '1 1 140px' }}><Input type="text" inputMode="decimal" numeric value={d.quantite || ''} onChange={e => upd(setDeliveries, i, 'quantite', e.target.value)} /></Field>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                    <Field label="Unité" style={{ flex: '1 1 160px' }}>
                      <Select value={d.unite || 'litres'} onChange={e => upd(setDeliveries, i, 'unite', e.target.value)} style={{ width: '100%' }}
                        options={[{ value: 'litres', label: 'litres' }, { value: 'bouteilles', label: 'bouteilles' }, { value: 'cartons', label: 'cartons' }, { value: 'unité', label: 'unité' }]} />
                    </Field>
                    <Field label="Coût total" style={{ flex: '1 1 140px' }}><Input type="text" inputMode="decimal" numeric value={d.montant || ''} onChange={e => upd(setDeliveries, i, 'montant', e.target.value)} /></Field>
                  </div>
                  <Field label={`Fournisseur${(d.type === 'essence' || d.type === 'gasoil') ? ' (carburant : fournisseur unique)' : ''}`}>
                    {suppliers.length > 0
                      ? <Select value={d.supplier_id || ''} onChange={e => upd(setDeliveries, i, 'supplier_id', e.target.value)} style={{ width: '100%' }}
                          options={[{ value: '', label: '— choisir —' }, ...suppliers.map(s => ({ value: s.id, label: `${s.nom} (${s.categorie})` }))]} />
                      : <Input value={d.fournisseur || ''} onChange={e => upd(setDeliveries, i, 'fournisseur', e.target.value)} placeholder="nom du fournisseur" />}
                  </Field>
                  <Button size="sm" tone="danger" onClick={() => rm(setDeliveries, i)} style={{ alignSelf: 'flex-start' }}>Retirer</Button>
                </div>
              ))}
            </div>
            <Button onClick={() => setDeliveries(p => [...p, typesAchat[0].value === 'gaz' ? { type: 'gaz', unite: 'bouteilles' } : { type: typesAchat[0].value }])} style={{ marginTop: 'var(--sp-4)' }}>+ Ajouter un achat</Button>
          </>}
        </Panel>

        <Panel sectionRef={expensesRef}>
          <CollapsibleHead n="7" title="Dépenses en espèces" open={depensesOpen} onToggle={() => setOpenDepenses(!depensesOpen)} count={expenses.length} total={totDepense} />
          {depensesOpen && <>
            <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Argent sorti de la caisse (électricité SBEE, achats…). Ajoutez le justificatif si vous l'avez.</p>
            {err && errTarget === 'expenses' && <AlertBanner tone="alarm" title="Erreur" style={{ marginBottom: 'var(--sp-4)' }}>{err}</AlertBanner>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {expenses.map((e, i) => (
                <div key={i} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                    <Field label="Type" style={{ flex: '1 1 200px' }}>
                      <Select value={e.categorie || expCats[0]?.key || 'SBEE'} onChange={ev => upd(setExpenses, i, 'categorie', ev.target.value)} style={{ width: '100%' }}
                        options={expCats.map(c => ({ value: c.key, label: c.label }))} />
                    </Field>
                    <Field label="Montant" style={{ flex: '1 1 140px' }}><Input type="text" inputMode="decimal" numeric value={e.montant || ''} onChange={ev => upd(setExpenses, i, 'montant', ev.target.value)} /></Field>
                  </div>
                  <Field label="Motif"><Input value={e.motif || ''} onChange={ev => upd(setExpenses, i, 'motif', ev.target.value)} placeholder="ex : recharge électricité" /></Field>
                  {nonCashCat(e.categorie) ? (
                    e.categorie === 'CARBURANT'
                      ? <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Prélèvement carburant du propriétaire : <b>charge non-cash</b> (aucun paiement en espèces). Pas de reçu requis ; remonte chaque mois au Point financier sous « Carburant / déplacement (auto) » et n'est pas décompté du cash à verser.</p>
                      : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}><b>Charge non-cash</b> (aucun paiement en espèces) — pas de justificatif requis.</p>
                  ) : (<>
                    <Field label="Photo du justificatif (recommandée)">
                      <Input type="file" accept="image/*" disabled={!!expPhotoBusy[i]}
                        onChange={ev => { const file = ev.target.files[0]; ev.target.value = ''; if (file) handleExpensePhoto(i, file) }} />
                    </Field>
                    {expPhotoBusy[i] && <p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Envoi de la photo…</p>}
                    {e.photo_path && !expPhotoBusy[i] && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                        <PhotoThumb path={e.photo_path} label="Justificatif" status="none" size={72} />
                        <p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--state-ok)', margin: 0 }}>Justificatif envoyé ✓</p>
                      </div>
                    )}
                  </>)}
                  <Button size="sm" tone="danger" onClick={() => rm(setExpenses, i)} style={{ alignSelf: 'flex-start' }}>Retirer</Button>
                </div>
              ))}
            </div>
            <Button onClick={() => setExpenses(p => [...p, { categorie: expCats[0]?.key || 'SBEE', montant: '' }])} style={{ marginTop: 'var(--sp-4)' }}>+ Ajouter une dépense</Button>
          </>}
        </Panel>

        <Panel sectionRef={depositsRef}>
          <CollapsibleHead n="8" title="Versement en banque" open={versementsOpen} onToggle={() => setOpenVersements(!versementsOpen)} count={deposits.length} total={totVerse} />
          {versementsOpen && <>
            <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Prenez la photo du bordereau juste après le dépôt. Un versement peut couvrir <b>plusieurs jours de recette</b> : indiquez la <b>période concernée</b> (du… au…). Le système additionnera les recettes de cette période pour vérifier que ça correspond.</p>
            {err && errTarget === 'deposits' && <AlertBanner tone="alarm" title="Erreur" style={{ marginBottom: 'var(--sp-4)' }}>{err}</AlertBanner>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {deposits.map((d, i) => (
                <div key={i} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                    <Field label="Source (pôle) *" style={{ flex: '1 1 180px' }}>
                      <Select value={d.pole || 'carburant'} onChange={ev => setDeposits(p => p.map((x, j) => j === i ? { ...x, pole: ev.target.value, _dupWarn: undefined, forceDoublon: false } : x))} style={{ width: '100%' }}
                        options={polesVersement} />
                    </Field>
                    <Field label="Montant versé *" style={{ flex: '1 1 140px' }}><Input type="text" inputMode="decimal" numeric value={d.montant || ''} onChange={ev => setDeposits(p => p.map((x, j) => j === i ? { ...x, montant: ev.target.value, _dupWarn: undefined, forceDoublon: false } : x))} /></Field>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                    <Field label="Période concernée — du *" style={{ flex: '1 1 160px' }}><Input type="date" max={date} value={d.periode_debut || ''} onChange={ev => setDeposits(p => p.map((x, j) => j === i ? { ...x, periode_debut: ev.target.value, _dupWarn: undefined, forceDoublon: false } : x))} /></Field>
                    <Field label="… au *" style={{ flex: '1 1 160px' }}><Input type="date" max={date} value={d.periode_fin || ''} onChange={ev => setDeposits(p => p.map((x, j) => j === i ? { ...x, periode_fin: ev.target.value, _dupWarn: undefined, forceDoublon: false } : x))} /></Field>
                  </div>
                  {d.periode_debut && d.periode_fin && d.periode_debut !== d.periode_fin &&
                    <p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Versement cumulé sur {frDate(d.periode_debut)} → {frDate(d.periode_fin)}</p>}
                  {d._dupWarn && (
                    <AlertBanner tone="warn" title="Versement en double ?">
                      {d._dupWarn}
                      <Checkbox label="Ce sont bien deux versements distincts (forcer)" checked={!!d.forceDoublon} onChange={v => upd(setDeposits, i, 'forceDoublon', v)} style={{ marginTop: 'var(--sp-3)' }} />
                    </AlertBanner>
                  )}
                  <Field label="Photo du bordereau (recommandée)">
                    <Input type="file" accept="image/*" disabled={!!depPhotoBusy[i]}
                      onChange={ev => { const file = ev.target.files[0]; ev.target.value = ''; if (file) handleDepositPhoto(i, file) }} />
                  </Field>
                  {depPhotoBusy[i] && <p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Envoi de la photo…</p>}
                  {d.photo_path && !depPhotoBusy[i] && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                      <PhotoThumb path={d.photo_path} label="Bordereau" status="none" size={72} />
                      <p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--state-ok)', margin: 0 }}>Photo envoyée ✓</p>
                    </div>
                  )}
                  <Button size="sm" tone="danger" onClick={() => rm(setDeposits, i)} style={{ alignSelf: 'flex-start' }}>Retirer</Button>
                </div>
              ))}
            </div>
            <Button onClick={() => setDeposits(p => {
              const last = p[p.length - 1]
              // Évite une 2e ligne vide en double si le bouton est tapé deux fois rapidement
              // (téléphone lent, pas de retour visuel immédiat) — la ligne précédente doit déjà
              // avoir un montant ou une photo avant d'en ouvrir une nouvelle.
              if (last && !N(last.montant) && !last.photo_path) return p
              return [...p, { pole: 'carburant', periode_debut: date, periode_fin: date }]
            })} style={{ marginTop: 'var(--sp-4)' }}>+ Ajouter un versement</Button>
          </>}
        </Panel>
      </>)}

      {/* ---- RÉCAP + ENREGISTRER ---- */}
      <div style={{ position: 'sticky', bottom: 0, background: 'var(--surface-panel)', border: 'var(--border-panel)', borderRadius: 'var(--radius-1)', padding: 'var(--gutter-panel)', boxShadow: '0 -4px 16px rgba(0,0,0,.12)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--sp-4)' }}>
          {footerKpis()}
        </div>
        {(moment === 'soir' || showAll) && <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Un versement peut couvrir plusieurs jours : l'écart réel (recette − versé) est calculé <b>par pôle et par période</b> côté administration, pas ici.</p>}
        <Button tone="primary" block onClick={save} disabled={busy || locked}>{busy ? 'Enregistrement…' : locked ? 'Verrouillé' : `Envoyer (${momentLabel(moment)})`}</Button>
      </div>
    </div>
  )

  function upd(setter, i, k, v) { setter(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x)) }
  function rm(setter, i) { setter(p => p.filter((_, j) => j !== i)) }
}

function defaultMoment() { const h = new Date().getHours(); return h < 12 ? 'matin' : h < 18 ? 'apres-midi' : 'soir' }
function daysAgoIso(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
function momentLabel(m) { return m === 'matin' ? 'Matin' : m === 'apres-midi' ? '16 h' : m === 'soir' ? 'Soir' : m }

function MomentTile({ icon, t, d, active, done, onClick }) {
  return (
    <div onClick={onClick} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-4)', textAlign: 'center', cursor: 'pointer',
      background: active ? 'var(--accent-quiet)' : 'var(--surface-raised)', border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border-default)'), borderRadius: 'var(--radius-1)', transition: 'var(--t-control)' }}>
      {done && <span style={{ position: 'absolute', top: 'var(--sp-2)', right: 'var(--sp-2)', width: 16, height: 16, borderRadius: '50%', background: 'var(--state-ok)', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={10} strokeWidth={3} />
      </span>}
      <Icon name={icon} size={18} color={active ? 'var(--accent)' : 'var(--text-muted)'} />
      <div style={{ font: 'var(--fw-semibold) 14px/1.2 var(--font-ui)', color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{t}</div>
      <div style={{ font: '400 13px/1.2 var(--font-ui)', color: 'var(--text-muted)' }}>{d}</div>
    </div>
  )
}
function StepHead({ n, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
      <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-quiet)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', font: 'var(--fw-semibold) 14px/1.25 var(--font-data)' }}>{n}</span>
      <h2 style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)', margin: 0 }}>{title}</h2>
    </div>
  )
}
// en-tête cliquable pour replier/déplier une section — compact (compteur + total) quand fermée
function CollapsibleHead({ n, title, open, onToggle, count, total }) {
  return (
    <div onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: open ? 'var(--sp-3)' : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-quiet)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', font: 'var(--fw-semibold) 14px/1.25 var(--font-data)' }}>{n}</span>
        <h2 style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)', margin: 0 }}>{title}</h2>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        {count > 0 && <Tag>{count} · {fcfa(total)}</Tag>}
        <Icon name="chevron-down" size={14} color="var(--text-muted)" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </div>
    </div>
  )
}
function FormSection({ title, children, style, innerRef }) {
  return (
    <div ref={innerRef} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', ...style }}>
      <div style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>{title}</div>
      {children}
    </div>
  )
}
