import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOffre } from '../lib/offre.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'

const N = (v) => (v ? Number(v) : 0)
const YEAR_COLOR = (d) => d == null ? 'var(--text-primary)' : d < 3 ? 'var(--state-alarm)' : d < 6 ? 'var(--state-warn)' : 'var(--state-ok)'

// Prévision de commande — toutes activités, un seul endroit (plus éclaté entre Tableau de
// bord et Stock). Gardée par view_prevision (qui peut l'ouvrir) ET la fonction "prevision" de
// l'offre de la station (ce que l'offre inclut) — les deux sont vérifiées au niveau de la route.
export default function Prevision() {
  const { stationId, current } = useStation()
  const { activite } = useOffre()
  const [tab, setTab] = useState('carburant')
  const [reorderCarburant, setReorderCarburant] = useState([])
  const [enCoursRestant, setEnCoursRestant] = useState({})   // {"categorie|produit": litres/unités déjà en commande, pas encore reçus}
  const [paPrix, setPaPrix] = useState({ essence_pa: 0, gasoil_pa: 0 })
  const [soldeBancaire, setSoldeBancaire] = useState(0)
  const [bonsRestant, setBonsRestant] = useState(0)
  const [reorderProduit, setReorderProduit] = useState([])

  const TABS = [
    activite('carburant') && { value: 'carburant', label: 'Carburant' },
    activite('gaz') && { value: 'gaz', label: 'Gaz' },
    activite('lubrifiant') && { value: 'lubrifiant', label: 'Lubrifiant' },
  ].filter(Boolean)
  useEffect(() => { if (TABS.length && !TABS.some(t => t.value === tab)) setTab(TABS[0].value) }, [TABS.map(t => t.value).join(',')])

  useEffect(() => {
    if (!stationId) return
    ;(async () => {
      const [ro, fo, orc, st, cb, ls, rp] = await Promise.all([
        supabase.from('v_reorder').select('*').eq('station_id', stationId),
        // Commandes en cours, toutes catégories (ni reçues ni refusées) — pour ne pas suggérer
        // de recommander ce qui est déjà en route (voir enCoursRestant plus bas).
        supabase.from('fuel_orders').select('id').eq('station_id', stationId).in('statut', ['proposee', 'validee', 'lancee', 'partielle']),
        supabase.from('v_order_reception').select('order_id,categorie,produit,reste').eq('station_id', stationId),
        supabase.from('settings').select('essence_pa,gasoil_pa').eq('id', 1).maybeSingle(),
        // Financement disponible pour commander : bons restants + solde bancaire suivi
        // (Point financier → Compte bancaire).
        supabase.from('v_compte_bancaire').select('solde_actuel').eq('station_id', stationId).maybeSingle(),
        supabase.from('v_latest_stock').select('bons_restant').eq('station_id', stationId).maybeSingle(),
        supabase.from('v_reorder_produit').select('*').eq('station_id', stationId),
      ])
      setReorderCarburant(ro.data || [])
      const idsEnCours = new Set((fo.data || []).map(o => o.id))
      const ec = {}
      for (const r of (orc.data || [])) if (idsEnCours.has(r.order_id)) {
        const k = `${r.categorie}|${r.produit}`
        ec[k] = (ec[k] || 0) + N(r.reste)
      }
      setEnCoursRestant(ec)
      setPaPrix(st.data || { essence_pa: 0, gasoil_pa: 0 })
      setSoldeBancaire(N(cb.data?.solde_actuel))
      setBonsRestant(N(ls.data?.bons_restant))
      setReorderProduit(rp.data || [])
    })()
  }, [stationId])

  // ===== Carburant : min/max (voir Dashboard.jsx historique), arrondi au millier, financement =====
  const capaciteEssence = N(current?.capacite_essence) || 20000
  const capaciteGasoil = N(current?.capacite_gasoil) || 20000
  const qteMinMax = (r) => {
    if (r.stock == null) return null
    const capacite = r.produit === 'essence' ? capaciteEssence : capaciteGasoil
    const dejaEnCours = N(enCoursRestant[`carburant|${r.produit}`])
    const stockALivraison = Math.max(0, N(r.stock) - N(r.conso_jour) * N(r.lead)) + dejaEnCours
    const min = Math.max(0, Math.ceil((N(r.seuil_commande_litres) - stockALivraison) / 1000) * 1000)
    const max = Math.max(0, Math.floor((capacite - N(r.stock) - dejaEnCours) / 1000) * 1000)
    return { min: Math.min(min, max), max }
  }
  const besoin = (r) => {
    const urgent = r.jours_restant != null && r.conso_jour > 0 && r.jours_restant <= (N(r.lead) + N(r.secu))
    const q = qteMinMax(r)
    return urgent && !!q && q.min > 0
  }
  const paCarburant = (produit) => produit === 'gasoil' ? N(paPrix.gasoil_pa) : N(paPrix.essence_pa)

  // ===== Gaz / lubrifiant : même principe que carburant — net de ce qui est déjà en commande,
  // "complément" plutôt que masqué quand une commande en cours ne suffit pas. Pas de "max" ici
  // (pas de capacité de stockage suivie pour les bouteilles/bidons, contrairement à la cuve).
  const qteNetteProduit = (r) => Math.max(0, Math.round(N(r.quantite_a_commander) - N(enCoursRestant[`${r.categorie}|${r.produit}`])))
  const besoinProduit = (r) => qteNetteProduit(r) > 0

  // Financement partagé (bons + solde bancaire) entre TOUS les pôles — carburant, gaz, lubrifiant.
  const coutBesoinCarburant = reorderCarburant.filter(besoin).reduce((s, r) => s + (qteMinMax(r)?.min || 0) * paCarburant(r.produit), 0)
  const coutBesoinProduit = reorderProduit.filter(besoinProduit).reduce((s, r) => s + qteNetteProduit(r) * N(r.prix_achat), 0)
  const coutBesoinTotal = coutBesoinCarburant + coutBesoinProduit
  const financementDisponible = bonsRestant + soldeBancaire
  const manqueFinancement = Math.max(0, Math.round(coutBesoinTotal - financementDisponible))

  const carburantColumns = [
    { key: 'produit', header: 'Produit', render: r => <span style={{ textTransform: 'capitalize' }}>{r.produit}</span> },
    { key: 'stock', header: 'Stock', numeric: true, align: 'right', render: r => r.stock != null ? Math.round(r.stock).toLocaleString('fr-FR') + ' L' : '—' },
    { key: 'conso_jour', header: 'Conso/j', numeric: true, align: 'right', render: r => r.conso_jour ? Math.round(r.conso_jour).toLocaleString('fr-FR') + ' L' : '—' },
    { key: 'jours_restant', header: 'Autonomie', numeric: true, align: 'right', render: r => <span style={{ color: YEAR_COLOR(r.jours_restant) }}>{r.jours_restant != null ? `≈ ${r.jours_restant} j` : '—'}</span> },
    { key: 'lead', header: 'Délai livr.', numeric: true, align: 'right', render: r => <>{r.lead != null ? `${r.lead} j` : '—'}{N(r.nb_delai) > 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 10 }}> ({N(r.nb_delai)})</span> : <span style={{ color: 'var(--text-muted)', fontSize: 10 }}> déf.</span>}</> },
    { key: 'commander', header: 'Commander le', render: r => {
      if (besoin(r)) return <b style={{ color: 'var(--state-alarm)' }}>maintenant{r.commande_en_cours ? ' (complément)' : ''}</b>
      if (r.commande_en_cours) return <span style={{ color: 'var(--text-muted)' }}>commande en cours</span>
      return r.date_commande_conseillee ? frDate(r.date_commande_conseillee) : '—'
    } },
    { key: 'rupture', header: 'Rupture estimée', muted: true, render: r => r.date_rupture_estimee ? frDate(r.date_rupture_estimee) : '—' },
    { key: 'qte', header: 'Qté à commander (min – max)', numeric: true, align: 'right', render: r => {
      const q = qteMinMax(r)
      if (!q) return '—'
      return <b>{q.min.toLocaleString('fr-FR')} – {q.max.toLocaleString('fr-FR')} L</b>
    } },
    { key: 'action', header: 'Action', render: r => {
      if (besoin(r)) return <Badge tone="alarm">Commander{r.commande_en_cours ? ' un complément' : ''}{r.manque_a_gagner_estime > 0 ? ` (−${Math.round(r.manque_a_gagner_estime).toLocaleString('fr-FR')} F)` : ''}</Badge>
      if (r.commande_en_cours) return <Badge tone="info" title="Une commande est déjà proposée/validée/lancée pour ce produit, et couvre le besoin">Commande en cours</Badge>
      return <span style={{ color: 'var(--state-ok)' }}>ok</span>
    } },
  ]

  // ===== Gaz / lubrifiant : v_reorder_produit, quantité nette de ce qui est déjà en commande =====
  const produitColumns = [
    { key: 'produit', header: 'Produit' },
    { key: 'stock_theorique_actuel', header: 'Stock', numeric: true, align: 'right', render: r => N(r.stock_theorique_actuel) },
    { key: 'conso_moy_jour', header: 'Conso/jour', numeric: true, align: 'right', muted: true, render: r => (Number(r.conso_moy_jour) || 0).toFixed(1) },
    { key: 'stock_cible', header: 'Cible', numeric: true, align: 'right', muted: true, render: r => N(r.stock_cible) },
    { key: 'quantite_a_commander', header: 'À commander', numeric: true, align: 'right', render: r => {
      const q = qteNetteProduit(r)
      if (q <= 0) return r.commande_en_cours ? <Badge tone="info" title="Une commande en cours couvre le besoin">Couvert par la commande en cours</Badge> : <span style={{ color: 'var(--state-ok)' }}>—</span>
      const cartons = N(r.conditionnement_qte) > 0 ? Math.ceil(q / N(r.conditionnement_qte)) : null
      return <span style={{ fontWeight: 600, color: 'var(--state-alarm)' }}>{q} {cartons != null ? `(${cartons} ${r.conditionnement_nom || 'carton'}(s)) ` : ''}{r.commande_en_cours ? '— complément' : ''}</span>
    } },
    { key: 'cout_estimatif', header: 'Coût estimé', numeric: true, align: 'right', muted: true, render: r => { const q = qteNetteProduit(r); return q > 0 ? fcfa(q * N(r.prix_achat)) : '—' } },
  ]

  if (!TABS.length) return <PanelEmpty icon="truck" label="Aucune activité avec prévision de commande sur cette station." />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {manqueFinancement > 0 && (
        <AlertBanner tone="warn" title="Alerte prévisionnelle — financement insuffisant">
          Pour commander ce qu'il faut maintenant, tous pôles confondus (≈ {Math.round(coutBesoinTotal).toLocaleString('fr-FR')} F), les bons restants et le solde bancaire suivi ne couvrent que {Math.round(financementDisponible).toLocaleString('fr-FR')} F.
          Il manque <b>{manqueFinancement.toLocaleString('fr-FR')} F</b> — pensez à verser ce montant en banque avant de passer commande.
        </AlertBanner>
      )}

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'carburant' && (
        <Panel title="Prévision de commande carburant" status={reorderCarburant.some(besoin) ? 'alarm' : 'ok'} flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            Quand commander pour ne jamais tomber en rupture (rupture = ventes perdues), et combien de litres : un <b>minimum</b> (pour revenir au seuil de sécurité une fois cette livraison arrivée) et un <b>maximum</b> (ce que la cuve peut recevoir sans déborder) — en tenant compte de ce qui est déjà en commande, et arrondi au millier (les commandes se passent par multiples de 1000 L). Calcul de la date : autonomie − délai de livraison − marge de sécurité. Le <b>délai</b> est calculé automatiquement sur l'historique des commandes (lancement → réception).
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            {reorderCarburant.length
              ? <DataTable columns={carburantColumns} rows={reorderCarburant.map(r => ({ ...r, id: r.produit }))} />
              : <PanelEmpty icon="fuel" label="Pas encore assez de données (stock, consommation) pour une prévision." />}
          </div>
        </Panel>
      )}

      {(tab === 'gaz' || tab === 'lubrifiant') && (() => {
        const rows = reorderProduit.filter(r => r.categorie === tab)
        return (
          <Panel title={`Prévision de commande — ${tab === 'gaz' ? 'Gaz' : 'Lubrifiant'}`} status={rows.some(besoinProduit) ? 'alarm' : 'ok'} flush>
            <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
              Cible = seuil ou consommation moyenne × (délai livraison + jours de sécurité), selon le plus élevé — net de ce qui est déjà en commande (une commande en cours insuffisante reste signalée comme "complément"). Le nombre de cartons est calculé automatiquement.
            </p>
            <div style={{ marginTop: 'var(--sp-4)' }}>
              {rows.length
                ? <DataTable columns={produitColumns} rows={rows.map((r, i) => ({ ...r, id: i }))} />
                : <PanelEmpty icon="package" label="Pas encore assez de données pour une prévision." />}
            </div>
          </Panel>
        )
      })()}
    </div>
  )
}
