import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate, today } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? Number(v) : 0)
const TOL = 200        // tolérance FCFA (timbre) pour l'appariement
const WIN = 7          // fenêtre en jours

export default function BankRecon() {
  const { session } = useAuth()
  const { stationId } = useStation()
  const [deposits, setDeposits] = useState([])
  const [bank, setBank] = useState([])
  const [nl, setNl] = useState({ date_operation: today(), montant: '', reference: '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  async function load() {
    if (!stationId) return
    setDeposits((await supabase.from('deposits').select('*').eq('station_id', stationId).order('deposit_date', { ascending: false })).data || [])
    setBank((await supabase.from('bank_lines').select('*').eq('station_id', stationId).order('date_operation', { ascending: false })).data || [])
  }
  useEffect(() => { load() }, [stationId])

  async function addLine(e) {
    e.preventDefault(); setErr('')
    if (!nl.montant) return
    const { error } = await supabase.from('bank_lines').insert({
      station_id: stationId, date_operation: nl.date_operation, montant: Number(nl.montant),
      reference: nl.reference || null, created_by: session.user.id })
    if (error) setErr(error.message)
    else { setNl({ date_operation: today(), montant: '', reference: '' }); setMsg('Ligne ajoutée'); setTimeout(() => setMsg(''), 2000); load() }
  }
  async function delLine(id) { await supabase.from('bank_lines').delete().eq('id', id); load() }

  // Appariement glouton : chaque ligne bancaire ↔ un versement déclaré (montant ± TOL, date ± WIN j)
  const recon = useMemo(() => {
    const deps = deposits.map(d => ({ ...d, _used: false }))
    const matched = [], unmatchedBank = []
    for (const b of bank) {
      const bd = b.date_operation
      let hit = null
      for (const d of deps) {
        if (d._used) continue
        const dd = d.deposit_date || d.report_date
        const days = Math.abs((new Date(bd) - new Date(dd)) / 86400000)
        if (Math.abs(N(b.montant) - N(d.montant)) <= TOL && days <= WIN) { hit = d; break }
      }
      if (hit) { hit._used = true; matched.push({ bank: b, dep: hit }) }
      else unmatchedBank.push(b)
    }
    const unmatchedDep = deps.filter(d => !d._used)
    return { matched, unmatchedBank, unmatchedDep }
  }, [deposits, bank])

  const totDecl = deposits.reduce((s, d) => s + N(d.montant), 0)
  const totBank = bank.reduce((s, b) => s + N(b.montant), 0)
  const nbNonRapproches = recon.unmatchedDep.length + recon.unmatchedBank.length

  const depColumns = [
    { key: 'deposit_date', header: 'Date', render: r => frDate(r.deposit_date) },
    { key: 'pole', header: 'Pôle' },
    { key: 'montant', header: 'Montant', numeric: true, align: 'right', render: r => <span style={{ color: 'var(--state-alarm)' }}>{fcfa(r.montant)}</span> },
    { key: 'ref_bordereau', header: 'Réf', muted: true, render: r => r.ref_bordereau || '—' },
  ]
  const bankColumns = [
    { key: 'date_operation', header: 'Date', render: r => frDate(r.date_operation) },
    { key: 'montant', header: 'Montant', numeric: true, align: 'right', render: r => fcfa(r.montant) },
    { key: 'reference', header: 'Réf', muted: true, render: r => r.reference || '—' },
    { key: 'actions', header: '', align: 'right', render: r => <Button size="sm" tone="danger" onClick={() => delLine(r.id)}>Suppr.</Button> },
  ]
  const matchedColumns = [
    { key: 'date_banque', header: 'Date banque', render: m => frDate(m.bank.date_operation) },
    { key: 'montant_banque', header: 'Montant banque', numeric: true, align: 'right', render: m => fcfa(m.bank.montant) },
    { key: 'versement', header: '↔ Versement déclaré', render: m => `${frDate(m.dep.deposit_date || m.dep.report_date)} · ${m.dep.pole}` },
    { key: 'montant_declare', header: 'Montant déclaré', numeric: true, align: 'right', render: m => fcfa(m.dep.montant) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        <Kpi label="Versements déclarés" value={fcfa(totDecl)} />
        <Kpi label="Crédits relevé banque" value={fcfa(totBank)} />
        <Kpi label="Rapprochés" value={recon.matched.length} status="ok" />
        <Kpi label="Non rapprochés" value={nbNonRapproches} status={nbNonRapproches > 0 ? 'alarm' : 'ok'} />
      </div>

      <Panel title="Saisir une ligne du relevé BOA">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Reporte chaque crédit du relevé bancaire (date, montant). Le pointage est automatique.
        </p>
        <form onSubmit={addLine} style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'end' }}>
          <Field label="Date opération" style={{ flex: '1 1 150px' }}>
            <Input type="date" value={nl.date_operation} onChange={e => setNl({ ...nl, date_operation: e.target.value })} />
          </Field>
          <Field label="Montant crédité" style={{ flex: '1 1 150px' }}>
            <Input type="number" inputMode="decimal" numeric value={nl.montant} onChange={e => setNl({ ...nl, montant: e.target.value })} />
          </Field>
          <Field label="Référence" style={{ flex: '1 1 150px' }}>
            <Input value={nl.reference} onChange={e => setNl({ ...nl, reference: e.target.value })} />
          </Field>
          <Button type="submit" tone="primary">Ajouter la ligne</Button>
        </form>
      </Panel>

      <Panel title="Versements déclarés SANS crédit en banque" meta={`${recon.unmatchedDep.length}`} status="alarm" flush>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
          Argent déclaré versé par le gérant, mais introuvable sur le relevé → à vérifier en priorité.
        </p>
        <div style={{ marginTop: 'var(--sp-4)' }}>
          {recon.unmatchedDep.length ? <DataTable columns={depColumns} rows={recon.unmatchedDep} /> : <PanelEmpty icon="check" label="Aucun — tout est couvert" />}
        </div>
      </Panel>

      <Panel title="Crédits en banque SANS versement déclaré" meta={`${recon.unmatchedBank.length}`} status="warn" flush>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
          Argent arrivé en banque non déclaré dans un point → à rattacher.
        </p>
        <div style={{ marginTop: 'var(--sp-4)' }}>
          {recon.unmatchedBank.length ? <DataTable columns={bankColumns} rows={recon.unmatchedBank} /> : <PanelEmpty icon="landmark" label="Aucun" />}
        </div>
      </Panel>

      <Panel title="Rapprochés" meta={`${recon.matched.length}`} status="ok" flush>
        {recon.matched.length
          ? <DataTable columns={matchedColumns} rows={recon.matched.map((m, i) => ({ ...m, id: i }))} />
          : <PanelEmpty icon="landmark" label="Rien encore rapproché" />}
      </Panel>
    </div>
  )
}
