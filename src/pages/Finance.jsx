import { useEffect, useMemo, useState } from 'react'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { PhotoLink } from '../lib/photos.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, today } from '../lib/format'
import { uploadEvidence } from '../lib/image'
import { exportRowsToCsv } from '../lib/csv'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { IconButton } from '../ds/pumpit/components/core/IconButton.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { PeriodPicker } from '../ds/pumpit/components/forms/PeriodPicker.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { EvidenceUpload } from '../ds/pumpit/components/evidence/EvidenceUpload.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const TABS = [
  { value: 'apercu', label: 'Vue d’ensemble' },
  { value: 'controles', label: 'Contrôles' },
  { value: 'tresorerie', label: 'Trésorerie' },
  { value: 'charges', label: 'Charges fixes' },
]

const N = (v) => (v ? Number(v) : 0)
// charges saisies à la main (les récurrentes se reportent d'un mois sur l'autre)
// FRAIS_BANCAIRE : alimentée automatiquement depuis Rapprochement (bouton "Mettre à jour Point
// financier", voir BankRecon.jsx) — reste modifiable à la main comme les autres si besoin.
const MANUAL_CATS = ['LOYER','SALAIRES','PRELEVEMENT_GERANT','IMPOTS','HONORAIRES','PRESTATIONS','PERTE_VENTE_CARBURANT','SONEB','TELEPHONE','ABONNEMENT_PUMPIT','FRAIS_BANCAIRE','AUTRE']
const REVENU_CAT = 'AUTRES_PRODUITS'
const CAT_OPTIONS = [...MANUAL_CATS.map(c => ({ value: c, label: c.replace(/_/g, ' ') })), { value: REVENU_CAT, label: '+ AUTRES PRODUITS (revenu)' }]
const STATUT_OPTIONS = [{ value: 'a_payer', label: 'À payer' }, { value: 'paye', label: 'Payé' }]
const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12']
const ML = { '01':'Janv','02':'Févr','03':'Mars','04':'Avril','05':'Mai','06':'Juin','07':'Juil','08':'Août','09':'Sept','10':'Oct','11':'Nov','12':'Déc' }
const blankCharge = () => ({ categorie: 'LOYER', montant: '', note: '', statut: 'a_payer', date_paiement: '', code_comptable: '', photo_path: null })

export default function Finance() {
  const { session, can } = useAuth()
  const { stationId } = useStation()
  const [ventes, setVentes] = useState([])
  const [commissionReelle, setCommissionReelle] = useState([])   // v_commission_reelle_mensuelle — quantité vendue × (prix vente − prix achat), gaz + lubrifiant
  const [charges, setCharges] = useState([])
  const [expenses, setExpenses] = useState([])
  const [pertes, setPertes] = useState([])
  const [stockVal, setStockVal] = useState([])
  const [bonsRestant, setBonsRestant] = useState(0)
  const [stockCuve, setStockCuve] = useState({ ess_stock: 0, gas_stock: 0 })
  const [commandesEnCours, setCommandesEnCours] = useState([])   // fuel_orders lancée/partielle
  const [receptionsTotaux, setReceptionsTotaux] = useState({})  // {order_id: quantite_recue_total}
  const [settings, setSettings] = useState({ taux_gaz: 8, taux_superette: 8 })
  const [profiles, setProfiles] = useState({})     // {id: full_name} — traçabilité
  const [locked, setLocked] = useState(new Set())  // mois verrouillés ('YYYY-MM')
  const [ouverture, setOuverture] = useState(null) // {montant, date_ouverture, note} — solde avant le suivi app
  const [editOuverture, setEditOuverture] = useState(false)
  const [ouvertureForm, setOuvertureForm] = useState({ montant: '', date_ouverture: '', note: '' })
  const [bonsRecon, setBonsRecon] = useState({})   // {mois: {montant_direction, note}} — relevé direction par mois
  const [editBonRecon, setEditBonRecon] = useState(false)
  const [bonReconForm, setBonReconForm] = useState({ montant_direction: '', note: '' })
  const [compteBancaire, setCompteBancaire] = useState(null)   // v_compte_bancaire (solde courant)
  const [soldeBanque, setSoldeBanque] = useState(null)         // compte_bancaire_solde_initial
  const [editSoldeBanque, setEditSoldeBanque] = useState(false)
  const [soldeBanqueForm, setSoldeBanqueForm] = useState({ montant: '', date_solde: '', note: '' })
  const [mouvementsBanque, setMouvementsBanque] = useState([])
  const [openAnnuel, setOpenAnnuel] = useState(false)
  // Par défaut, mois en cours (pas le dernier mois avec des données, qui peut être ancien).
  const [annee, setAnnee] = useState(today().slice(0, 4))
  const [mois, setMois] = useState(today().slice(0, 7))
  const [nc, setNc] = useState(blankCharge())
  const [ncPhotoBusy, setNcPhotoBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [tab, setTab] = useState('apercu')

  async function load() {
    if (!stationId) return
    const [v, c, e, st, p, sv, ls, pr, fv, ou, br, co, rt, cb, sb, mb, cr] = await Promise.all([
      supabase.from('v_ventes_mensuelles').select('*').eq('station_id', stationId).order('mois'),
      supabase.from('charges').select('*').eq('station_id', stationId),
      supabase.from('expenses').select('report_date,categorie,montant').eq('station_id', stationId),
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('v_pertes_mensuelles').select('*').eq('station_id', stationId),
      supabase.from('v_stock_valeur').select('*').eq('station_id', stationId),
      supabase.from('v_latest_stock').select('bons_restant,ess_stock,gas_stock').eq('station_id', stationId).maybeSingle(),
      supabase.from('profiles').select('id,full_name'),
      supabase.from('finance_periodes_verrouillees').select('mois').eq('station_id', stationId),
      supabase.from('finance_soldes_ouverture').select('*').eq('station_id', stationId).maybeSingle(),
      supabase.from('finance_bons_reconciliation').select('*').eq('station_id', stationId),
      supabase.from('fuel_orders').select('*').eq('station_id', stationId).in('statut', ['lancee', 'partielle']),
      supabase.from('v_order_reception').select('*').eq('station_id', stationId),
      supabase.from('v_compte_bancaire').select('*').eq('station_id', stationId).maybeSingle(),
      supabase.from('compte_bancaire_solde_initial').select('*').eq('station_id', stationId).maybeSingle(),
      supabase.from('compte_bancaire_mouvements').select('*').eq('station_id', stationId).order('date_mouvement', { ascending: false }),
      supabase.from('v_commission_reelle_mensuelle').select('*').eq('station_id', stationId),
    ])
    setVentes(v.data || []); setCharges(c.data || []); setExpenses(e.data || []); setCommissionReelle(cr.data || [])
    if (st.data) setSettings(st.data)
    setPertes(p.data || []); setStockVal(sv.data || [])
    setBonsRestant(N(ls.data?.bons_restant))
    setStockCuve({ ess_stock: N(ls.data?.ess_stock), gas_stock: N(ls.data?.gas_stock) })
    const pm = {}; for (const x of (pr.data || [])) pm[x.id] = x.full_name; setProfiles(pm)
    setLocked(new Set((fv.data || []).map(x => x.mois)))
    setOuverture(ou.data || null)
    const brm = {}; for (const x of (br.data || [])) brm[x.mois] = x; setBonsRecon(brm)
    setCommandesEnCours(co.data || [])
    const rtm = {}; for (const x of (rt.data || [])) rtm[x.order_id] = N(x.quantite_recue_total); setReceptionsTotaux(rtm)
    setCompteBancaire(cb.data || null)
    setSoldeBanque(sb.data || null)
    setMouvementsBanque(mb.data || [])
  }
  useEffect(() => { load() }, [stationId])
  // Rafraîchit automatiquement si une saisie change pendant que la page est ouverte (ex. une
  // livraison réceptionnée plus tard dans la journée) — sinon le résumé/KPIs restent figés sur
  // l'état du chargement initial jusqu'à ce que quelqu'un rouvre la page ou change le mois.
  useEffect(() => {
    if (!stationId) return
    const ch = supabase.channel('finance-' + stationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_reports', filter: `station_id=eq.${stationId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fuel_orders', filter: `station_id=eq.${stationId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'charges', filter: `station_id=eq.${stationId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `station_id=eq.${stationId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits', filter: `station_id=eq.${stationId}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [stationId])

  const annees = useMemo(() => [...new Set([...ventes.map(v => v.mois.slice(0, 4)), today().slice(0, 4)])].sort(), [ventes])

  const inPeriod = (m) => mois ? m === mois : (m || '').startsWith(annee)
  const V = ventes.filter(v => inPeriod(v.mois))
  const sum = (k) => V.reduce((s, v) => s + N(v[k]), 0)
  const commCarb = sum('commission_carburant')
  // Commission gaz + lubrifiant RÉELLE (quantité vendue déclarée × (prix vente − prix achat)),
  // plus une estimation à taux fixe pour la supérette (pas de quantité par produit là-bas,
  // suivie en valeur globale — hors périmètre du calcul réel).
  const CR = commissionReelle.filter(c => inPeriod(c.mois))
  const commGazLub = CR.reduce((s, c) => s + N(c.commission_gaz) + N(c.commission_lubrifiant), 0)
  const commSuperette = sum('ventes_superette') * N(settings.taux_superette) / 100

  // Rapprochement des bons : seul contrôle qui confronte le déclaratif du gérant (ventes_bon,
  // cumulé jour par jour) à une source externe — le relevé mensuel envoyé par la direction.
  const bonsDeclare = sum('ventes_bon')
  const bonRecon = mois ? bonsRecon[mois] : null
  const bonsDirection = bonRecon ? N(bonRecon.montant_direction) : null
  const bonsEcart = bonsDirection != null ? bonsDeclare - bonsDirection : null

  // charges AUTO depuis les dépenses quotidiennes (SBEE, carburant) — factorisé pour être
  // réutilisable sur n'importe quel prédicat de mois (période courante, précédente, un mois donné).
  function autoChargesFor(predicate) {
    const m = {}
    for (const e of expenses) {
      const em = (e.report_date || '').slice(0, 7)
      if (!predicate(em)) continue
      if (e.categorie === 'SBEE' || e.categorie === 'CARBURANT') m[e.categorie] = (m[e.categorie] || 0) + N(e.montant)
    }
    return m
  }
  const autoCharges = autoChargesFor(inPeriod)
  const totAuto = Object.values(autoCharges).reduce((s, v) => s + v, 0)

  // charges MANUELLES
  const chP = charges.filter(c => inPeriod(c.mois))
  const autresProduits = chP.filter(c => c.categorie === REVENU_CAT).reduce((s, c) => s + N(c.montant), 0)
  const totManuel = chP.filter(c => c.categorie !== REVENU_CAT).reduce((s, c) => s + N(c.montant), 0)
  const chargesAPayer = chP.filter(c => c.categorie !== REVENU_CAT && c.statut !== 'paye').reduce((s, c) => s + N(c.montant), 0)

  // Pertes livraison sur la période — deux notions distinctes :
  // perteNaMontant (hors seuil de tolérance) sert de base à une éventuelle retenue sur le
  // salaire du gérant ; perteMontant (TOTALE, seuil inclus) est un vrai coût pour la station
  // qu'elle soit ou non imputable au gérant — comptée comme charge automatique ci-dessous.
  const pertesP = pertes.filter(p => inPeriod(p.mois))
  const perteNaMontant = pertesP.reduce((s, p) => s + N(p.perte_na_montant), 0)
  const perteNaLitres = pertesP.reduce((s, p) => s + N(p.perte_na_litres), 0)
  const perteMontant = pertesP.reduce((s, p) => s + N(p.perte_montant), 0)

  const totCharges = totAuto + totManuel + perteMontant
  const produits = commCarb + commGazLub + commSuperette + autresProduits
  const resultat = produits - totCharges

  // Seuil de rentabilité en litres : combien de litres de carburant (essence + gasoil — même
  // marge/L pour les deux, l'app ne distingue pas) faut-il vendre pour couvrir les charges,
  // les autres pôles restant à leur niveau actuel ? litres × marge = charges − (autres produits).
  const litresActuels = sum('litres_carburant')
  const litresSeuilRentabilite = N(settings.marge_unitaire) > 0
    ? Math.max(0, (totCharges - commGazLub - commSuperette - autresProduits) / N(settings.marge_unitaire))
    : null

  // Comparaison à la période précédente (mois précédent si un mois précis est sélectionné,
  // sinon année précédente) — repère les anomalies comme le ferait un comptable.
  const prevLabel = mois
    ? (() => { const [y, m] = mois.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` })()
    : (annee ? String(Number(annee) - 1) : null)
  const prevInPeriod = (m) => prevLabel && (mois ? m === prevLabel : (m || '').startsWith(prevLabel))
  const Vprev = ventes.filter(v => prevInPeriod(v.mois))
  const sumPrev = (k) => Vprev.reduce((s, v) => s + N(v[k]), 0)
  const commCarbPrev = sumPrev('commission_carburant')
  const CRprev = commissionReelle.filter(c => prevInPeriod(c.mois))
  const commGazLubPrev = CRprev.reduce((s, c) => s + N(c.commission_gaz) + N(c.commission_lubrifiant), 0)
  const commSuperettePrev = sumPrev('ventes_superette') * N(settings.taux_superette) / 100
  const autoChargesPrev = autoChargesFor(prevInPeriod)
  const totAutoPrev = Object.values(autoChargesPrev).reduce((s, v) => s + v, 0)
  const chPprev = charges.filter(c => prevInPeriod(c.mois))
  const autresProduitsPrev = chPprev.filter(c => c.categorie === REVENU_CAT).reduce((s, c) => s + N(c.montant), 0)
  const totManuelPrev = chPprev.filter(c => c.categorie !== REVENU_CAT).reduce((s, c) => s + N(c.montant), 0)
  const perteMontantPrev = pertes.filter(p => prevInPeriod(p.mois)).reduce((s, p) => s + N(p.perte_montant), 0)
  const produitsPrev = commCarbPrev + commGazLubPrev + commSuperettePrev + autresProduitsPrev
  const totChargesPrev = totAutoPrev + totManuelPrev + perteMontantPrev
  const resultatPrev = produitsPrev - totChargesPrev
  function cmp(curr, prev) {
    if (!prevLabel || !prev) return {}
    const pct = Math.round(100 * (curr - prev) / Math.abs(prev))
    return { delta: `${pct > 0 ? '+' : ''}${pct}%`, direction: curr === prev ? 'flat' : curr > prev ? 'up' : 'down' }
  }

  // Bilan simplifié : actif/passif CUMULÉS depuis la date d'ouverture (ou depuis le début des
  // données si aucune n'est définie) jusqu'à la fin de la période affichée — pas juste le flux
  // de la période, comme le compte de résultat ci-dessus.
  const periodeFinBilan = mois || (annee ? `${annee}-12` : null)
  // Le solde d'ouverture agit comme une vraie COUPURE : les mois avant sa date sont exclus des
  // cumuls (pas juste additionnés par-dessus tout l'historique) — utile pour repartir d'une
  // date à partir de laquelle les données sont fiables, sans que des mois antérieurs incomplets
  // ne polluent le bilan et le compte de résultat annuel.
  const ouvertureActive = ouverture && periodeFinBilan && ouverture.date_ouverture.slice(0, 7) <= periodeFinBilan
  const ouvertureMoisDebut = ouvertureActive ? ouverture.date_ouverture.slice(0, 7) : null
  const ouvertureMontant = ouvertureActive ? N(ouverture.montant) : 0
  const cashCumule = periodeFinBilan
    ? ventes.filter(v => v.mois <= periodeFinBilan && (!ouvertureMoisDebut || v.mois >= ouvertureMoisDebut)).reduce((s, v) => s + N(v.recettes_especes) - N(v.total_depense) - N(v.total_verse), 0)
    : 0
  const chargesAPayerCumule = periodeFinBilan
    ? charges.filter(c => c.categorie !== REVENU_CAT && c.statut !== 'paye' && c.mois <= periodeFinBilan && (!ouvertureMoisDebut || c.mois >= ouvertureMoisDebut)).reduce((s, c) => s + N(c.montant), 0)
    : 0
  const stockTotal = stockVal.reduce((s, v) => s + N(v.valeur), 0)
  // Stock carburant (cuves), valorisé au prix d'achat — absent de v_stock_valeur (gaz + lubrifiant
  // + supérette seulement), pourtant le plus gros poste de valeur d'une station.
  const stockCarburant = stockCuve.ess_stock * N(settings.essence_pa || 705) + stockCuve.gas_stock * N(settings.gasoil_pa || 730)
  // Commandes en cours (lancées/partielles) : valeur engagée pas encore convertie en stock —
  // sans cette ligne, l'argent "disparaît" du bilan entre le lancement d'une commande (les bons
  // en cours diminuent aussitôt) et sa réception (le stock augmente). Seule la part RESTANTE
  // (non encore reçue) compte ici, pour ne pas doubler ce qui est déjà dans le stock ci-dessus.
  const commandesEnCoursValeur = commandesEnCours.reduce((s, o) => {
    const commande = N(o.quantite_commandee)
    if (commande <= 0) return s
    const deja = N(receptionsTotaux[o.id])
    const reste = Math.max(commande - deja, 0)
    const montantTotal = (o.categorie || 'carburant') === 'carburant' ? N(o.bons_base) + N(o.cheque_montant) : N(o.montant_paiement)
    return s + montantTotal * (reste / commande)
  }, 0)
  const soldeBancaireActuel = N(compteBancaire?.solde_actuel)
  const totalActif = stockTotal + stockCarburant + commandesEnCoursValeur + bonsRestant + cashCumule + ouvertureMontant + soldeBancaireActuel
  const totalPassif = chargesAPayerCumule
  const situationNette = totalActif - totalPassif

  const isLocked = mois && locked.has(mois)

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500) }

  async function handleChargePhoto(file) {
    if (!file || !stationId || !mois) return
    setNcPhotoBusy(true)
    try {
      const path = await uploadEvidence(supabase, BORDEREAUX_BUCKET, `${stationId}/charges/${mois}`, file)
      setNc(p => ({ ...p, photo_path: path }))
    } catch (e) { setErr(`Échec de l'envoi de la photo : ${e.message || e}. Vérifiez votre connexion et réessayez.`) }
    finally { setNcPhotoBusy(false) }
  }
  async function addCharge(e) {
    e.preventDefault(); setErr('')
    if (!mois) { setErr('Choisissez un mois précis pour saisir une charge.'); return }
    if (locked.has(mois)) { setErr('Ce mois est verrouillé — déverrouille-le pour ajouter une charge.'); return }
    if (!nc.montant) return
    const { error } = await supabase.from('charges').insert({
      station_id: stationId, mois, categorie: nc.categorie, montant: Number(nc.montant), note: nc.note || null,
      statut: nc.statut, date_paiement: nc.statut === 'paye' ? (nc.date_paiement || today()) : null,
      code_comptable: nc.code_comptable || null, photo_path: nc.photo_path || null, created_by: session.user.id })
    if (error) setErr(error.message); else { setNc(blankCharge()); flash('Charge ajoutée'); load() }
  }
  async function delCharge(c) {
    if (locked.has(c.mois)) { setErr('Ce mois est verrouillé.'); return }
    await supabase.from('charges').delete().eq('id', c.id); load()
  }
  async function togglePaye(c) {
    if (locked.has(c.mois)) { setErr('Ce mois est verrouillé.'); return }
    const nextStatut = c.statut === 'paye' ? 'a_payer' : 'paye'
    const { error } = await supabase.from('charges').update({ statut: nextStatut, date_paiement: nextStatut === 'paye' ? today() : null }).eq('id', c.id)
    if (error) setErr(error.message); else load()
  }
  async function toggleLock() {
    if (!mois) return
    if (isLocked) {
      await supabase.from('finance_periodes_verrouillees').delete().eq('station_id', stationId).eq('mois', mois)
      flash('Mois déverrouillé')
    } else {
      const { error } = await supabase.from('finance_periodes_verrouillees').insert({ station_id: stationId, mois, verrouille_by: session.user.id })
      if (error) { setErr(error.message); return }
      flash('Mois verrouillé')
    }
    load()
  }
  function openOuvertureForm() {
    setOuvertureForm(ouverture
      ? { montant: String(ouverture.montant), date_ouverture: ouverture.date_ouverture, note: ouverture.note || '' }
      : { montant: '', date_ouverture: today(), note: '' })
    setEditOuverture(true)
  }
  async function saveOuverture(e) {
    e.preventDefault(); setErr('')
    if (!ouvertureForm.date_ouverture) { setErr("Renseignez la date d'ouverture."); return }
    const { error } = await supabase.from('finance_soldes_ouverture').upsert({
      station_id: stationId, date_ouverture: ouvertureForm.date_ouverture, montant: Number(ouvertureForm.montant) || 0,
      note: ouvertureForm.note || null, created_by: session.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'station_id' })
    if (error) setErr(error.message); else { setEditOuverture(false); flash("Solde d'ouverture enregistré"); load() }
  }
  function openBonReconForm() {
    setBonReconForm(bonRecon ? { montant_direction: String(bonRecon.montant_direction), note: bonRecon.note || '' } : { montant_direction: '', note: '' })
    setEditBonRecon(true)
  }
  async function saveBonRecon(e) {
    e.preventDefault(); setErr('')
    if (!mois) return
    const { error } = await supabase.from('finance_bons_reconciliation').upsert({
      station_id: stationId, mois, montant_direction: Number(bonReconForm.montant_direction) || 0,
      note: bonReconForm.note || null, created_by: session.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'station_id,mois' })
    if (error) setErr(error.message); else { setEditBonRecon(false); flash('Rapprochement des bons enregistré'); load() }
  }
  function openSoldeBanqueForm() {
    setSoldeBanqueForm(soldeBanque
      ? { montant: String(soldeBanque.montant), date_solde: soldeBanque.date_solde, note: soldeBanque.note || '' }
      : { montant: '', date_solde: today(), note: '' })
    setEditSoldeBanque(true)
  }
  async function saveSoldeBanque(e) {
    e.preventDefault(); setErr('')
    if (!soldeBanqueForm.date_solde) { setErr('Renseignez la date du solde.'); return }
    const { error } = await supabase.from('compte_bancaire_solde_initial').upsert({
      station_id: stationId, date_solde: soldeBanqueForm.date_solde, montant: Number(soldeBanqueForm.montant) || 0,
      note: soldeBanqueForm.note || null, created_by: session.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'station_id' })
    if (error) setErr(error.message); else { setEditSoldeBanque(false); flash('Solde bancaire initial enregistré'); load() }
  }
  async function delMouvementBanque(m) {
    await supabase.from('compte_bancaire_mouvements').delete().eq('id', m.id); load()
  }
  // proposer : copier les charges récurrentes du mois précédent
  async function reporterMoisPrecedent() {
    if (!mois) return
    if (locked.has(mois)) { setErr('Ce mois est verrouillé.'); return }
    const [y, m] = mois.split('-').map(Number)
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    const prevRows = charges.filter(c => c.mois === prev && c.categorie !== REVENU_CAT && c.categorie !== 'PERTE_VENTE_CARBURANT')
    if (!prevRows.length) { setErr(`Aucune charge sur ${prev} à reporter.`); return }
    const rows = prevRows.map(c => ({
      station_id: stationId, mois, categorie: c.categorie, montant: c.montant, note: 'proposé (report ' + prev + ')',
      code_comptable: c.code_comptable || null, statut: 'a_payer', created_by: session.user.id }))
    const { error } = await supabase.from('charges').insert(rows)
    if (error) setErr(error.message); else { flash(`${rows.length} charge(s) reportée(s) de ${prev}`); load() }
  }

  function exportCompteResultat() {
    const columns = [['Poste', 'poste'], ['Montant', 'montant']]
    const data = [
      { poste: 'Commission carburant', montant: Math.round(commCarb) },
      { poste: 'Commission gaz + lubrifiant (prix vente − prix achat)', montant: Math.round(commGazLub) },
      { poste: `Commission supérette (${settings.taux_superette}%)`, montant: Math.round(commSuperette) },
      { poste: 'Autres produits', montant: Math.round(autresProduits) },
      { poste: '= PRODUITS', montant: Math.round(produits) },
      { poste: 'SBEE (auto)', montant: Math.round(N(autoCharges.SBEE)) },
      { poste: 'Carburant / déplacement (auto)', montant: Math.round(N(autoCharges.CARBURANT)) },
      { poste: 'Pertes livraison (auto)', montant: Math.round(perteMontant) },
      { poste: 'Charges fixes', montant: Math.round(totManuel) },
      { poste: '= CHARGES', montant: Math.round(totCharges) },
      { poste: 'RÉSULTAT', montant: Math.round(resultat) },
    ]
    exportRowsToCsv(`compte-resultat-${mois || annee}.csv`, columns, data)
  }
  function exportChargesFixes() {
    const columns = [['Mois', 'mois'], ['Catégorie', 'categorie'], ['Code comptable', 'code'], ['Statut', 'statut'],
      ['Date paiement', 'date_paiement'], ['Montant', 'montant'], ['Note', 'note'], ['Saisi par', 'par'], ['Le', 'le']]
    const data = chP.map(c => ({
      mois: c.mois, categorie: c.categorie === REVENU_CAT ? 'Autres produits' : c.categorie, code: c.code_comptable || '',
      statut: c.statut === 'paye' ? 'Payé' : 'À payer', date_paiement: c.date_paiement || '',
      montant: Math.round(N(c.montant)), note: c.note || '', par: profiles[c.created_by] || '', le: c.created_at ? frDate(c.created_at) : '',
    }))
    exportRowsToCsv(`charges-fixes-${mois || annee}.csv`, columns, data)
  }


  const chargesColumns = [
    { key: 'mois', header: 'Mois' },
    { key: 'categorie', header: 'Catégorie', render: c => `${c.categorie === REVENU_CAT ? 'Autres produits' : c.categorie.replace(/_/g, ' ')}${c.note ? ` · ${c.note}` : ''}` },
    { key: 'code_comptable', header: 'Code', muted: true, render: c => c.code_comptable || '—' },
    { key: 'statut', header: 'Statut', render: c => c.categorie === REVENU_CAT ? '—' : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <Badge tone={c.statut === 'paye' ? 'ok' : 'idle'}>{c.statut === 'paye' ? `Payé${c.date_paiement ? ' ' + frDate(c.date_paiement) : ''}` : 'À payer'}</Badge>
        {can('manage_finance') && <Button size="sm" onClick={() => togglePaye(c)} disabled={locked.has(c.mois)}>{c.statut === 'paye' ? 'Marquer à payer' : 'Marquer payé'}</Button>}
      </div>) },
    { key: 'photo', header: 'Justif.', render: c => c.photo_path ? <PhotoLink path={c.photo_path}>Voir</PhotoLink> : <span style={{ color: 'var(--text-muted)' }}>—</span> },
    { key: 'par', header: 'Saisi par', muted: true, render: c => <span title={c.created_at ? frDate(c.created_at) : ''}>{profiles[c.created_by] || '—'}</span> },
    { key: 'montant', header: 'Montant', numeric: true, align: 'right', render: c => <span style={{ color: c.categorie === REVENU_CAT ? 'var(--state-ok)' : 'inherit' }}>{fcfa(c.montant)}</span> },
    { key: 'actions', header: '', align: 'right', render: c => can('manage_finance') && <Button size="sm" tone="danger" onClick={() => delCharge(c)} disabled={locked.has(c.mois)}>Suppr.</Button> },
  ]

  // Compte de résultat annuel ventilé par mois — pivot type "grand livre", lourd (12 × tout
  // recalculé) donc replié par défaut et calculé seulement si ouvert.
  const LEDGER_LINES = [
    { key: 'commCarb', label: 'Commission carburant' },
    { key: 'commGL', label: 'Commission gaz + lubrifiant' },
    { key: 'commSup', label: 'Commission supérette' },
    { key: 'autresProduits', label: 'Autres produits' },
    { key: 'produits', label: '= PRODUITS', bold: true },
    { key: 'sbee', label: 'SBEE (auto)' },
    { key: 'carbDepl', label: 'Carburant / déplacement (auto)' },
    { key: 'pertes', label: 'Pertes livraison (auto)' },
    { key: 'chargesFixes', label: 'Charges fixes' },
    { key: 'charges', label: '= CHARGES', bold: true },
    { key: 'resultat', label: 'RÉSULTAT', bold: true },
  ]
  function monthMetrics(m) {
    const Vm = ventes.filter(v => v.mois === m)
    const s = (k) => Vm.reduce((sum, v) => sum + N(v[k]), 0)
    const cCarb = s('commission_carburant')
    const CRm = commissionReelle.filter(c => c.mois === m)
    const cGL = CRm.reduce((sum, c) => sum + N(c.commission_gaz) + N(c.commission_lubrifiant), 0)
    const cSup = s('ventes_superette') * N(settings.taux_superette) / 100
    const auto = autoChargesFor(em => em === m)
    const totA = Object.values(auto).reduce((sum, v) => sum + v, 0)
    const cM = charges.filter(c => c.mois === m)
    const autresP = cM.filter(c => c.categorie === REVENU_CAT).reduce((sum, c) => sum + N(c.montant), 0)
    const totMan = cM.filter(c => c.categorie !== REVENU_CAT).reduce((sum, c) => sum + N(c.montant), 0)
    const pertesM = pertes.filter(p => p.mois === m).reduce((sum, p) => sum + N(p.perte_montant), 0)
    const prod = cCarb + cGL + cSup + autresP
    const tot = totA + totMan + pertesM
    return { commCarb: cCarb, commGL: cGL, commSup: cSup, autresProduits: autresP, sbee: N(auto.SBEE), carbDepl: N(auto.CARBURANT), pertes: pertesM, chargesFixes: totMan, produits: prod, charges: tot, resultat: prod - tot }
  }
  const yearMonths = annee ? MONTHS.map(m => `${annee}-${m}`) : []
  // Mois exclus (avant la date d'ouverture, si définie) : null plutôt que calculés, pour ne
  // pas mélanger des données jugées incomplètes dans le Total avec celles jugées fiables.
  const monthly = openAnnuel ? yearMonths.map(m => (ouvertureMoisDebut && m < ouvertureMoisDebut) ? null : monthMetrics(m)) : []
  const annualColumns = [
    { key: 'label', header: 'Poste' },
    ...MONTHS.map((m, i) => ({ key: m, header: ML[m], numeric: true, align: 'right', render: row => monthly[i] == null ? <span style={{ color: 'var(--text-muted)' }}>—</span> : fcfa(monthly[i][row.key] ?? 0) })),
    { key: 'total', header: 'Total', numeric: true, align: 'right', render: row => <b>{fcfa(monthly.reduce((s, mm) => s + (mm ? N(mm[row.key]) : 0), 0))}</b> },
  ]
  const annualRows = LEDGER_LINES.map(l => ({ id: l.key, label: l.bold ? <b>{l.label}</b> : l.label, key: l.key }))

  // Résumé en clair, pour quelqu'un qui ne connaît pas la compta : l'essentiel des chiffres
  // déjà calculés ci-dessus, mis en phrases, + des pistes concrètes pour le mois suivant.
  // Purement dérivé des données existantes (pas d'IA/appel externe) — mêmes seuils que les KPIs.
  function genererResume() {
    const periode = mois ? `en ${ML[mois.slice(5, 7)]} ${mois.slice(0, 4)}` : `sur l'année ${annee}`
    const lignes = []

    if (resultat > 0) lignes.push(`La station a fait un bénéfice de ${fcfa(resultat)} ${periode}.`)
    else if (resultat < 0) lignes.push(`La station est en perte de ${fcfa(Math.abs(resultat))} ${periode}.`)
    else lignes.push(`La station est à l'équilibre ${periode} : ni gain ni perte.`)

    if (prevLabel && resultatPrev != null) {
      const diff = resultat - resultatPrev
      if (Math.abs(diff) > 1000) {
        lignes.push(diff > 0
          ? `C'est mieux que la période précédente, +${fcfa(diff)}.`
          : `C'est moins bien que la période précédente, ${fcfa(diff)}.`)
      } else {
        lignes.push("C'est stable par rapport à la période précédente.")
      }
    }

    const poles = [
      { nom: 'le carburant', montant: commCarb },
      { nom: 'le gaz et le lubrifiant', montant: commGazLub },
      { nom: 'la supérette', montant: commSuperette },
    ].sort((a, b) => b.montant - a.montant)
    if (poles[0].montant > 0) lignes.push(`La plus grosse partie des revenus vient de ${poles[0].nom} (${fcfa(poles[0].montant)}).`)

    if (totCharges > 0) lignes.push(`Les charges (tout ce qui a été dépensé) s'élèvent à ${fcfa(totCharges)}.`)
    if (perteMontant > 1000) lignes.push(`Sur ce total, ${fcfa(perteMontant)} viennent de carburant manquant à la livraison (pertes).`)
    if (chargesAPayer > 0) lignes.push(`Il reste ${fcfa(chargesAPayer)} de charges pas encore payées.`)

    if (litresSeuilRentabilite != null) {
      const ecartLitres = Math.round(litresSeuilRentabilite - litresActuels)
      lignes.push(ecartLitres > 0
        ? `Pour couvrir toutes les charges (si elles restent stables), il faut vendre au moins ${Math.round(litresSeuilRentabilite).toLocaleString('fr-FR')} L de carburant — soit ${ecartLitres.toLocaleString('fr-FR')} L de plus que les ${Math.round(litresActuels).toLocaleString('fr-FR')} L déjà vendus.`
        : `Les ${Math.round(litresActuels).toLocaleString('fr-FR')} L de carburant déjà vendus suffisent à couvrir toutes les charges (il en fallait ${Math.round(litresSeuilRentabilite).toLocaleString('fr-FR')} L).`)
    }

    const conseils = []
    if (resultat < 0) conseils.push('réduire les charges ou augmenter les ventes pour repasser en bénéfice')
    if (perteMontant > 1000) conseils.push('vérifier avec le gérant pourquoi les livraisons de carburant arrivent incomplètes — ça coûte cher')
    if (chargesAPayer > 0) conseils.push('prévoir de régler les charges encore impayées')
    const plusFaible = poles[poles.length - 1]
    if (poles[0].montant > 0 && plusFaible.montant < poles[0].montant * 0.3) conseils.push(`essayer de développer ${plusFaible.nom}, qui rapporte peu comparé aux autres`)
    lignes.push(conseils.length ? `Pour le mois prochain : ${conseils.join(' ; ')}.` : "Rien d'alarmant : continue sur cette lancée le mois prochain.")

    return lignes
  }
  const resume = genererResume()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <Panel title="Point financier" bodyStyle={{ display: 'none' }} actions={<>
        <PeriodPicker multiple={false} years={[annee]} months={mois ? [mois.slice(5, 7)] : []}
          setYears={ys => { setAnnee(ys[0] || annee); setMois('') }}
          setMonths={ms => setMois(ms.length ? `${annee}-${ms[0]}` : '')}
          availableYears={annees} />
        {mois && can('manage_finance') && <Button size="sm" tone={isLocked ? 'danger' : 'outline'} onClick={toggleLock}>{isLocked ? 'Déverrouiller le mois' : 'Verrouiller le mois'}</Button>}
      </>} />

      {isLocked && (
        <AlertBanner tone="info" title="Mois verrouillé">
          Ce mois a été clôturé — aucune charge fixe ne peut y être ajoutée, modifiée ou supprimée tant qu'il n'est pas déverrouillé.
        </AlertBanner>
      )}

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'apercu' && <>
      <Panel title="En clair" meta={mois || annee} status={resultat < 0 ? 'alarm' : 'ok'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {resume.map((ligne, i) => (
            <p key={i} style={{ font: i === resume.length - 1 ? 'var(--fw-semibold) 15px/1.5 var(--font-ui)' : '400 15px/1.5 var(--font-ui)', color: 'var(--text-body)', margin: 0 }}>{ligne}</p>
          ))}
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        <Kpi label="Litres carburant" value={Math.round(sum('litres_carburant')).toLocaleString('fr-FR')} unit="L" />
        {litresSeuilRentabilite != null && (
          <Kpi label="Seuil de rentabilité" value={Math.round(litresSeuilRentabilite).toLocaleString('fr-FR')} unit="L"
            sub="litres de carburant à vendre pour couvrir les charges" status={litresActuels >= litresSeuilRentabilite ? 'ok' : 'warn'} />
        )}
        <Kpi label="Commission carburant" value={fcfa(commCarb)} sub="litres × marge" {...cmp(commCarb, commCarbPrev)} />
        <Kpi label="Ventes gaz + lubrifiant" value={fcfa(sum('ventes_gaz') + sum('ventes_lubrifiant'))} />
        <Kpi label="Ventes supérette" value={fcfa(sum('ventes_superette'))} />
        <Kpi label="Total charges" value={fcfa(totCharges)} {...cmp(totCharges, totChargesPrev)} />
        <Kpi label="Charges à payer" value={fcfa(chargesAPayer)} status={chargesAPayer > 0 ? 'warn' : 'ok'} />
        <Kpi label="Valeur du stock" value={fcfa(stockTotal)} sub="gaz + lubrifiant + supérette" />
        <Kpi label="RÉSULTAT" value={fcfa(resultat)} status={resultat < 0 ? 'alarm' : 'ok'} {...cmp(resultat, resultatPrev)} />
      </div>

      <Panel title="Compte de résultat" meta={mois || annee} actions={<Button size="sm" onClick={exportCompteResultat}>Exporter (CSV)</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          <LedgerHead>Produits (commissions, auto)</LedgerHead>
          <LedgerRow label="Commission carburant" value={fcfa(commCarb)} />
          <LedgerRow label="Commission gaz + lubrifiant (prix vente − prix achat)" value={fcfa(commGazLub)} />
          <LedgerRow label={`Commission supérette (${settings.taux_superette}%)`} value={fcfa(commSuperette)} />
          {autresProduits > 0 && <LedgerRow label="Autres produits (saisis)" value={fcfa(autresProduits)} />}
          <LedgerHead>Charges</LedgerHead>
          <LedgerRow label="SBEE (auto, depuis dépenses)" value={fcfa(autoCharges.SBEE)} />
          <LedgerRow label="Carburant / déplacement (auto)" value={fcfa(autoCharges.CARBURANT)} />
          {perteMontant > 0 && <LedgerRow label="Pertes livraison (auto)" value={fcfa(perteMontant)} />}
          <LedgerRow label="Charges fixes (saisies)" value={fcfa(totManuel)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--sp-3)', borderTop: '2px solid var(--border-default)', font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)' }}>
            <span>RÉSULTAT</span>
            <span style={{ color: resultat < 0 ? 'var(--state-alarm)' : 'var(--state-ok)' }}>{fcfa(resultat)}</span>
          </div>
        </div>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 'var(--sp-4)', marginBottom: 0 }}>
          SBEE, carburant/déplacement et les pertes sur livraisons sont <b>déduits automatiquement</b> (dépenses quotidiennes et livraisons réceptionnées). Les charges fixes se <b>reportent d'un mois sur l'autre</b> (bouton ci-dessous), tout reste modifiable.
        </p>
      </Panel>

      <Panel title="Compte de résultat annuel" meta={`${annee} — par mois`} flush
        bodyStyle={openAnnuel ? undefined : { display: 'none' }}
        actions={<IconButton icon="chevron-down" size="sm" title={openAnnuel ? 'Masquer' : 'Afficher'}
          onClick={() => setOpenAnnuel(v => !v)} style={{ transform: openAnnuel ? 'rotate(180deg)' : 'none' }} />}>
        {openAnnuel && <>
          {ouvertureMoisDebut && <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: '0 0 var(--sp-3) var(--gutter-panel)' }}>Mois avant {ouvertureMoisDebut} exclus du Total ("—") — solde d'ouverture défini.</p>}
          <DataTable columns={annualColumns} rows={annualRows} />
        </>}
      </Panel>
      </>}

      {tab === 'controles' && <>
      <Panel title="Pertes sur livraisons" meta={mois || annee} status={perteNaMontant > 0 ? 'alarm' : 'ok'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
          <Kpi label="Pertes totales" value={fcfa(perteMontant)} sub="comptées en charge, seuil inclus" />
          <Kpi label="Pertes NON acceptables" value={Math.round(perteNaLitres).toLocaleString('fr-FR')} unit="L" status={perteNaLitres > 0 ? 'alarm' : 'ok'} sub={`au-delà de ${settings.taux_perte_acceptable || 5}%`} />
          <Kpi label="Montant (base retenue)" value={fcfa(perteNaMontant)} status={perteNaMontant > 0 ? 'alarm' : 'ok'} />
        </div>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 'var(--sp-4)', marginBottom: 0 }}>
          Les <b>pertes totales</b> (y compris dans le seuil de tolérance) sont comptées comme une charge automatique dans le compte de résultat. Les <b>pertes NON acceptables</b> (au-delà du seuil) sont une notion séparée : base d'une éventuelle retenue sur le salaire du gérant si non justifiées.
        </p>
      </Panel>

      <Panel title="Rapprochement des bons" meta={mois || annee}
        status={bonsEcart != null ? (Math.abs(bonsEcart) > 0.5 ? 'alarm' : 'ok') : undefined}
        actions={mois && can('manage_finance') && <Button size="sm" onClick={openBonReconForm}>{bonRecon ? 'Modifier' : 'Renseigner'} le relevé direction</Button>}>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Les ventes à bon sont déclarées au jour le jour par le gérant, sans preuve ni recoupement interne — c'est le seul montant qui confronte cette déclaration à une source externe (le relevé mensuel de la direction).
        </p>
        {editBonRecon && (
          <form onSubmit={saveBonRecon} style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'end', marginBottom: 'var(--sp-4)', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)' }}>
            <Field label={`Montant confirmé par la direction — ${mois}`} style={{ flex: '1 1 220px' }}>
              <Input type="number" inputMode="decimal" numeric value={bonReconForm.montant_direction} onChange={e => setBonReconForm({ ...bonReconForm, montant_direction: e.target.value })} />
            </Field>
            <Field label="Note (optionnel)" style={{ flex: '1 1 200px' }}>
              <Input value={bonReconForm.note} onChange={e => setBonReconForm({ ...bonReconForm, note: e.target.value })} />
            </Field>
            <Button type="submit" tone="dark" size="sm">Enregistrer</Button>
            <Button type="button" size="sm" onClick={() => setEditBonRecon(false)}>Annuler</Button>
          </form>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
          <Kpi label="Bons déclarés (gérant)" value={fcfa(bonsDeclare)} sub={mois ? undefined : "somme sur l'année"} />
          {mois
            ? <>
                <Kpi label="Confirmé par la direction" value={bonsDirection != null ? fcfa(bonsDirection) : '—'} />
                <Kpi label="Écart" value={bonsDirection != null ? fcfa(bonsEcart) : '—'} status={bonsDirection != null ? (Math.abs(bonsEcart) > 0.5 ? 'alarm' : 'ok') : undefined} />
              </>
            : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', alignSelf: 'center', margin: 0 }}>Sélectionnez un mois précis pour comparer au relevé de la direction.</p>}
        </div>
      </Panel>
      </>}

      {tab === 'tresorerie' && <>
      <Panel title="Compte bancaire" meta={soldeBanque ? `depuis ${frDate(soldeBanque.date_solde)}` : undefined}
        actions={can('manage_finance') && <Button size="sm" onClick={openSoldeBanqueForm}>{soldeBanque ? 'Modifier' : 'Définir'} le solde initial</Button>}>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Suivi du compte, calculé depuis un solde initial : + dépôts (déjà saisis dans les versements) − chèques de commandes − frais bancaires + virements reçus (remboursement des bons).
        </p>
        {editSoldeBanque && (
          <form onSubmit={saveSoldeBanque} style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'end', marginBottom: 'var(--sp-4)', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)' }}>
            <Field label="Date du solde" style={{ flex: '1 1 160px' }}>
              <Input type="date" value={soldeBanqueForm.date_solde} max={today()} onChange={e => setSoldeBanqueForm({ ...soldeBanqueForm, date_solde: e.target.value })} />
            </Field>
            <Field label="Solde à cette date (F)" style={{ flex: '1 1 200px' }}>
              <Input type="number" inputMode="decimal" numeric value={soldeBanqueForm.montant} onChange={e => setSoldeBanqueForm({ ...soldeBanqueForm, montant: e.target.value })} />
            </Field>
            <Field label="Note (optionnel)" style={{ flex: '1 1 200px' }}>
              <Input value={soldeBanqueForm.note} onChange={e => setSoldeBanqueForm({ ...soldeBanqueForm, note: e.target.value })} />
            </Field>
            <Button type="submit" tone="dark" size="sm">Enregistrer</Button>
            <Button type="button" size="sm" onClick={() => setEditSoldeBanque(false)}>Annuler</Button>
          </form>
        )}
        {soldeBanque ? <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
            <Kpi label="Solde actuel" value={fcfa(soldeBancaireActuel)} status={soldeBancaireActuel < 0 ? 'alarm' : 'ok'} />
            <Kpi label="Dépôts" value={fcfa(N(compteBancaire?.total_depots))} />
            <Kpi label="Chèques commandes" value={fcfa(N(compteBancaire?.total_cheques))} />
            <Kpi label="Virements bons reçus" value={fcfa(N(compteBancaire?.total_virements))} sub="relevé importé" />
            <Kpi label="Frais bancaires" value={fcfa(N(compteBancaire?.total_frais))} sub="relevé importé" />
          </div>
          <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: '0 0 var(--sp-3)' }}>
            Virements reçus (bons) et frais bancaires ne se saisissent plus ici — ils viennent automatiquement du relevé importé et catégorisé dans Rapprochement. Pour corriger un montant, recatégorise ou corrige la ligne concernée depuis Rapprochement.
          </p>
          {mouvementsBanque.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <p style={{ font: '500 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Historique des mouvements saisis à la main avant l'automatisation (pour archive) :</p>
              {mouvementsBanque.map(m => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', font: '400 14px/1.4 var(--font-ui)' }}>
                  <span style={{ color: 'var(--text-body)' }}>
                    {frDate(m.date_mouvement)} — {m.type === 'virement_bons' ? 'Virement bons' : 'Frais bancaire'}
                    {m.note ? ` · ${m.note}` : ''}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                    <b style={{ color: m.type === 'virement_bons' ? 'var(--state-ok)' : 'var(--state-alarm)' }}>{m.type === 'virement_bons' ? '+' : '−'}{fcfa(m.montant)}</b>
                    {m.photo_path && <PhotoLink path={m.photo_path}>Photo</PhotoLink>}
                    {can('manage_finance') && <Button size="sm" tone="danger" onClick={() => delMouvementBanque(m)}>Suppr.</Button>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </> : <PanelEmpty icon="landmark" label="Définis le solde initial du compte pour commencer le suivi" />}
      </Panel>

      <Panel title="Bilan simplifié" meta={`au ${periodeFinBilan || '—'}`}
        actions={can('manage_finance') && <Button size="sm" onClick={openOuvertureForm}>{ouverture ? "Modifier le solde d'ouverture" : "Définir le solde d'ouverture"}</Button>}>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Ce que la station possède / doit, cumulé {ouvertureMoisDebut ? `depuis ${ouvertureMoisDebut} (solde d'ouverture — les mois antérieurs sont exclus)` : 'depuis le début des données'} jusqu'à la fin de la période — pas un flux du mois comme le compte de résultat ci-dessus.
        </p>
        {editOuverture && (
          <form onSubmit={saveOuverture} style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'end', marginBottom: 'var(--sp-4)', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)' }}>
            <Field label="Date d'ouverture (avant le suivi app)" style={{ flex: '1 1 160px' }}>
              <Input type="date" value={ouvertureForm.date_ouverture} max={today()} onChange={e => setOuvertureForm({ ...ouvertureForm, date_ouverture: e.target.value })} />
            </Field>
            <Field label="Solde net à cette date (F)" hint="actif − passif réels avant le suivi, peut être négatif" style={{ flex: '1 1 200px' }}>
              <Input type="number" inputMode="decimal" numeric value={ouvertureForm.montant} onChange={e => setOuvertureForm({ ...ouvertureForm, montant: e.target.value })} />
            </Field>
            <Field label="Note (optionnel)" style={{ flex: '1 1 200px' }}>
              <Input value={ouvertureForm.note} onChange={e => setOuvertureForm({ ...ouvertureForm, note: e.target.value })} />
            </Field>
            <Button type="submit" tone="dark" size="sm">Enregistrer</Button>
            <Button type="button" size="sm" onClick={() => setEditOuverture(false)}>Annuler</Button>
          </form>
        )}
        <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            <LedgerHead>Actif</LedgerHead>
            {ouverture && <LedgerRow label={`Solde d'ouverture (avant le suivi, ${frDate(ouverture.date_ouverture)})`} value={fcfa(ouvertureMontant)} />}
            <LedgerRow label="Stock carburant (cuves, au prix d'achat)" value={fcfa(stockCarburant)} />
            <LedgerRow label="Stock (gaz + lubrifiant + supérette)" value={fcfa(stockTotal)} />
            {commandesEnCoursValeur > 0 && <LedgerRow label="Commandes en cours (en transit)" value={fcfa(commandesEnCoursValeur)} />}
            <LedgerRow label="Bons en cours (créance, à ce jour)" value={fcfa(bonsRestant)} />
            <LedgerRow label="Cash non encore versé (cumulé)" value={fcfa(cashCumule)} />
            {soldeBanque && <LedgerRow label="Solde bancaire (à ce jour)" value={fcfa(soldeBancaireActuel)} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 'var(--sp-5)', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--border-hairline)', font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)' }}>
              <span>Total actif</span><span>{fcfa(totalActif)}</span>
            </div>
          </div>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            <LedgerHead>Passif</LedgerHead>
            <LedgerRow label="Charges à payer (cumulées)" value={fcfa(chargesAPayerCumule)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 'var(--sp-5)', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--border-hairline)', font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)' }}>
              <span>Total passif</span><span>{fcfa(totalPassif)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)', borderTop: '2px solid var(--border-default)', font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)' }}>
              <span>Situation nette</span>
              <span style={{ color: situationNette < 0 ? 'var(--state-alarm)' : 'var(--state-ok)' }}>{fcfa(situationNette)}</span>
            </div>
          </div>
        </div>
        <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 'var(--sp-4)', marginBottom: 0 }}>
          "Bons en cours", "Stock carburant" et "Commandes en cours" reflètent la valeur à aujourd'hui (pas d'historique disponible pour une date passée).
        </p>
      </Panel>
      </>}

      {tab === 'charges' && <>
      <Panel title="Charges fixes" meta={mois || undefined} flush
        actions={chP.length > 0 && <Button size="sm" onClick={exportChargesFixes}>Exporter (CSV)</Button>}>
        <div style={{ padding: 'var(--gutter-panel)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {!mois && can('manage_finance') && <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Sélectionnez un <b>mois précis</b> pour saisir/reporter les charges.</p>}
          {mois && !isLocked && can('manage_finance') && <>
            <Button size="sm" onClick={reporterMoisPrecedent} style={{ alignSelf: 'flex-start' }}>Reporter le mois précédent</Button>
            <form onSubmit={addCharge} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Catégorie" style={{ flex: '1 1 200px' }}>
                  <Select value={nc.categorie} onChange={e => setNc({ ...nc, categorie: e.target.value })} options={CAT_OPTIONS} style={{ width: '100%' }} />
                </Field>
                <Field label="Montant" style={{ flex: '1 1 150px' }}>
                  <Input type="number" inputMode="decimal" numeric value={nc.montant} onChange={e => setNc({ ...nc, montant: e.target.value })} />
                </Field>
                <Field label="Code comptable (optionnel)" style={{ flex: '1 1 150px' }} hint="ex. plan SYSCOHADA : 613, 641...">
                  <Input value={nc.code_comptable} onChange={e => setNc({ ...nc, code_comptable: e.target.value })} />
                </Field>
              </div>
              {nc.categorie !== REVENU_CAT && <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'end' }}>
                <Field label="Statut" style={{ flex: '1 1 150px' }}>
                  <Select value={nc.statut} onChange={e => setNc({ ...nc, statut: e.target.value })} options={STATUT_OPTIONS} style={{ width: '100%' }} />
                </Field>
                {nc.statut === 'paye' && <Field label="Date de paiement" style={{ flex: '1 1 150px' }}>
                  <Input type="date" value={nc.date_paiement || today()} max={today()} onChange={e => setNc({ ...nc, date_paiement: e.target.value })} />
                </Field>}
                <Field label="Justificatif (facture, bulletin...)" style={{ flex: '1 1 220px' }}>
                  <EvidenceUpload disabled={ncPhotoBusy}
                    label={ncPhotoBusy ? 'Envoi…' : nc.photo_path ? 'Photo ✓ (reprendre)' : 'Déposer la photo'}
                    multiple={false} onFiles={files => files[0] && handleChargePhoto(files[0])} />
                </Field>
              </div>}
              <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>Ajouter</Button>
            </form>
          </>}
        </div>
        {chP.length
          ? <DataTable columns={chargesColumns} rows={[...chP].sort((a, b) => (a.mois + a.categorie).localeCompare(b.mois + b.categorie))} />
          : <PanelEmpty icon="landmark" label="Aucune charge fixe pour cette période" />}
      </Panel>
      </>}
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
