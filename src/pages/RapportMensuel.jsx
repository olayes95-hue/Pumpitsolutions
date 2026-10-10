import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, today, lastDayOfMonth } from '../lib/format'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { Kpi } from '../lib/Kpi.jsx'
import RapportSheet from '../components/RapportSheet.jsx'

const N = (v) => (v ? Number(v) : 0)
const REVENU_CAT = 'AUTRES_PRODUITS'
const ML = { '01': 'Janvier', '02': 'Février', '03': 'Mars', '04': 'Avril', '05': 'Mai', '06': 'Juin', '07': 'Juillet', '08': 'Août', '09': 'Septembre', '10': 'Octobre', '11': 'Novembre', '12': 'Décembre' }
const SIGNAL_PALETTE = ['var(--act-carburants)', 'var(--act-lubrifiants)', 'var(--act-gaz)', 'var(--act-superette)', 'var(--ardoise)']
const moisLabel = (ym) => ym ? `${ML[ym.slice(5, 7)]} ${ym.slice(0, 4)}` : ''
// Dernier mois civil complet (pas le mois en cours, encore ouvert) — défaut à l'ouverture.
function moisPrecedent(ym) {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export default function RapportMensuel() {
  const { stationId, current } = useStation()
  const [mois, setMois] = useState(moisPrecedent(today().slice(0, 7)))
  const [loading, setLoading] = useState(true)
  const [ventes, setVentes] = useState([])
  const [commissionReelle, setCommissionReelle] = useState([])
  const [commissionSuperette, setCommissionSuperette] = useState([])
  const [charges, setCharges] = useState([])
  const [pertes, setPertes] = useState([])
  const [stockVal, setStockVal] = useState([])
  const [latestStock, setLatestStock] = useState(null)
  const [settings, setSettings] = useState({})
  const [ouverture, setOuverture] = useState(null)
  const [commandesEnCours, setCommandesEnCours] = useState([])
  const [receptionsTotaux, setReceptionsTotaux] = useState({})
  const [compteBancaire, setCompteBancaire] = useState(null)
  const [expensesMois, setExpensesMois] = useState([])
  const [reconMois, setReconMois] = useState([])
  const [alertesMois, setAlertesMois] = useState([])
  const [imprimer, setImprimer] = useState(false)

  useEffect(() => {
    if (!stationId || !mois) return
    setLoading(true)
    const from = `${mois}-01`, to = lastDayOfMonth(mois)
    Promise.all([
      supabase.from('v_ventes_mensuelles').select('*').eq('station_id', stationId).order('mois'),
      supabase.from('v_commission_reelle_mensuelle').select('*').eq('station_id', stationId),
      supabase.from('v_commission_superette_mensuelle').select('*').eq('station_id', stationId),
      supabase.from('charges').select('*').eq('station_id', stationId),
      supabase.from('v_pertes_mensuelles').select('*').eq('station_id', stationId),
      supabase.from('v_stock_valeur').select('*').eq('station_id', stationId),
      supabase.from('v_latest_stock').select('bons_restant,ess_stock,gas_stock').eq('station_id', stationId).maybeSingle(),
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('finance_soldes_ouverture').select('*').eq('station_id', stationId).maybeSingle(),
      supabase.from('fuel_orders').select('*').eq('station_id', stationId).in('statut', ['lancee', 'partielle']),
      supabase.from('v_order_reception').select('*').eq('station_id', stationId),
      supabase.from('v_compte_bancaire').select('*').eq('station_id', stationId).maybeSingle(),
      supabase.from('expenses').select('categorie,montant,non_cash').eq('station_id', stationId).gte('report_date', from).lte('report_date', to),
      supabase.from('v_pole_recon_jour').select('*').eq('station_id', stationId).gte('report_date', from).lte('report_date', to).order('report_date', { ascending: false }).limit(5000),
      supabase.from('v_alerts').select('type,gravite').eq('station_id', stationId).gte('report_date', from).lte('report_date', to),
    ]).then(([v, cr, cs, c, p, sv, ls, st, ou, co, rt, cb, exp, recon, al]) => {
      setVentes(v.data || []); setCommissionReelle(cr.data || []); setCommissionSuperette(cs.data || [])
      setCharges(c.data || []); setPertes(p.data || []); setStockVal(sv.data || [])
      setLatestStock(ls.data || null); setSettings(st.data || {}); setOuverture(ou.data || null)
      setCommandesEnCours(co.data || [])
      const rtm = {}; for (const x of (rt.data || [])) rtm[x.order_id] = N(x.quantite_recue_total); setReceptionsTotaux(rtm)
      setCompteBancaire(cb.data || null); setExpensesMois(exp.data || []); setReconMois(recon.data || []); setAlertesMois(al.data || [])
      setLoading(false)
    })
  }, [stationId, mois])

  const r = useMemo(() => {
    if (!mois) return null
    const inPeriod = (m) => m === mois
    const V = ventes.filter(v => inPeriod(v.mois))
    const sum = (k) => V.reduce((s, v) => s + N(v[k]), 0)
    const commCarb = sum('commission_carburant')
    const CR = commissionReelle.filter(c => inPeriod(c.mois))
    const commGazLub = CR.reduce((s, c) => s + N(c.commission_gaz) + N(c.commission_lubrifiant), 0)
    const commSuperette = settings.superette_commission_reelle
      ? commissionSuperette.filter(c => inPeriod(c.mois)).reduce((s, c) => s + N(c.commission_superette), 0)
      : sum('ventes_superette') * N(settings.taux_superette) / 100

    const chP = charges.filter(c => inPeriod(c.mois))
    const autresProduits = chP.filter(c => c.categorie === REVENU_CAT).reduce((s, c) => s + N(c.montant), 0)
    const totManuel = chP.filter(c => c.categorie !== REVENU_CAT).reduce((s, c) => s + N(c.montant), 0)
    const chargesAPayer = chP.filter(c => c.categorie !== REVENU_CAT && c.statut !== 'paye').reduce((s, c) => s + N(c.montant), 0)

    const autoCharges = expensesMois.filter(e => e.categorie === 'SBEE' || e.categorie === 'CARBURANT').reduce((s, e) => s + N(e.montant), 0)

    const pertesP = pertes.filter(p => inPeriod(p.mois))
    const perteMontant = pertesP.reduce((s, p) => s + N(p.perte_montant), 0)

    const totCharges = autoCharges + totManuel + perteMontant
    const produits = commCarb + commGazLub + commSuperette + autresProduits
    const resultat = produits - totCharges

    // Manque à verser (même construction que Dashboard.jsx) : par pôle via v_pole_recon_jour,
    // en déduisant les dépenses générales/supérette payées depuis la caisse carburant.
    const manqueByPole = { carburant: 0, gaz_lub: 0, superette: 0 }
    for (const g of reconMois) {
      if (!(g.pole_groupe in manqueByPole)) continue
      if (N(g.nb_cloture) > 0 && g.recette_cloture != null) manqueByPole[g.pole_groupe] += N(g.recette_cloture) - N(g.verse)
      else if (!g.couvert) manqueByPole[g.pole_groupe] += N(g.espece)
    }
    let depSuperette = 0, depGeneral = 0
    for (const e of expensesMois) {
      if (e.non_cash) continue
      if (e.categorie === 'SUPERETTE') depSuperette += N(e.montant)
      else if (e.categorie !== 'CARBURANT') depGeneral += N(e.montant)
    }
    const gapVerse = (manqueByPole.carburant - depGeneral) + manqueByPole.gaz_lub + (manqueByPole.superette - depSuperette)
    const resultatAjuste = resultat - gapVerse

    // Bilan simplifié cumulé à la fin du mois sélectionné — même construction que Finance.jsx.
    const periodeFinBilan = mois
    const ouvertureActive = ouverture && ouverture.date_ouverture.slice(0, 7) <= periodeFinBilan
    const ouvertureMoisDebut = ouvertureActive ? ouverture.date_ouverture.slice(0, 7) : null
    const ouvertureMontant = ouvertureActive ? N(ouverture.montant) : 0
    const cashCumule = ventes.filter(v => v.mois <= periodeFinBilan && (!ouvertureMoisDebut || v.mois >= ouvertureMoisDebut))
      .reduce((s, v) => s + N(v.recettes_especes) - N(v.total_depense) - N(v.total_verse), 0)
    const chargesAPayerCumule = charges.filter(c => c.categorie !== REVENU_CAT && c.statut !== 'paye' && c.mois <= periodeFinBilan && (!ouvertureMoisDebut || c.mois >= ouvertureMoisDebut))
      .reduce((s, c) => s + N(c.montant), 0)
    const stockTotal = stockVal.reduce((s, v) => s + N(v.valeur), 0)
    const stockCarburant = N(latestStock?.ess_stock) * N(settings.essence_pa || 705) + N(latestStock?.gas_stock) * N(settings.gasoil_pa || 730)
    const commandesEnCoursValeur = commandesEnCours.reduce((s, o) => {
      const commande = N(o.quantite_commandee)
      if (commande <= 0) return s
      const deja = N(receptionsTotaux[o.id])
      const reste = Math.max(commande - deja, 0)
      const montantTotal = (o.categorie || 'carburant') === 'carburant' ? N(o.bons_base) + N(o.cheque_montant) : N(o.montant_paiement)
      return s + montantTotal * (reste / commande)
    }, 0)
    const bonsRestant = N(latestStock?.bons_restant)
    const soldeBancaireActuel = N(compteBancaire?.solde_actuel)
    const totalActif = stockTotal + stockCarburant + commandesEnCoursValeur + bonsRestant + cashCumule + ouvertureMontant + soldeBancaireActuel
    const totalPassif = chargesAPayerCumule
    const situationNette = totalActif - totalPassif

    const alertesHaute = alertesMois.filter(a => a.gravite === 'haute').length

    // Répartition du CA par pôle (pour l'écran et le résumé — pas de camembert dans le PDF,
    // juste des chiffres, pour rester fiable à l'impression).
    const repartitionCA = [
      { name: 'Carburant', value: commCarb },
      { name: 'Gaz + Lubrifiant', value: commGazLub },
      { name: 'Supérette', value: commSuperette },
    ].filter(p => p.value > 0)

    // Résumé en clair + conseils, adapté de Finance.jsx:genererResume — ajoute le manque à
    // verser comme charge et comme conseil dédié.
    const resume = []
    const label = moisLabel(mois)
    if (resultat > 0) resume.push(`La station a fait un bénéfice de ${fcfa(resultat)} en ${label}.`)
    else if (resultat < 0) resume.push(`La station est en perte de ${fcfa(Math.abs(resultat))} en ${label}.`)
    else resume.push(`La station est à l'équilibre en ${label} : ni gain ni perte.`)
    if (gapVerse > 0) resume.push(`En comptant le manque à verser (${fcfa(gapVerse)}) comme une charge, le résultat ajusté tombe à ${fcfa(resultatAjuste)}.`)
    const polesTriees = [...repartitionCA].sort((a, b) => b.value - a.value)
    if (polesTriees[0]) resume.push(`La plus grosse partie des revenus vient de ${polesTriees[0].name} (${fcfa(polesTriees[0].value)}).`)
    if (totCharges > 0) resume.push(`Les charges du mois s'élèvent à ${fcfa(totCharges)}.`)
    if (perteMontant > 1000) resume.push(`Sur ce total, ${fcfa(perteMontant)} viennent de carburant manquant à la livraison (pertes).`)
    if (chargesAPayer > 0) resume.push(`Il reste ${fcfa(chargesAPayer)} de charges pas encore payées.`)
    if (alertesHaute > 0) resume.push(`${alertesHaute} alerte(s) de gravité haute ont été détectées ce mois.`)

    const conseils = []
    if (gapVerse > 0) conseils.push(`relancer le recouvrement du manque à verser (${fcfa(gapVerse)}) auprès du gérant — c'est de l'argent dû à la station, pas encore remis`)
    if (resultat < 0) conseils.push('réduire les charges ou augmenter les ventes pour repasser en bénéfice')
    if (perteMontant > 1000) conseils.push('vérifier avec le gérant pourquoi les livraisons de carburant arrivent incomplètes — ça coûte cher')
    if (chargesAPayer > 0) conseils.push('prévoir de régler les charges fixes encore impayées')
    if (alertesHaute > 0) conseils.push('traiter les alertes de gravité haute du mois (voir la page Alertes)')
    if (!conseils.length) conseils.push("Rien d'alarmant : continue sur cette lancée le mois prochain.")

    return {
      moisLabel: label, genereLe: today(), bilanAu: periodeFinBilan,
      commCarb, commGazLub, commSuperette, autresProduits, produits,
      autoCharges, perteMontant, totManuel, totCharges, resultat,
      gapVerse, resultatAjuste, chargesAPayer,
      stockTotal, stockCarburant, commandesEnCoursValeur, bonsRestant, cashCumule,
      totalActif, totalPassif, situationNette, chargesAPayerCumule,
      repartitionCA, resume, conseils, alertesHaute, alertesTotal: alertesMois.length,
    }
  }, [mois, ventes, commissionReelle, commissionSuperette, charges, pertes, stockVal, latestStock, settings, ouverture, commandesEnCours, receptionsTotaux, compteBancaire, expensesMois, reconMois, alertesMois])

  if (loading || !r) return <Panel><p style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Chargement…</p></Panel>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <Panel title="Rapport mensuel" meta={r.moisLabel} actions={<>
        <Field label="Mois" style={{ marginBottom: 0 }}><Input type="month" value={mois} max={moisPrecedent(today().slice(0, 7))} onChange={e => e.target.value && setMois(e.target.value)} /></Field>
        <Button tone="primary" onClick={() => setImprimer(true)}>Exporter en PDF</Button>
      </>} bodyStyle={{ display: 'none' }} />

      <Panel title="En clair" meta={r.moisLabel} status={r.resultatAjuste < 0 ? 'alarm' : 'ok'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {r.resume.map((p, i) => <p key={i} style={{ font: '400 15px/1.5 var(--font-ui)', color: 'var(--text-body)', margin: 0 }}>{p}</p>)}
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        <Kpi label="Produits" value={fcfa(r.produits)} />
        <Kpi label="Charges" value={fcfa(r.totCharges)} />
        <Kpi label="Résultat" value={fcfa(r.resultat)} status={r.resultat < 0 ? 'alarm' : 'ok'} />
        <Kpi label="Manque à verser" value={fcfa(r.gapVerse)} status={r.gapVerse > 0 ? 'warn' : 'ok'} />
        <Kpi label="Résultat ajusté" value={fcfa(r.resultatAjuste)} status={r.resultatAjuste < 0 ? 'alarm' : 'ok'} sub="résultat − manque à verser" />
        <Kpi label="Situation nette" value={fcfa(r.situationNette)} status={r.situationNette < 0 ? 'alarm' : 'ok'} sub={`au ${r.bilanAu}`} />
      </div>

      <Panel title="Compte de résultat" meta={r.moisLabel}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          <LedgerRow label="Commission carburant" value={fcfa(r.commCarb)} />
          <LedgerRow label="Commission gaz + lubrifiant" value={fcfa(r.commGazLub)} />
          <LedgerRow label="Commission supérette" value={fcfa(r.commSuperette)} />
          {r.autresProduits > 0 && <LedgerRow label="Autres produits" value={fcfa(r.autresProduits)} />}
          <LedgerRow label="SBEE + carburant/déplacement (auto)" value={fcfa(r.autoCharges)} />
          {r.perteMontant > 0 && <LedgerRow label="Pertes livraison (auto)" value={fcfa(r.perteMontant)} />}
          <LedgerRow label="Charges fixes" value={fcfa(r.totManuel)} />
          <LedgerRow label="Manque à verser (compté comme charge ici)" value={fcfa(r.gapVerse)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--sp-3)', borderTop: '2px solid var(--border-default)', font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)' }}>
            <span>RÉSULTAT AJUSTÉ</span><span style={{ color: r.resultatAjuste < 0 ? 'var(--state-alarm)' : 'var(--state-ok)' }}>{fcfa(r.resultatAjuste)}</span>
          </div>
        </div>
      </Panel>

      {r.repartitionCA.length > 0 && (
        <Panel title="Répartition du CA par pôle" meta={r.moisLabel}>
          <PoleShare data={r.repartitionCA} />
        </Panel>
      )}

      <Panel title="Bilan simplifié" meta={`au ${r.bilanAu}`}>
        <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            <LedgerHead>Actif</LedgerHead>
            <LedgerRow label="Stock carburant (cuves)" value={fcfa(r.stockCarburant)} />
            <LedgerRow label="Stock gaz + lubrifiant + supérette" value={fcfa(r.stockTotal)} />
            <LedgerRow label="Bons en cours (créance)" value={fcfa(r.bonsRestant)} />
            <LedgerRow label="Cash non encore versé (cumulé)" value={fcfa(r.cashCumule)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 'var(--sp-5)', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--border-hairline)', font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)' }}>
              <span>Total actif</span><span>{fcfa(r.totalActif)}</span>
            </div>
          </div>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            <LedgerHead>Passif</LedgerHead>
            <LedgerRow label="Charges à payer (cumulées)" value={fcfa(r.chargesAPayerCumule)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)', borderTop: '2px solid var(--border-default)', font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)' }}>
              <span>Situation nette</span><span style={{ color: r.situationNette < 0 ? 'var(--state-alarm)' : 'var(--state-ok)' }}>{fcfa(r.situationNette)}</span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Recommandations" meta={r.moisLabel}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {r.conseils.map((c, i) => <AlertBanner key={i} tone={i === 0 && r.gapVerse > 0 ? 'warn' : 'info'}>{c}</AlertBanner>)}
        </div>
      </Panel>

      {imprimer && <RapportSheet rapport={r} station={current} onDone={() => setImprimer(false)} />}
    </div>
  )
}

function LedgerHead({ children }) {
  return <div style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>{children}</div>
}
function LedgerRow({ label, value }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 'var(--sp-5)', font: '400 15px/1.3 var(--font-ui)', color: 'var(--text-body)' }}>
    <span>{label}</span><span style={{ font: '500 15px/1.25 var(--font-data)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
  </div>
}
function PoleShare({ data }) {
  const total = data.reduce((s, r) => s + r.value, 0)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
      <div style={{ width: 160, height: 160, flex: '0 0 auto' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={78} paddingAngle={2}>
              {data.map((p, i) => <Cell key={i} fill={SIGNAL_PALETTE[i % SIGNAL_PALETTE.length]} />)}
            </Pie>
            <Tooltip formatter={v => fcfa(v)} contentStyle={{ background: 'var(--surface-panel)', border: 0, borderRadius: 'var(--radius-1)', boxShadow: 'var(--shadow-pop)', font: '13px var(--font-ui)' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', flex: '1 1 160px' }}>
        {data.map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', font: '400 14px/1.3 var(--font-ui)' }}>
            <span style={{ color: 'var(--text-body)' }}><span style={{ color: SIGNAL_PALETTE[i % SIGNAL_PALETTE.length] }}>■</span> {p.name}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fcfa(p.value)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({total ? Math.round(100 * p.value / total) : 0}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}
