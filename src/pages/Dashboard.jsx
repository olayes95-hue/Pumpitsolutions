import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOffre } from '../lib/offre.jsx'
import { filtrerAlertes } from '../lib/formules'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, lastDayOfMonth } from '../lib/format'
import { ALERT_TONES } from '../lib/tones'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { IconButton } from '../ds/pumpit/components/core/IconButton.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { PeriodPicker } from '../ds/pumpit/components/forms/PeriodPicker.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? Number(v) : 0)
const YEAR_TONE = (d) => d == null ? undefined : d < 3 ? 'alarm' : d < 6 ? 'warn' : 'ok'
const YEAR_COLOR = (d) => d == null ? 'var(--text-primary)' : d < 3 ? 'var(--state-alarm)' : d < 6 ? 'var(--state-warn)' : 'var(--state-ok)'
// Couleurs des activités (charte PumpIT) : toujours dans l'ordre Carburants, Lubrifiants, Gaz, Supérette.
const POLE_COLORS = { Carburant: 'var(--act-carburants)', Lubrifiant: 'var(--act-lubrifiants)', Gaz: 'var(--act-gaz)', Supérette: 'var(--act-superette)' }
// Palette neutre (pas de sens sémantique ok/alarm) pour différencier des catégories dans un
// camembert détaillé — utilisée en repli quand une catégorie n'a pas de couleur dédiée.
const SIGNAL_PALETTE = ['var(--act-carburants)', 'var(--act-lubrifiants)', 'var(--act-gaz)', 'var(--act-superette)', 'var(--act-lavage)', 'var(--nuit)', 'var(--sauge)', 'var(--ardoise)']
// Bornes de dates pour une sélection année/mois du dashboard ('all' = pas de filtre sur ce niveau).
function periodBounds(year, month) {
  if (year === 'all') return { from: '2000-01-01', to: '2100-12-31' }
  if (month === 'all') return { from: `${year}-01-01`, to: `${year}-12-31` }
  // '-31' codé en dur était une date invalide pour tout mois à moins de 31 jours (avril, juin,
  // septembre, novembre, février) — la requête report_date<=... échouait silencieusement (data
  // jamais vérifié) et affichait 0 partout où cette période est utilisée (manque à verser,
  // graphiques par pôle...) dès qu'un mois de moins de 31 jours était sélectionné.
  return { from: `${year}-${month}-01`, to: lastDayOfMonth(`${year}-${month}`) }
}

export default function Dashboard() {
  const { stationId } = useStation()
  const { has, activite } = useOffre()   // fonctions et activités incluses dans l'offre de la station courante
  const nav = useNavigate()
  const [months, setMonths] = useState([])   // v_ventes_mensuelles (agrégé, rapide)
  const [alerts, setAlerts] = useState([])   // v_alerts des 60 derniers jours (station active), triées par gravité
  const [stock, setStock] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [loading, setLoading] = useState(true)
  // Par défaut, mois en cours (pas le dernier mois avec des données, qui peut être ancien).
  const today = new Date().toISOString().slice(0, 10)
  const [year, setYear] = useState(today.slice(0, 4))
  const [month, setMonth] = useState(today.slice(5, 7))
  const [refreshedAt, setRefreshedAt] = useState('')
  const [openRecon, setOpenRecon] = useState(false)
  const [polePeriod, setPolePeriod] = useState({ dr: [], recon: [], exp: [], sup: [], lub: [] })   // brut, pour manque-à-verser et détail par pôle/catégorie sur la période sélectionnée
  const [charges, setCharges] = useState([])   // table "charges" du Point financier (Finance.jsx) — loyer, salaires, impôts...
  const [gazPrices, setGazPrices] = useState({})   // {nom bouteille: prix_vente actuel} — pour estimer le CA gaz par taille
  const [lubPrices, setLubPrices] = useState({})   // {nom référence: prix_vente actuel} — pour estimer le CA lubrifiant par type
  const [uniteMode, setUniteMode] = useState(false)   // false = CFA, true = unité physique (L, bouteilles, articles...)
  const [poleEvolution, setPoleEvolution] = useState('carburant')   // pôle affiché par "Évolution mensuelle par pôle" en mode Unité
  const [poleUniteSeries, setPoleUniteSeries] = useState([])   // [{mois, value}] pour gaz/supérette en mode Unité (carburant vient directement de `months`)

  useEffect(() => {
    if (!stationId) return
    supabase.from('charges').select('mois,categorie,montant').eq('station_id', stationId).then(({ data }) => setCharges(data || []))
  }, [stationId])

  // Chargé seulement quand nécessaire : la tendance mensuelle en UNITÉ (pas en CFA) n'existe pas
  // dans l'agrégat v_ventes_mensuelles pour gaz/supérette (qui ne connaît que la valeur en F) —
  // il faut regrouper les lignes brutes par mois côté client. Le carburant, lui, a déjà sa
  // colonne litres_carburant dans l'agrégat mensuel : pas besoin de requête supplémentaire.
  useEffect(() => {
    if (!uniteMode || !stationId || poleEvolution === 'carburant') { setPoleUniteSeries([]); return }
    const { from, to } = periodBounds(year, month)
    ;(async () => {
      const byMonth = {}
      if (poleEvolution === 'gaz') {
        const { data } = await supabase.from('daily_reports').select('report_date,gaz_vendu_3,gaz_vendu_6,gaz_vendu_12,gaz_vendu_38').eq('station_id', stationId).gte('report_date', from).lte('report_date', to)
        for (const r of (data || [])) {
          const m = r.report_date.slice(0, 7)
          byMonth[m] = (byMonth[m] || 0) + N(r.gaz_vendu_3) + N(r.gaz_vendu_6) + N(r.gaz_vendu_12) + N(r.gaz_vendu_38)
        }
      } else if (poleEvolution === 'superette') {
        const { data } = await supabase.from('superette_sales').select('report_date,quantite').eq('station_id', stationId).gte('report_date', from).lte('report_date', to)
        for (const r of (data || [])) {
          const m = r.report_date.slice(0, 7)
          byMonth[m] = (byMonth[m] || 0) + N(r.quantite)
        }
      } else if (poleEvolution === 'lubrifiant') {
        const { data } = await supabase.from('v_sorties_deduites').select('report_date,sortie_deduite').eq('station_id', stationId).eq('categorie', 'lubrifiant').gte('report_date', from).lte('report_date', to)
        for (const r of (data || [])) {
          const m = r.report_date.slice(0, 7)
          byMonth[m] = (byMonth[m] || 0) + Math.max(0, N(r.sortie_deduite))
        }
      }
      setPoleUniteSeries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([mois, value]) => ({ mois, value })))
    })()
  }, [uniteMode, poleEvolution, stationId, year, month])

  useEffect(() => {
    supabase.from('products').select('nom,prix_vente').eq('categorie', 'gaz').then(({ data }) => {
      const m = {}; for (const p of (data || [])) m[p.nom] = N(p.prix_vente); setGazPrices(m)
    })
    supabase.from('products').select('nom,prix_vente').eq('categorie', 'lubrifiant').then(({ data }) => {
      const m = {}; for (const p of (data || [])) m[p.nom] = N(p.prix_vente); setLubPrices(m)
    })
  }, [])

  useEffect(() => {
    if (!stationId) return
    const { from, to } = periodBounds(year, month)
    ;(async () => {
      const [dr, recon, exp, sup, lub] = await Promise.all([
        supabase.from('daily_reports').select('ess_litres,ess_pu,gas_litres,gas_pu,gaz_vendu_3,gaz_vendu_6,gaz_vendu_12,gaz_vendu_38').eq('station_id', stationId).gte('report_date', from).lte('report_date', to),
        // 3 lignes/jour (une par pôle) : sur "Toutes années", sans tri+limite explicites, la
        // limite par défaut de l'API (1000 lignes) tronque arbitrairement (cf. bug Historique).
        supabase.from('v_pole_recon_jour').select('*').eq('station_id', stationId).gte('report_date', from).lte('report_date', to).order('report_date', { ascending: false }).limit(5000),
        supabase.from('expenses').select('categorie,montant,non_cash').eq('station_id', stationId).gte('report_date', from).lte('report_date', to),
        supabase.from('superette_sales').select('nom,montant,quantite').eq('station_id', stationId).gte('report_date', from).lte('report_date', to),
        supabase.from('v_sorties_deduites').select('produit,sortie_deduite').eq('station_id', stationId).eq('categorie', 'lubrifiant').gte('report_date', from).lte('report_date', to),
      ])
      setPolePeriod({ dr: dr.data || [], recon: recon.data || [], exp: exp.data || [], sup: sup.data || [], lub: lub.data || [] })
    })()
  }, [stationId, year, month])

  async function loadStock() {
    if (!stationId) return
    const [ls, sf] = await Promise.all([
      supabase.from('v_latest_stock').select('*').eq('station_id', stationId).maybeSingle(),
      supabase.from('v_stock_forecast').select('*').eq('station_id', stationId).maybeSingle(),
    ])
    setStock(ls.data || null); setForecast(sf.data || null)
    setRefreshedAt(new Date().toLocaleTimeString('fr-FR'))
  }
  useEffect(() => { if (!stationId) return
    setLoading(true)
    // Le stock (rapide) s'affiche en premier ; les autres blocs se remplissent dès qu'ils arrivent,
    // sans s'attendre les uns les autres. La vue mensuelle (la plus lourde) ne bloque plus le rendu.
    loadStock()
    supabase.from('v_ventes_mensuelles').select('*').eq('station_id', stationId).order('mois')
      .then(({ data }) => { setMonths(data || []); setLoading(false) })
    // les alertes (vue lourde) se chargent après l'affichage, sans bloquer — fenêtre glissante de
    // 60 jours (pas le mois calendaire en cours) : un manque à verser d'un mois encore non réglé
    // ne doit pas disparaître silencieusement le 1er du mois suivant simplement parce qu'il est
    // sorti de la période affichée — constaté en prod (directeur/admin ne voyaient plus un
    // versement en retard une fois le mois tourné, alors qu'il restait dû).
    const day = new Date().toISOString().slice(0, 10)
    const cutoff60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)
    Promise.all([
      supabase.from('v_alerts').select('*').eq('station_id', stationId).gte('report_date', cutoff60).lte('report_date', day),
      supabase.from('alert_dismissals').select('report_date,type').eq('station_id', stationId),
    ]).then(([al, dis]) => {
      // v_alerts n'a aucune notion de "traité" (vue calculée) — sans ce filtre, une alerte
      // marquée traitée sur la page Alertes continuait d'apparaître ici indéfiniment.
      const dismissedKeys = new Set((dis.data || []).map(x => x.report_date + '|' + x.type))
      const activeAlerts = filtrerAlertes(al.data, has).filter(a => !dismissedKeys.has(a.report_date + '|' + a.type))
      setAlerts(activeAlerts.sort((a, b) => (a.gravite === 'haute' ? -1 : 1) - (b.gravite === 'haute' ? -1 : 1)))
    })
  }, [stationId])
  useEffect(() => {
    if (!stationId) return
    const ch = supabase.channel('stock-' + stationId).on('postgres_changes', { event: '*', schema: 'public', table: 'daily_reports', filter: `station_id=eq.${stationId}` }, loadStock).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [stationId])


  const years = useMemo(() => [...new Set([...months.map(m => m.mois.slice(0, 4)), today.slice(0, 4)])].sort(), [months])

  const fm = months.filter(m => (year === 'all' || m.mois.slice(0, 4) === year) && (month === 'all' || m.mois.slice(5, 7) === month))
  const sum = (k) => fm.reduce((s, m) => s + N(m[k]), 0)

  if (loading && !stock && !months.length) return <Panel><p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Chargement…</p></Panel>
  const L = (v) => loading && !months.length ? '…' : v

  const totBon = sum('ventes_bon'), totCash = sum('recettes_especes'), totVerse = sum('total_verse')
  const caTotal = totBon + totCash
  const pctBon = caTotal ? Math.round(100 * totBon / caTotal) : null
  const pctEsp = caTotal ? Math.round(100 * totCash / caTotal) : null
  const totDep = sum('total_depense'), totMarge = sum('commission_carburant'), totLivr = sum('total_livraisons')

  // Manque à verser par pôle (bâtons) — même calcul que le Journal de bord du gérant, attribué
  // période par période via v_pole_recon_jour (pas de simple découpage calendaire) : un jour qui
  // clôture une période compte le cumul réel NET de CETTE période (g.ecart = recette − dépense −
  // verse, quelle que soit sa durée, même à cheval sur deux mois) ; un jour encore couvert par une
  // période en cours ne compte rien (résolu à la clôture) ; un jour non couvert par aucune période
  // compte sa recette BRUTE (g.espece seul) — surtout PAS g.espece − g.depense : une dépense peut
  // sortir d'un cash accumulé sur des jours précédents, sans lien avec la recette du jour même ;
  // elle sera nettée plus tard par la période qui finira par couvrir ce jour (g.ecart à ce moment).
  // Avant, ce calcul resommait en plus toutes les dépenses SBEE/AUTRE du mois calendaire et les
  // déduisait une seconde fois du carburant — déduction en double pour celles déjà couvertes par
  // une période close (g.ecart les a déjà nettées), et déduction à tort pour celles tombées un
  // jour non couvert par aucune période. Constaté en prod (Beaurivage, sept. 2026) : −100 000 F
  // affiché au lieu de 0 F sur le carburant à cause d'une 3ᵉ facture SBEE (29 sept., espece=0 ce
  // jour-là) hors de toute période close — un g.espece − g.depense aurait reproduit EXACTEMENT
  // le même bug par une autre branche (constaté en prod après un premier correctif incomplet).
  const manquePole = (() => {
    const manqueByPole = { carburant: 0, gaz_lub: 0, superette: 0 }
    for (const g of polePeriod.recon) {
      if (!(g.pole_groupe in manqueByPole)) continue
      if (N(g.nb_cloture) > 0) manqueByPole[g.pole_groupe] += N(g.ecart)
      else if (!g.couvert) manqueByPole[g.pole_groupe] += N(g.espece)
    }
    return [
      { name: 'Carburant', value: manqueByPole.carburant },
      { name: 'Gaz + Lubrifiant', value: manqueByPole.gaz_lub },
      { name: 'Supérette', value: manqueByPole.superette },
    ]
  })()
  // "Cash non tracé" doit être la MÊME notion que "Manque à verser par pôle" juste en dessous —
  // reprend son total au lieu de son propre calcul par simple agrégat mensuel (totCash − totDep −
  // totVerse), qui comptait un versement à cheval sur deux mois en entier dans le mois de clôture
  // pendant que le graphique ci-dessous suivait déjà la vraie période. Ça pouvait afficher deux
  // chiffres différents pour "la même chose" sur le même écran (constaté en prod : 0 ici quand le
  // vrai manque, correctement calculé dans le graphique, était de 105 055 F).
  const gapVerse = manquePole.reduce((s, p) => s + p.value, 0)

  // Charges totales déclarées = mêmes deux sources que le Point financier (Finance.jsx) :
  // les dépenses quotidiennes du gérant (SBEE + carburant propriétaire, non-cash inclus — le
  // prélèvement carburant est une vraie charge même s'il ne bouge pas de cash) + les charges
  // fixes saisies à la main dans le Point financier (loyer, salaires, impôts...). totDep (juste
  // au-dessus) reste utilisé tel quel pour « Cash non tracé », qui ne doit lui rien voir passer
  // de non-cash — ce sont deux notions de charges différentes, pas une erreur de doublon.
  const REVENU_CAT = 'AUTRES_PRODUITS'
  const totChargesAuto = polePeriod.exp.filter(e => e.categorie === 'SBEE' || e.categorie === 'CARBURANT').reduce((s, e) => s + N(e.montant), 0)
  const chargeInPeriod = (m) => year === 'all' ? true : month === 'all' ? (m || '').startsWith(year) : m === `${year}-${month}`
  const totChargesManuel = charges.filter(c => c.categorie !== REVENU_CAT && chargeInPeriod(c.mois)).reduce((s, c) => s + N(c.montant), 0)
  const totChargesDeclarees = totChargesAuto + totChargesManuel

  const chart = fm.map(m => ({ mois: m.mois.slice(2), 'Ventes bon': Math.round(N(m.ventes_bon)), 'Espèces': Math.round(N(m.recettes_especes)), 'Versé': Math.round(N(m.total_verse)) }))

  // Répartition du CA par pôle (camembert) — période sélectionnée, agrégé mensuel déjà chargé.
  const caParPole = [
    { name: 'Carburant', value: sum('ca_carburant') },
    { name: 'Gaz', value: sum('ventes_gaz') },
    { name: 'Lubrifiant', value: sum('ventes_lubrifiant') },
    { name: 'Supérette', value: sum('ventes_superette') },
  ].filter(r => r.value > 0)

  // Évolution mensuelle par pôle (bâtons empilés) — même agrégat, vue mois par mois plutôt que sommée.
  const chartPoles = fm.map(m => ({
    mois: m.mois.slice(2),
    Carburant: Math.round(N(m.ca_carburant)), Gaz: Math.round(N(m.ventes_gaz)),
    Lubrifiant: Math.round(N(m.ventes_lubrifiant)), Supérette: Math.round(N(m.ventes_superette)),
  }))

  // Répartition des dépenses par catégorie (camembert) — dépenses quotidiennes du gérant
  // (y compris le prélèvement carburant non-cash) + charges fixes du Point financier
  // (loyer, salaires, impôts...), sur la période sélectionnée. Même sources que "Charges
  // totales déclarées" ci-dessus, juste ventilées catégorie par catégorie au lieu d'un total.
  const DEP_CAT_LABELS = {
    SBEE: 'SBEE (électricité)', SUPERETTE: 'Dépenses supérette (gérant)', CARBURANT: 'Carburant (prélèvement propriétaire)', AUTRE: 'Autre',
    LOYER: 'Loyer', SALAIRES: 'Salaires', PRELEVEMENT_GERANT: 'Prélèvement gérant', IMPOTS: 'Impôts', HONORAIRES: 'Honoraires',
    PRESTATIONS: 'Prestations', PERTE_VENTE_CARBURANT: 'Perte vente carburant', SONEB: 'SONEB (eau)', TELEPHONE: 'Téléphone',
  }
  const depensesParCat = (() => {
    const totals = {}
    for (const e of polePeriod.exp) { const k = (e.categorie || 'AUTRE').toUpperCase(); totals[k] = (totals[k] || 0) + N(e.montant) }
    for (const c of charges) {
      if (c.categorie === REVENU_CAT || !chargeInPeriod(c.mois)) continue
      totals[c.categorie] = (totals[c.categorie] || 0) + N(c.montant)
    }
    return Object.entries(totals).filter(([, v]) => v > 0).map(([k, v]) => ({ name: DEP_CAT_LABELS[k] || k, value: v })).sort((a, b) => b.value - a.value)
  })()
  const DEP_CAT_COLORS = { 'SBEE (électricité)': 'var(--state-warn)', 'Carburant (prélèvement propriétaire)': 'var(--accent)' }

  // Détail par produit AU SEIN de chaque pôle (essence/gasoil, gaz par taille, articles supérette),
  // en CFA ou en unité physique selon uniteMode. Le lubrifiant n'a pas d'équivalent : seul le
  // total espèces est saisi, aucune vente par type n'est tracée nulle part — impossible à
  // ventiler (en CFA ou en unité) sans ajouter un nouveau suivi.
  const SUP_TOP_N = 6
  const topN = (rows) => {
    if (rows.length <= SUP_TOP_N) return rows
    const top = rows.slice(0, SUP_TOP_N)
    const reste = rows.slice(SUP_TOP_N).reduce((s, r) => s + r.value, 0)
    return [...top, { name: 'Autres articles', value: reste }]
  }

  const carburantMix = (uniteMode
    ? [
        { name: 'Essence', value: polePeriod.dr.reduce((s, r) => s + N(r.ess_litres), 0) },
        { name: 'Gasoil', value: polePeriod.dr.reduce((s, r) => s + N(r.gas_litres), 0) },
      ]
    : [
        { name: 'Essence', value: polePeriod.dr.reduce((s, r) => s + N(r.ess_litres) * N(r.ess_pu), 0) },
        { name: 'Gasoil', value: polePeriod.dr.reduce((s, r) => s + N(r.gas_litres) * N(r.gas_pu), 0) },
      ]).filter(r => r.value > 0)
  const CARBURANT_MIX_COLORS = { Essence: 'var(--accent)', Gasoil: 'var(--state-info)' }

  // CA gaz estimé = quantité vendue (fiable, saisie chaque jour) × prix de vente ACTUEL du produit
  // (le prix historique n'est pas conservé) — approximation si le prix a changé sur la période.
  // En unité, pas d'approximation : la quantité vendue est directement la donnée saisie.
  const gazMix = ['3 kg', '6 kg', '12 kg', '38 kg'].map(nom => {
    const qte = polePeriod.dr.reduce((s, r) => s + N(r['gaz_vendu_' + nom.replace(' kg', '')]), 0)
    return { name: nom, value: uniteMode ? qte : qte * N(gazPrices[nom]) }
  }).filter(r => r.value > 0)

  const superetteMix = (() => {
    const totals = {}
    const field = uniteMode ? 'quantite' : 'montant'
    for (const s of polePeriod.sup) { const k = s.nom || 'Autre'; totals[k] = (totals[k] || 0) + N(s[field]) }
    const rows = Object.entries(totals).filter(([, v]) => v > 0).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value)
    return topN(rows)
  })()

  // Lubrifiant par type : pas de "quantité vendue" saisie directement, mais la consommation se
  // DÉDUIT des relevés de stock successifs (v_sorties_deduites, même mécanisme que "Sorties
  // déduites" sur Stock & mouvements) — stock veille + entrées − stock jour, par référence.
  // Une valeur négative (entrée oubliée un jour donné) est ramenée à 0 plutôt que soustraite du
  // total, pour ne pas faire disparaître de la vraie consommation d'un autre jour.
  const lubrifiantMix = (() => {
    const totals = {}
    for (const r of polePeriod.lub) { totals[r.produit] = (totals[r.produit] || 0) + Math.max(0, N(r.sortie_deduite)) }
    const rows = Object.entries(totals).filter(([, v]) => v > 0).map(([k, v]) => ({ name: k, value: uniteMode ? v : v * N(lubPrices[k]) })).filter(r => r.value > 0).sort((a, b) => b.value - a.value)
    return topN(rows)
  })()

  // "Évolution mensuelle par pôle" en mode Unité : un pôle à la fois (les unités diffèrent
  // d'un pôle à l'autre, pas de sens à les empiler). Carburant a sa tendance déjà prête dans
  // l'agrégat mensuel (litres_carburant) ; gaz/supérette/lubrifiant viennent de poleUniteSeries
  // (chargé à la demande, cf. l'effet ci-dessus).
  const POLE_EVOLUTION_OPTIONS = [
    { value: 'carburant', label: 'Carburant' },
    { value: 'gaz', label: 'Gaz' },
    { value: 'superette', label: 'Supérette' },
    { value: 'lubrifiant', label: 'Lubrifiant' },
  ]
  const POLE_EVOLUTION_UNIT = { carburant: 'L', gaz: 'bout.', superette: 'unités', lubrifiant: 'unités' }
  const chartPoleUnite = (poleEvolution === 'carburant'
    ? fm.map(m => ({ mois: m.mois.slice(2), value: Math.round(N(m.litres_carburant)) }))
    : poleUniteSeries.map(r => ({ mois: r.mois.slice(2), value: Math.round(r.value) })))

  const reconColumns = [
    { key: 'mois', header: 'Mois' },
    { key: 'esp', header: 'Espèces', numeric: true, align: 'right', render: m => fcfa(N(m.recettes_especes)) },
    { key: 'ver', header: 'Versé', numeric: true, align: 'right', render: m => fcfa(N(m.total_verse)) },
    { key: 'ecart', header: 'Écart', numeric: true, align: 'right', render: m => { const ec = N(m.recettes_especes) - N(m.total_verse); return <span style={{ color: ec > 0.5 ? 'var(--state-alarm)' : 'var(--text-body)' }}>{fcfa(ec)}</span> } },
    { key: 'couv', header: 'Couv.', numeric: true, align: 'right', render: m => { const esp = N(m.recettes_especes), ver = N(m.total_verse); const cov = esp ? Math.round(100 * ver / esp) : 0; return <span style={{ color: cov >= 90 ? 'var(--state-ok)' : cov >= 60 ? 'var(--state-warn)' : 'var(--state-alarm)' }}>{cov}%</span> } },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <Panel title="Stock en temps réel & autonomie" status="accent" meta={`maj ${refreshedAt}`} actions={<Button size="sm" onClick={loadStock}>Rafraîchir</Button>}>
        {!stock ? <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Pas encore de stock saisi.</p> : (<>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>Dernière saisie : {frDate(stock.derniere_date)}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-4)' }}>
            <Kpi label="Essence en cuve" value={stock.ess_stock != null ? Math.round(stock.ess_stock) : '—'} unit={stock.ess_stock != null ? 'L' : ''} sub={forecast?.jours_essence != null ? `≈ ${forecast.jours_essence} j` : ''} status={YEAR_TONE(forecast?.jours_essence)} />
            <Kpi label="Gasoil en cuve" value={stock.gas_stock != null ? Math.round(stock.gas_stock) : '—'} unit={stock.gas_stock != null ? 'L' : ''} sub={forecast?.jours_gasoil != null ? `≈ ${forecast.jours_gasoil} j` : ''} status={YEAR_TONE(forecast?.jours_gasoil)} />
            <Kpi label="Bons en cours" value={stock.bons_restant != null ? fcfa(stock.bons_restant) : '—'}
              sub={N(stock.bons_utilises_depuis) > 0 ? `dont ${fcfa(stock.bons_utilises_depuis)} engagés en commandes` : ''}
              status={stock.bons_restant != null && stock.bons_restant < 0 ? 'alarm' : undefined} />
            <Kpi label="Bouteilles gaz" value={[stock.gaz_stock_3, stock.gaz_stock_6, stock.gaz_stock_12, stock.gaz_stock_38].reduce((a, b) => a + N(b), 0)} unit="b." />
          </div>
        </>)}
      </Panel>

      <Panel bodyStyle={{ display: 'none' }} actions={<>
        <PeriodPicker multiple={false} years={year === 'all' ? [] : [year]} months={month === 'all' ? [] : [month]}
          setYears={ys => setYear(ys[0] || 'all')} setMonths={ms => setMonth(ms[0] || 'all')} availableYears={years} />
        {(year !== 'all' || month !== 'all') && <Button size="sm" onClick={() => { setYear('all'); setMonth('all') }}>Réinitialiser</Button>}
        <Tag>{sum('jours')} jour(s)</Tag>
      </>} />

      {/* Bandeau financier principal : les 4 chiffres qui comptent le plus, tout de suite visibles. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        <Kpi label="CA total (période)" value={L(fcfa(caTotal))} sub="ventes à bon + espèces" />
        <Kpi label="Charges totales déclarées" value={L(fcfa(totChargesDeclarees))} sub="gérant (SBEE + carburant) + point financier" />
        <Kpi label="Cash non tracé" value={L(fcfa(gapVerse))} status={gapVerse > 0 ? 'alarm' : undefined} sub="recettes − dépenses − versé" />
        <Kpi label="Versé banque" value={L(fcfa(totVerse))} />
      </div>

      {/* Détail qui alimente les totaux ci-dessus. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        <Kpi label="Recettes espèces" value={L(fcfa(totCash))} sub={pctEsp != null ? `${pctEsp}% du CA` : ''} />
        <Kpi label="Ventes à bon" value={L(fcfa(totBon))} sub={pctBon != null ? `${pctBon}% du CA` : ''} />
        <Kpi label="Marge carburant" value={L(fcfa(totMarge))} sub="25 F/L" />
        <Kpi label="Livraisons / achats" value={L(fcfa(totLivr))} />
      </div>

      <div style={{ font: 'var(--fw-semibold) 14px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>
        Focus par pôle
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 380px' }}>
          <Panel title="Répartition du CA par pôle" style={{ height: '100%' }}>
            {caParPole.length ? <PoleShare data={caParPole} colors={POLE_COLORS} /> : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Pas de ventes sur la période sélectionnée.</p>}
          </Panel>
        </div>
        <div style={{ flex: '1 1 380px' }}>
          <Panel title="Répartition des dépenses par catégorie" style={{ height: '100%' }}>
            {depensesParCat.length ? <PoleShare data={depensesParCat} colors={DEP_CAT_COLORS} /> : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Pas de dépense sur la période sélectionnée.</p>}
          </Panel>
        </div>
      </div>

      <Panel title="Manque à verser par pôle" meta="période sélectionnée">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Espèces déclarées − dépenses non-cash − versé en banque, par pôle. Même calcul que « Manque à verser » sur le Journal de bord du gérant, mais sur la période choisie ci-dessus plutôt que le mois en cours.
        </p>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={manquePole} layout="vertical" margin={{ left: 24 }}>
              <XAxis type="number" fontSize={12} stroke="var(--ardoise)" tickFormatter={v => (v / 1e3).toFixed(0) + 'k'} />
              <YAxis type="category" dataKey="name" fontSize={12} stroke="var(--ardoise)" width={110} />
              <Tooltip formatter={v => fcfa(v)} contentStyle={{ background: 'var(--surface-panel)', border: 0, borderRadius: 'var(--radius-1)', boxShadow: 'var(--shadow-pop)', font: '13px var(--font-ui)' }} />
              <Bar dataKey="value">
                {manquePole.map((r, i) => <Cell key={i} fill={r.value > 0 ? 'var(--rouge)' : 'var(--vert-pump)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <div style={{ font: 'var(--fw-semibold) 14px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>
          Détail par produit, au sein de chaque pôle
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <Button size="sm" tone={!uniteMode ? 'dark' : 'neutral'} onClick={() => setUniteMode(false)}>CFA</Button>
          <Button size="sm" tone={uniteMode ? 'dark' : 'neutral'} onClick={() => setUniteMode(true)}>Unité (L, bouteilles...)</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <Panel title="Carburant — Essence vs Gasoil" style={{ height: '100%' }}>
            {carburantMix.length ? <PoleShare data={carburantMix} colors={CARBURANT_MIX_COLORS} unit={uniteMode ? 'L' : undefined} /> : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Pas de ventes carburant sur la période.</p>}
          </Panel>
        </div>
        <div style={{ flex: '1 1 320px' }}>
          <Panel title="Gaz — par taille de bouteille" style={{ height: '100%' }}>
            {gazMix.length ? <PoleShare data={gazMix} unit={uniteMode ? 'bout.' : undefined} /> : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Pas de ventes gaz sur la période.</p>}
            {!uniteMode && <p style={{ font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-3) 0 0' }}>Estimé : quantité vendue × prix de vente actuel (le prix historique n'est pas conservé).</p>}
          </Panel>
        </div>
        <div style={{ flex: '1 1 320px' }}>
          <Panel title="Supérette — par article" meta={polePeriod.sup.length ? `top ${Math.min(SUP_TOP_N, superetteMix.length)}` : undefined} style={{ height: '100%' }}>
            {superetteMix.length ? <PoleShare data={superetteMix} unit={uniteMode ? 'unités' : undefined} /> : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Pas de vente supérette détaillée sur la période (nécessite la saisie vendeuse par article).</p>}
          </Panel>
        </div>
        <div style={{ flex: '1 1 320px' }}>
          <Panel title="Lubrifiant — par type" meta={polePeriod.lub.length ? `top ${Math.min(SUP_TOP_N, lubrifiantMix.length)}` : undefined} style={{ height: '100%' }}>
            {lubrifiantMix.length ? <PoleShare data={lubrifiantMix} unit={uniteMode ? 'unités' : undefined} /> : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Pas de consommation déduite sur la période (aucun relevé de stock lubrifiant consécutif).</p>}
            <p style={{ font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-3) 0 0' }}>Déduit des relevés de stock successifs (stock veille + entrées − stock jour), pas d'une vente saisie directement.{!uniteMode ? ' Valeur estimée au prix actuel.' : ''}</p>
          </Panel>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px' }}>
          <Panel title="Évolution mensuelle" style={{ height: '100%' }}>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={chart}>
                  <XAxis dataKey="mois" fontSize={12} stroke="var(--ardoise)" />
                  <YAxis fontSize={12} stroke="var(--ardoise)" tickFormatter={v => (v / 1e6).toFixed(0) + 'M'} />
                  <Tooltip formatter={v => fcfa(v)} contentStyle={{ background: 'var(--surface-panel)', border: 0, borderRadius: 'var(--radius-1)', boxShadow: 'var(--shadow-pop)', font: '13px var(--font-ui)' }} />
                  <Legend wrapperStyle={{ font: '13px var(--font-ui)' }} />
                  <Bar dataKey="Ventes bon" fill="var(--nuit)" radius={[5, 5, 0, 0]} /><Bar dataKey="Espèces" fill="var(--sauge)" radius={[5, 5, 0, 0]} /><Bar dataKey="Versé" fill="var(--vert-pump)" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
        <div style={{ flex: '1 1 420px' }}>
          <Panel title="Évolution mensuelle par pôle" style={{ height: '100%' }}
            actions={uniteMode && <Select size="sm" value={poleEvolution} onChange={e => setPoleEvolution(e.target.value)} options={POLE_EVOLUTION_OPTIONS} />}>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                {uniteMode ? (
                  <BarChart data={chartPoleUnite}>
                    <XAxis dataKey="mois" fontSize={12} stroke="var(--ardoise)" />
                    <YAxis fontSize={12} stroke="var(--ardoise)" />
                    <Tooltip formatter={v => `${Math.round(v).toLocaleString('fr-FR')} ${POLE_EVOLUTION_UNIT[poleEvolution]}`} contentStyle={{ background: 'var(--surface-panel)', border: 0, borderRadius: 'var(--radius-1)', boxShadow: 'var(--shadow-pop)', font: '13px var(--font-ui)' }} />
                    <Bar dataKey="value" name={POLE_EVOLUTION_OPTIONS.find(o => o.value === poleEvolution)?.label} fill={POLE_COLORS[POLE_EVOLUTION_OPTIONS.find(o => o.value === poleEvolution)?.label] || 'var(--vert-pump)'} radius={[5, 5, 0, 0]} />
                  </BarChart>
                ) : (
                  <BarChart data={chartPoles}>
                    <XAxis dataKey="mois" fontSize={12} stroke="var(--ardoise)" />
                    <YAxis fontSize={12} stroke="var(--ardoise)" tickFormatter={v => (v / 1e6).toFixed(0) + 'M'} />
                    <Tooltip formatter={v => fcfa(v)} contentStyle={{ background: 'var(--surface-panel)', border: 0, borderRadius: 'var(--radius-1)', boxShadow: 'var(--shadow-pop)', font: '13px var(--font-ui)' }} />
                    <Legend wrapperStyle={{ font: '13px var(--font-ui)' }} />
                    <Bar dataKey="Carburant" stackId="pole" fill={POLE_COLORS.Carburant} />
                    <Bar dataKey="Lubrifiant" stackId="pole" fill={POLE_COLORS.Lubrifiant} />
                    <Bar dataKey="Gaz" stackId="pole" fill={POLE_COLORS.Gaz} />
                    <Bar dataKey="Supérette" stackId="pole" fill={POLE_COLORS['Supérette']} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
        {alerts.length > 0 && (
          <div style={{ flex: '1 1 320px' }}>
            <Panel title="Alertes — 60 derniers jours" meta={`${alerts.length}`} flush style={{ height: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--gutter-panel)' }}>
                {alerts.slice(0, 5).map((a, i) => {
                  const meta = ALERT_TONES[a.type] || { label: a.type, tone: 'info' }
                  return (
                    <AlertBanner key={i} tone={meta.tone} title={meta.label} timestamp={frDate(a.report_date)}
                      action={a.report_date && <Button size="sm" onClick={() => nav(`/saisie?date=${a.report_date}`)}>Traiter</Button>}>
                      {a.detail}
                    </AlertBanner>
                  )
                })}
                {alerts.length > 5 && <p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>+ {alerts.length - 5} autre(s) alerte(s) — voir Alertes.</p>}
              </div>
            </Panel>
          </div>
        )}
      </div>

      <Panel title="Réconciliation versements (par mois)" meta={`${fm.length} mois`} flush
        bodyStyle={openRecon ? undefined : { display: 'none' }}
        actions={<IconButton icon="chevron-down" size="sm" title={openRecon ? 'Masquer' : 'Afficher'}
          onClick={() => setOpenRecon(v => !v)} style={{ transform: openRecon ? 'rotate(180deg)' : 'none' }} />}>
        {fm.length
          ? <DataTable columns={reconColumns} rows={fm.map(m => ({ ...m, id: m.mois }))} />
          : <PanelEmpty icon="chart-column" label="Aucune donnée sur la période" />}
      </Panel>
    </div>
  )
}

// Camembert + légende avec montant et part (%) — utilisé pour la répartition du CA par pôle
// et la répartition des dépenses par catégorie.
function PoleShare({ data, colors = {}, unit }) {
  const total = data.reduce((s, r) => s + r.value, 0)
  const colorOf = (r, i) => colors[r.name] || SIGNAL_PALETTE[i % SIGNAL_PALETTE.length]
  const fmt = unit ? (v => `${Math.round(v).toLocaleString('fr-FR')} ${unit}`) : fcfa
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
      <div style={{ width: 160, height: 160, flex: '0 0 auto' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={78} paddingAngle={2}>
              {data.map((r, i) => <Cell key={i} fill={colorOf(r, i)} />)}
            </Pie>
            <Tooltip formatter={v => fmt(v)} contentStyle={{ background: 'var(--surface-panel)', border: 0, borderRadius: 'var(--radius-1)', boxShadow: 'var(--shadow-pop)', font: '13px var(--font-ui)' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', flex: '1 1 160px' }}>
        {data.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', font: '400 14px/1.3 var(--font-ui)' }}>
            <span style={{ color: 'var(--text-body)' }}><span style={{ color: colorOf(r, i) }}>■</span> {r.name}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fmt(r.value)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({total ? Math.round(100 * r.value / total) : 0}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}
