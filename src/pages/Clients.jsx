import { useEffect, useState } from 'react'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, today, numFR } from '../lib/format'
import { uploadEvidence } from '../lib/image'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Drawer, DrawerRow } from '../ds/pumpit/components/feedback/Drawer.jsx'
import { PhotoThumb } from '../lib/photos.jsx'

const N = (v) => Number(v) || 0

export default function Clients() {
  const { stationId } = useStation()
  const [list, setList] = useState([])        // clients de la station
  const [soldes, setSoldes] = useState({})     // {client_id: solde_du} — v_solde_client
  const [f, setF] = useState({ nom: '', telephone: '' })
  const [err, setErr] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [depenses, setDepenses] = useState([])         // dépenses attribuées au client ouvert
  const [remboursements, setRemboursements] = useState([])
  const [rb, setRb] = useState({ montant: '', note: '', photo_path: null })
  const [rbPhotoBusy, setRbPhotoBusy] = useState(false)
  const [rbErr, setRbErr] = useState('')

  async function load() {
    if (!stationId) return
    const [c, s] = await Promise.all([
      supabase.from('clients').select('*').eq('station_id', stationId).order('nom'),
      supabase.from('v_solde_client').select('client_id,solde_du').eq('station_id', stationId),
    ])
    setList(c.data || [])
    const m = {}; for (const x of (s.data || [])) m[x.client_id] = N(x.solde_du); setSoldes(m)
  }
  useEffect(() => { load() }, [stationId])

  async function add(e) {
    e.preventDefault(); setErr('')
    if (!f.nom.trim()) return
    const { error } = await supabase.from('clients').insert({ station_id: stationId, nom: f.nom.trim(), telephone: f.telephone || null })
    if (error) setErr(error.message)
    else { setF({ nom: '', telephone: '' }); load() }
  }
  async function toggleActif(c) {
    await supabase.from('clients').update({ actif: !c.actif }).eq('id', c.id); load()
  }

  async function openDetail(c) {
    setDetailId(c.id); setRb({ montant: '', note: '', photo_path: null }); setRbErr('')
    const [d, r] = await Promise.all([
      supabase.from('expenses').select('report_date,categorie,montant,motif').eq('client_id', c.id).order('report_date', { ascending: false }),
      supabase.from('client_remboursements').select('*').eq('client_id', c.id).order('report_date', { ascending: false }),
    ])
    setDepenses(d.data || []); setRemboursements(r.data || [])
  }
  async function handleRbPhoto(file) {
    if (!file) return
    setRbPhotoBusy(true)
    try { const path = await uploadEvidence(supabase, BORDEREAUX_BUCKET, `${stationId}/remboursements/${detailId}`, file); setRb(p => ({ ...p, photo_path: path })) }
    catch (e) { setRbErr(`Échec de l'envoi de la photo : ${e.message || e}.`) }
    finally { setRbPhotoBusy(false) }
  }
  async function addRemboursement(e) {
    e.preventDefault(); setRbErr('')
    if (!N(rb.montant)) return
    const { error } = await supabase.from('client_remboursements').insert({
      client_id: detailId, station_id: stationId, report_date: today(),
      montant: numFR(rb.montant), note: rb.note || null, photo_path: rb.photo_path,
    })
    if (error) { setRbErr(error.message); return }
    const c = list.find(x => x.id === detailId)
    setRb({ montant: '', note: '', photo_path: null })
    await Promise.all([load(), openDetail(c)])
  }

  const columns = [
    { key: 'nom', header: 'Nom' },
    { key: 'telephone', header: 'Téléphone', muted: true, render: r => r.telephone || '—' },
    { key: 'solde', header: 'Solde dû', align: 'right', render: r => (
        <span style={{ color: soldes[r.id] > 0 ? 'var(--state-warn)' : 'var(--text-muted)', fontWeight: 600 }}>{fcfa(soldes[r.id] || 0)}</span>
      ) },
    { key: 'actif', header: 'Actif', render: r => <Checkbox checked={r.actif} onChange={() => toggleActif(r)} /> },
    { key: 'actions', header: '', align: 'right', render: r => <Button size="sm" onClick={() => openDetail(r)}>Voir</Button> },
  ]
  const detail = list.find(c => c.id === detailId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <Panel title="Ajouter un client à crédit">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Sociétés ou particuliers auxquels du carburant (ou un autre pôle) est donné sans encaissement, à charge pour eux de rembourser plus tard. Ces dépenses sont saisies au jour le jour par le chef de piste (Dépenses en espèces → Bénéficiaire).
        </p>
        {err && <AlertBanner tone="alarm" title="Erreur" style={{ marginBottom: 'var(--sp-4)' }}>{err}</AlertBanner>}
        <form onSubmit={add} style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Nom" required style={{ flex: '1 1 220px' }}>
            <Input value={f.nom} onChange={e => setF({ ...f, nom: e.target.value })} required />
          </Field>
          <Field label="Téléphone" style={{ flex: '1 1 160px' }}>
            <Input value={f.telephone} onChange={e => setF({ ...f, telephone: e.target.value })} />
          </Field>
          <Button type="submit" tone="primary">Ajouter</Button>
        </form>
      </Panel>

      <Panel title="Clients à crédit" meta={`${list.length}`} flush>
        {list.length
          ? <DataTable columns={columns} rows={list} />
          : <PanelEmpty icon="users" label="Aucun client à crédit" />}
      </Panel>

      <Drawer open={!!detailId} onClose={() => setDetailId(null)} title={detail?.nom || ''}
        meta={`Solde dû : ${fcfa(soldes[detailId] || 0)}`} status={soldes[detailId] > 0 ? 'warn' : 'ok'}>
        {detail && <>
          <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: '0 0 var(--sp-2)' }}>Dépenses attribuées</p>
          {depenses.length
            ? depenses.map((d, i) => <DrawerRow key={i} label={`${frDate(d.report_date)} — ${d.categorie}${d.motif ? ' · ' + d.motif : ''}`} mono={false} value={fcfa(d.montant)} />)
            : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Aucune dépense attribuée pour l'instant.</p>}

          <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: 'var(--sp-5) 0 var(--sp-2)' }}>Remboursements reçus</p>
          {remboursements.length
            ? remboursements.map(r => (
                <DrawerRow key={r.id} label={`${frDate(r.report_date)}${r.note ? ' · ' + r.note : ''}`} mono={false} value={fcfa(r.montant)} status="ok" />
              ))
            : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Aucun remboursement reçu pour l'instant.</p>}

          <p style={{ font: '700 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.02em', margin: 'var(--sp-5) 0 var(--sp-2)' }}>Enregistrer un remboursement</p>
          {rbErr && <AlertBanner tone="alarm" title="Erreur" style={{ marginBottom: 'var(--sp-3)' }}>{rbErr}</AlertBanner>}
          <form onSubmit={addRemboursement} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <Field label="Montant reçu" required>
              <Input type="text" inputMode="decimal" numeric value={rb.montant} onChange={e => setRb(p => ({ ...p, montant: e.target.value }))} />
            </Field>
            <Field label="Note"><Input value={rb.note} onChange={e => setRb(p => ({ ...p, note: e.target.value }))} placeholder="ex : versement espèces, chèque…" /></Field>
            <Field label="Photo du justificatif (optionnelle)">
              <Input type="file" accept="image/*" disabled={rbPhotoBusy}
                onChange={e => { const file = e.target.files[0]; e.target.value = ''; if (file) handleRbPhoto(file) }} />
            </Field>
            {rbPhotoBusy && <p style={{ font: '400 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Envoi de la photo…</p>}
            {rb.photo_path && !rbPhotoBusy && <PhotoThumb path={rb.photo_path} label="Justificatif" status="none" size={64} />}
            <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
          </form>
        </>}
      </Drawer>
    </div>
  )
}
