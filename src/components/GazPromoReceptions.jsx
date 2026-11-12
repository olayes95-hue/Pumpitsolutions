import { useEffect, useState } from 'react'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { PhotoLink } from '../lib/photos.jsx'
import { uploadEvidence } from '../lib/image'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, numFR, today } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { EvidenceUpload } from '../ds/pumpit/components/evidence/EvidenceUpload.jsx'

const N = (v) => Number(v) || 0
const TAILLES = [['3', '3 kg'], ['6', '6 kg'], ['12', '12 kg'], ['38', '38 kg']]
const tailleLabel = (t) => TAILLES.find(x => x[0] === t)?.[1] || t
const blankLigne = () => ({ taille: '12', quantite: '', prix_vente_unitaire: '' })
const blankForm = () => ({ report_date: today(), montant_retour_fournisseur: '', date_echeance: '', note: '', photo_path: null })
const ligneValeur = (l) => N(l.quantite) * N(l.prix_vente_unitaire)
const receptionValeur = (r) => (r.lignes || []).reduce((s, l) => s + N(l.quantite) * N(l.prix_vente_unitaire), 0)
const receptionQte = (r) => (r.lignes || []).reduce((s, l) => s + N(l.quantite), 0)
const receptionResume = (r) => (r.lignes || []).map(l => `${tailleLabel(l.taille)}×${l.quantite}`).join(', ')

// Réception de gaz promo (dépôt-vente, migration_v165/v166) : le chef de piste déclare chaque
// livraison — une même livraison peut couvrir plusieurs types de bouteilles à la fois (d'où
// plusieurs lignes), mais une seule NCE (montant à retourner + échéance) couvre toute la
// livraison. L'échéance et le montant sont saisis à la main (pas de règle automatique, ça vient
// du bon fournisseur). Marquer "réglée" reste réservé à manage_finance/admin (RLS).
export default function GazPromoReceptions() {
  const { can, isAdmin, session } = useAuth()
  const { stationId } = useStation()
  const peutRegler = isAdmin || can('manage_finance')
  const [receptions, setReceptions] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(blankForm())
  const [lignes, setLignes] = useState([blankLigne()])
  const [photoBusy, setPhotoBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  async function load() {
    if (!stationId) return
    const { data } = await supabase.from('gaz_promo_receptions').select('*').eq('station_id', stationId).order('report_date', { ascending: false }).limit(50)
    setReceptions(data || [])
  }
  useEffect(() => { load() }, [stationId])

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500) }
  const fail = (e) => { setErr(e.message || String(e)); setMsg('') }
  const lignesValides = lignes.filter(l => N(l.quantite) > 0 && N(l.prix_vente_unitaire) > 0)
  const valeurTotale = lignesValides.reduce((s, l) => s + ligneValeur(l), 0)

  const setLigne = (i, patch) => setLignes(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  const ajouterLigne = () => setLignes(ls => [...ls, blankLigne()])
  const retirerLigne = (i) => setLignes(ls => ls.filter((_, j) => j !== i))

  async function onPhoto(file) {
    if (!file) return
    setPhotoBusy(true)
    try {
      const path = await uploadEvidence(supabase, BORDEREAUX_BUCKET, `${stationId}/gaz_promo_receptions`, file)
      setForm(p => ({ ...p, photo_path: path }))
    } catch (e) { fail(e) }
    finally { setPhotoBusy(false) }
  }

  async function declarer(e) {
    e.preventDefault(); setErr('')
    if (!lignesValides.length) { setErr('Renseignez au moins un type avec quantité et prix de vente unitaire.'); return }
    if (!form.montant_retour_fournisseur || !form.date_echeance) {
      setErr('Montant à retourner et échéance sont obligatoires.'); return
    }
    setBusy(true)
    const { error } = await supabase.from('gaz_promo_receptions').insert({
      station_id: stationId, report_date: form.report_date,
      lignes: lignesValides.map(l => ({ taille: l.taille, quantite: numFR(l.quantite), prix_vente_unitaire: numFR(l.prix_vente_unitaire) })),
      montant_retour_fournisseur: numFR(form.montant_retour_fournisseur), date_echeance: form.date_echeance,
      note: form.note || null, photo_path: form.photo_path, created_by: session.user.id,
    })
    setBusy(false)
    if (error) { fail(error); return }
    setForm(blankForm()); setLignes([blankLigne()]); setShowForm(false); flash('Réception déclarée'); load()
  }

  async function marquerReglee(r) {
    const { error } = await supabase.from('gaz_promo_receptions').update({ statut: 'regle', regle_le: today() }).eq('id', r.id)
    if (error) { fail(error); return }
    load()
  }

  const enAttente = receptions.filter(r => r.statut === 'a_regler')
  const columns = [
    { key: 'date', header: 'Reçu le', render: r => frDate(r.report_date) },
    { key: 'types', header: 'Types reçus', render: r => receptionResume(r) },
    { key: 'qte', header: 'Qté totale', numeric: true, align: 'right', render: r => receptionQte(r) },
    { key: 'valeur', header: 'Valeur stock', numeric: true, align: 'right', render: r => fcfa(receptionValeur(r)) },
    { key: 'retour', header: 'À retourner (NCE)', numeric: true, align: 'right', render: r => fcfa(r.montant_retour_fournisseur) },
    { key: 'echeance', header: 'Échéance', render: r => <span style={{ color: r.statut === 'a_regler' && r.date_echeance < today() ? 'var(--state-alarm)' : 'var(--text-body)' }}>{frDate(r.date_echeance)}</span> },
    { key: 'statut', header: 'Statut', render: r => <Badge tone={r.statut === 'regle' ? 'ok' : (r.date_echeance < today() ? 'alarm' : 'warn')}>{r.statut === 'regle' ? 'Réglée' : 'À régler'}</Badge> },
    { key: 'photo', header: '', render: r => r.photo_path ? <PhotoLink path={r.photo_path}>Bon</PhotoLink> : null },
    { key: 'actions', header: '', align: 'right', render: r => (peutRegler && r.statut === 'a_regler') ? <Button size="sm" onClick={() => marquerReglee(r)}>Marquer réglée</Button> : null },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <div>
        <Button tone={showForm ? 'dark' : 'primary'} icon="plus" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Annuler' : 'Réception gaz promo (dépôt-vente)'}
        </Button>
      </div>

      {showForm && (
        <Panel title="Déclarer une réception de gaz promo (dépôt-vente)">
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
            Une même livraison peut contenir plusieurs types de bouteilles — ajoutez une ligne par type. Une partie de la valeur doit retourner au fournisseur par note de crédit (NCE), à l'échéance indiquée sur son bon.
          </p>
          <form onSubmit={declarer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <Field label="Reçu le" style={{ maxWidth: 180 }}>
              <Input type="date" value={form.report_date} max={today()} onChange={e => setForm(p => ({ ...p, report_date: e.target.value }))} />
            </Field>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {lignes.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'end', padding: 'var(--sp-3)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)' }}>
                  <Field label="Type" style={{ flex: '1 1 120px' }}>
                    <Select value={l.taille} onChange={e => setLigne(i, { taille: e.target.value })} options={TAILLES.map(([v, lb]) => ({ value: v, label: lb }))} style={{ width: '100%' }} />
                  </Field>
                  <Field label="Quantité (bouteilles)" style={{ flex: '1 1 140px' }}>
                    <Input type="text" inputMode="numeric" numeric value={l.quantite} onChange={e => setLigne(i, { quantite: e.target.value })} />
                  </Field>
                  <Field label="Prix de vente unitaire" style={{ flex: '1 1 160px' }}>
                    <Input type="text" inputMode="decimal" numeric value={l.prix_vente_unitaire} onChange={e => setLigne(i, { prix_vente_unitaire: e.target.value })} />
                  </Field>
                  {ligneValeur(l) > 0 && <span style={{ font: '600 14px/1.3 var(--font-ui)', alignSelf: 'center' }}>{fcfa(ligneValeur(l))}</span>}
                  {lignes.length > 1 && <Button type="button" size="sm" tone="danger" onClick={() => retirerLigne(i)}>Retirer</Button>}
                </div>
              ))}
              <Button type="button" size="sm" onClick={ajouterLigne} style={{ alignSelf: 'flex-start' }}>+ Ajouter un type</Button>
            </div>

            {valeurTotale > 0 && <p style={{ font: '600 15px/1.3 var(--font-ui)', margin: 0 }}>Valeur totale du stock reçu : {fcfa(valeurTotale)}</p>}

            <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <Field label="Montant total à retourner au fournisseur (NCE)" style={{ flex: '1 1 220px' }}>
                <Input type="text" inputMode="decimal" numeric value={form.montant_retour_fournisseur} onChange={e => setForm(p => ({ ...p, montant_retour_fournisseur: e.target.value }))} />
              </Field>
              <Field label="Échéance de la NCE" style={{ flex: '1 1 160px' }}>
                <Input type="date" value={form.date_echeance} onChange={e => setForm(p => ({ ...p, date_echeance: e.target.value }))} />
              </Field>
            </div>
            <Field label="Note (optionnelle)">
              <Input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="ex : référence du bon fournisseur" />
            </Field>
            <EvidenceUpload disabled={photoBusy} multiple={false} label={photoBusy ? 'Envoi…' : form.photo_path ? 'Bon/NCE ✓ (reprendre)' : 'Joindre le bon / la NCE'} onFiles={files => files[0] && onPhoto(files[0])} />
            <Button type="submit" tone="primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Enregistrement…' : 'Déclarer la réception'}</Button>
          </form>
        </Panel>
      )}

      {enAttente.length > 0 && (
        <AlertBanner tone="warn" title={`${enAttente.length} NCE gaz promo à régler`}>
          Suivi des échéances — Finance peut marquer une NCE réglée une fois le prélèvement confirmé.
        </AlertBanner>
      )}

      <Panel title="Réceptions de gaz promo" meta={`${receptions.length}`} flush>
        {receptions.length ? <DataTable columns={columns} rows={receptions} /> : <PanelEmpty icon="package" label="Aucune réception déclarée" />}
      </Panel>
    </div>
  )
}
