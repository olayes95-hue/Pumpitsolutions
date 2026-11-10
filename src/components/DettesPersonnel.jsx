import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { fcfa, frDate, today, numFR } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Drawer, DrawerRow } from '../ds/pumpit/components/feedback/Drawer.jsx'

const N = (v) => Number(v) || 0
const POLE_LABEL = { carburant: 'Carburant', gaz_lub: 'Gaz + Lubrifiant', superette: 'Supérette', perte_livraison: 'Perte livraison carburant' }

// Manques de caisse (v_verse_recon, même calcul que l'alerte VERSEMENT_INCOMPLET) et pertes de
// livraison au-delà du seuil de tolérance (v_pertes_livraison.perte_na_montant) — admin/manage_finance
// les attribue manuellement à un chef de piste ou un pompiste de LA STATION COURANTE (jamais
// d'attribution automatique : plusieurs personnes ont pu se relayer sur la période non versée).
//
// Vit dans Finance.jsx (onglet Contrôles), scopé à la station courante et au mois sélectionné —
// pas dans Stations/Équipe : ce sont des écarts financiers à arbitrer mensuellement (1er du mois
// suivant), pas de la gestion d'équipe au jour le jour. Le solde dû (panel "Dettes du personnel")
// reste une vue cumulée (toutes périodes), seule la liste « à attribuer » est filtrée par mois.
export default function DettesPersonnel({ stationId, mois }) {
  const { can, isAdmin } = useAuth()
  const peutGerer = isAdmin || can('manage_finance')
  const [profiles, setProfiles] = useState([])
  const [verseRecon, setVerseRecon] = useState([])
  const [pertes, setPertes] = useState([])
  const [dismissals, setDismissals] = useState([])
  const [dettes, setDettes] = useState([])
  const [soldes, setSoldes] = useState({})
  const [choix, setChoix] = useState({})   // {clefItem: employe_id choisi dans le select}
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [detailDettes, setDetailDettes] = useState([])
  const [detailRemb, setDetailRemb] = useState([])
  const [rb, setRb] = useState({ montant: '', note: '' })

  async function load() {
    if (!stationId) return
    const [p, vr, pl, dis, dp, sc] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role,station_id,approved').eq('station_id', stationId).in('role', ['gerant', 'pompiste']).eq('approved', true).or('plateforme_role.is.null,membre_equipe_malgre_agent.eq.true'),
      supabase.from('v_verse_recon').select('*').eq('station_id', stationId).gt('ecart', 1000),
      supabase.from('v_pertes_livraison').select('*').eq('station_id', stationId).gt('perte_na_montant', 0),
      supabase.from('alert_dismissals').select('station_id,report_date,type').eq('station_id', stationId).in('type', ['VERSEMENT_INCOMPLET', 'PERTE_LIVRAISON_NA']),
      supabase.from('dettes_personnel').select('*').eq('station_id', stationId).order('created_at', { ascending: false }),
      supabase.from('v_dette_personnel').select('*'),
    ])
    setProfiles(p.data || [])
    setVerseRecon(vr.data || []); setPertes(pl.data || [])
    setDismissals(dis.data || []); setDettes(dp.data || [])
    const employesStation = new Set((p.data || []).map(x => x.id))
    const m = {}; for (const x of (sc.data || [])) if (employesStation.has(x.employe_id) || (dp.data || []).some(d => d.employe_id === x.employe_id)) m[x.employe_id] = x
    setSoldes(m)
  }
  useEffect(() => { load() }, [stationId])

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500) }
  const fail = (e) => setErr(e.message || String(e))
  const candidats = () => profiles

  const dismissed = (reportDate, type) =>
    dismissals.some(d => d.report_date === reportDate && d.type === type)
  const attribue = (poleGroupe, periodeDebut, periodeFin, fuelOrderId) => dettes.some(d =>
    fuelOrderId != null ? d.fuel_order_id === fuelOrderId
      : d.pole_groupe === poleGroupe && d.periode_debut === periodeDebut && d.periode_fin === periodeFin
  )

  // Liste « à attribuer » limitée au mois sélectionné (vide = toute l'année, comme ailleurs dans
  // Finance) — l'attribution se fait mois par mois, typiquement le 1er du mois suivant.
  const dansLeMois = (dateStr) => !mois || (dateStr || '').slice(0, 7) === mois
  const aAttribuerVerse = verseRecon.filter(v => dansLeMois(v.periode_fin) && !dismissed(v.periode_fin, 'VERSEMENT_INCOMPLET')
    && !attribue(v.pole_groupe, v.periode_debut, v.periode_fin, null))
  const aAttribuerPerte = pertes.filter(p => dansLeMois(p.report_date) && !dismissed(p.report_date, 'PERTE_LIVRAISON_NA')
    && !attribue('perte_livraison', p.report_date, p.report_date, p.id))

  async function attribuerVerse(v, clef) {
    const employeId = choix[clef]
    if (!employeId) { setErr('Choisissez un employé.'); return }
    const { error } = await supabase.from('dettes_personnel').insert({
      station_id: stationId, employe_id: employeId, pole_groupe: v.pole_groupe,
      periode_debut: v.periode_debut, periode_fin: v.periode_fin, montant: Math.round(v.ecart),
    })
    if (error) { fail(error); return }
    flash('Dette attribuée'); load()
  }
  async function attribuerPerte(p, clef) {
    const employeId = choix[clef]
    if (!employeId) { setErr('Choisissez un employé.'); return }
    const { error } = await supabase.from('dettes_personnel').insert({
      station_id: stationId, employe_id: employeId, pole_groupe: 'perte_livraison',
      periode_debut: p.report_date, periode_fin: p.report_date, fuel_order_id: p.id, montant: Math.round(p.perte_na_montant),
      note: `${p.produit} — perte ${N(p.perte_na_litres).toFixed(0)} L au-delà du seuil de tolérance`,
    })
    if (error) { fail(error); return }
    flash('Dette attribuée'); load()
  }
  async function ignorerVerse(v) {
    const { error } = await supabase.from('alert_dismissals').insert({ station_id: stationId, report_date: v.periode_fin, type: 'VERSEMENT_INCOMPLET' })
    if (error) { fail(error); return }
    load()
  }
  async function ignorerPerte(p) {
    const { error } = await supabase.from('alert_dismissals').insert({ station_id: stationId, report_date: p.report_date, type: 'PERTE_LIVRAISON_NA' })
    if (error) { fail(error); return }
    load()
  }

  async function openDetail(employeId) {
    setDetailId(employeId); setRb({ montant: '', note: '' }); setErr('')
    const [d, r] = await Promise.all([
      supabase.from('dettes_personnel').select('*').eq('employe_id', employeId).order('periode_fin', { ascending: false }),
      supabase.from('dettes_personnel_remboursements').select('*').eq('employe_id', employeId).order('report_date', { ascending: false }),
    ])
    setDetailDettes(d.data || []); setDetailRemb(r.data || [])
  }
  async function addRemboursement(e) {
    e.preventDefault(); setErr('')
    if (!N(rb.montant)) return
    const detail = detailDettes[0]
    const { error } = await supabase.from('dettes_personnel_remboursements').insert({
      employe_id: detailId, station_id: detail?.station_id || profileById(detailId)?.station_id || stationId,
      report_date: today(), montant: numFR(rb.montant), note: rb.note || null,
    })
    if (error) { setErr(error.message); return }
    setRb({ montant: '', note: '' })
    await Promise.all([load(), openDetail(detailId)])
  }
  const profileById = (id) => profiles.find(p => p.id === id)

  const employesConnus = [...new Set([...Object.keys(soldes), ...dettes.map(d => d.employe_id)])]
  const employeNom = (id) => profileById(id)?.full_name || id

  if (!peutGerer) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      {(aAttribuerVerse.length > 0 || aAttribuerPerte.length > 0) && (
        <Panel title="Manques de caisse et pertes à attribuer" meta={`${aAttribuerVerse.length + aAttribuerPerte.length}${mois ? ' · ' + mois : ''}`} status="warn" flush>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', margin: 'var(--sp-4) var(--gutter-panel)' }}>
            {aAttribuerVerse.map(v => {
              const clef = `v-${v.pole_groupe}-${v.periode_debut}-${v.periode_fin}`
              return (
                <div key={clef} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  <p style={{ font: '600 14px/1.4 var(--font-ui)', margin: 0 }}>{fcfa(v.ecart)} — {POLE_LABEL[v.pole_groupe] || v.pole_groupe}</p>
                  <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Période {frDate(v.periode_debut)} → {frDate(v.periode_fin)} — espèces {fcfa(v.recette_periode)}, dépenses {fcfa(v.depense_periode)}, versé {fcfa(v.verse)}</p>
                  <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Select size="sm" value={choix[clef] || ''} onChange={e => setChoix(c => ({ ...c, [clef]: e.target.value }))} style={{ minWidth: 220 }}
                      options={[{ value: '', label: '— choisir un employé —' }, ...candidats().map(p => ({ value: p.id, label: `${p.full_name} (${p.role === 'gerant' ? 'Chef de piste' : 'Pompiste'})` }))]} />
                    <Button size="sm" tone="dark" onClick={() => attribuerVerse(v, clef)}>Attribuer</Button>
                    <Button size="sm" onClick={() => ignorerVerse(v)}>Ignorer</Button>
                  </div>
                </div>
              )
            })}
            {aAttribuerPerte.map(p => {
              const clef = `p-${p.id}`
              return (
                <div key={clef} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  <p style={{ font: '600 14px/1.4 var(--font-ui)', margin: 0 }}>{fcfa(p.perte_na_montant)} — Perte livraison {p.produit}</p>
                  <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>{frDate(p.report_date)} — manquant {N(p.perte_litres).toFixed(0)} L, dont {N(p.perte_na_litres).toFixed(0)} L au-delà du seuil de tolérance ({N(p.seuil_acceptable).toFixed(0)} L acceptables)</p>
                  <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Select size="sm" value={choix[clef] || ''} onChange={e => setChoix(c => ({ ...c, [clef]: e.target.value }))} style={{ minWidth: 220 }}
                      options={[{ value: '', label: '— choisir un employé —' }, ...candidats().map(pr => ({ value: pr.id, label: `${pr.full_name} (${pr.role === 'gerant' ? 'Chef de piste' : 'Pompiste'})` }))]} />
                    <Button size="sm" tone="dark" onClick={() => attribuerPerte(p, clef)}>Attribuer</Button>
                    <Button size="sm" onClick={() => ignorerPerte(p)}>Ignorer</Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      )}

      <Panel title="Dettes du personnel" meta={`${employesConnus.length}`} flush>
        {employesConnus.length ? (
          <DataTable columns={[
            { key: 'nom', header: 'Employé', render: id => employeNom(id) },
            { key: 'du', header: 'Montant dû', align: 'right', render: id => fcfa(soldes[id]?.total_du || 0) },
            { key: 'remb', header: 'Remboursé', align: 'right', render: id => fcfa(soldes[id]?.total_rembourse || 0) },
            { key: 'reste', header: 'Reste dû', align: 'right', render: id => <b style={{ color: N(soldes[id]?.solde_du) > 0 ? 'var(--state-warn)' : 'var(--state-ok)' }}>{fcfa(soldes[id]?.solde_du || 0)}</b> },
            { key: 'actions', header: '', align: 'right', render: id => <Button size="sm" onClick={() => openDetail(id)}>Voir</Button> },
          ]} rows={employesConnus} />
        ) : <PanelEmpty icon="users" label="Aucune dette enregistrée" />}
      </Panel>

      <Drawer open={!!detailId} onClose={() => setDetailId(null)} title={employeNom(detailId)}
        meta={`Reste dû : ${fcfa(soldes[detailId]?.solde_du || 0)}`} status={N(soldes[detailId]?.solde_du) > 0 ? 'warn' : 'ok'}>
        <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: '0 0 var(--sp-2)' }}>Dettes attribuées</p>
        {detailDettes.length
          ? detailDettes.map(d => <DrawerRow key={d.id} mono={false} label={`${frDate(d.periode_fin)} — ${POLE_LABEL[d.pole_groupe] || d.pole_groupe}`} value={fcfa(d.montant)} />)
          : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Aucune dette.</p>}

        <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: 'var(--sp-5) 0 var(--sp-2)' }}>Remboursements reçus</p>
        {detailRemb.length
          ? detailRemb.map(r => <DrawerRow key={r.id} mono={false} status="ok" label={`${frDate(r.report_date)}${r.note ? ' · ' + r.note : ''}`} value={fcfa(r.montant)} />)
          : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Aucun remboursement reçu.</p>}

        <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: 'var(--sp-5) 0 var(--sp-2)' }}>Enregistrer un remboursement</p>
        <form onSubmit={addRemboursement} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <Field label="Montant reçu" required>
            <Input type="text" inputMode="decimal" numeric value={rb.montant} onChange={e => setRb(p => ({ ...p, montant: e.target.value }))} />
          </Field>
          <Field label="Note"><Input value={rb.note} onChange={e => setRb(p => ({ ...p, note: e.target.value }))} placeholder="ex : retenue sur salaire, versement espèces…" /></Field>
          <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
        </form>
      </Drawer>
    </div>
  )
}
