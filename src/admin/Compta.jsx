import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { usePlateforme, STATUT_FACTURE } from '../lib/plateforme'
import { fcfa, frDate, today } from '../lib/format'
import { exportRowsToCsv } from '../lib/csv'
import { etatClient, moisDe, libelleMois, derniersMois } from './outils'
import FactureSheet from '../components/FactureSheet.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { NumericStepper } from '../ds/pumpit/components/forms/NumericStepper.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'
import { MetricTile } from '../ds/pumpit/components/data/MetricTile.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { Drawer } from '../ds/pumpit/components/feedback/Drawer.jsx'

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const jours = (iso) => Math.floor((new Date(today()) - new Date(iso)) / 86400000)
const somme = (liste, cle = 'montant_ttc') => liste.reduce((s, f) => s + Number(f[cle] || 0), 0)

// Comptabilité de la plateforme : ce qui est facturé, encaissé et dû, d'après les factures.
// Tous les montants sont TTC. Les factures annulées ne comptent nulle part.
export default function Compta() {
  const emetteur = usePlateforme()
  const [factures, setFactures] = useState([])
  const [orgs, setOrgs] = useState([])
  const [formules, setFormules] = useState([])
  const [annee, setAnnee] = useState(today().slice(0, 4))
  const [mois, setMois] = useState(today().slice(5, 7))        // '' = toute l'année
  const [filtre, setFiltre] = useState('toutes')
  const [emission, setEmission] = useState({ org: '', debut: today().slice(0, 8) + '01', mois: 1 })
  const [encaisse, setEncaisse] = useState(null)
  const [aImprimer, setAImprimer] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const fail = (e) => { setMsg(''); setErr(e?.message || String(e)) }
  const ok = (m) => { setErr(''); setMsg(m) }

  async function load() {
    const [f, o, p] = await Promise.all([
      supabase.from('factures').select('*').order('date_emission', { ascending: false }).order('id', { ascending: false }).limit(5000),
      supabase.from('organisations').select('*').order('nom'),
      supabase.from('formules').select('*'),
    ])
    setFactures(f.data || []); setOrgs(o.data || []); setFormules(p.data || [])
  }
  useEffect(() => { load() }, [])

  const nomClient = useMemo(() => Object.fromEntries(orgs.map(o => [o.id, o.nom])), [orgs])
  const dansPeriode = (iso) => !!iso && iso.startsWith(annee) && (!mois || iso.slice(5, 7) === mois)
  const valides = factures.filter(f => f.statut !== 'annulee')

  const emises = valides.filter(f => dansPeriode(f.date_emission))
  const encaissees = valides.filter(f => f.statut === 'payee' && dansPeriode(f.paye_le))
  const dues = valides.filter(f => f.statut === 'emise')
  // Revenu mensuel récurrent : prix de l'offre des clients actifs et payants (hors essai, hors suspendus).
  const prixDe = Object.fromEntries(formules.map(f => [f.key, Number(f.prix_mensuel || 0)]))
  const payants = orgs.filter(o => ['actif', 'retard'].includes(etatClient(o, emetteur).cle) && prixDe[o.formule] > 0)
  const mrr = payants.reduce((s, o) => s + prixDe[o.formule], 0)

  const douze = derniersMois(12).map(m => ({
    mois: libelleMois(m),
    Facturé: somme(valides.filter(f => moisDe(f.date_emission) === m)),
    Encaissé: somme(valides.filter(f => f.statut === 'payee' && moisDe(f.paye_le) === m)),
  }))

  const balance = Object.values(dues.reduce((acc, f) => {
    const l = acc[f.organisation_id] || (acc[f.organisation_id] = { id: f.organisation_id, client: nomClient[f.organisation_id] || 'Client supprimé', a: 0, b: 0, c: 0, total: 0 })
    const j = jours(f.date_emission); const m = Number(f.montant_ttc)
    if (j <= 30) l.a += m; else if (j <= 60) l.b += m; else l.c += m
    l.total += m
    return acc
  }, {})).sort((x, y) => y.total - x.total)

  const parMode = Object.entries(encaissees.reduce((acc, f) => { const k = f.mode_paiement || 'Non précisé'; acc[k] = (acc[k] || 0) + Number(f.montant_ttc); return acc }, {}))
    .map(([mode, montant]) => ({ id: mode, mode, montant, nb: encaissees.filter(f => (f.mode_paiement || 'Non précisé') === mode).length })).sort((x, y) => y.montant - x.montant)

  const journal = factures.filter(f => dansPeriode(f.date_emission) && (filtre === 'toutes' || f.statut === filtre))
  const libellePeriode = (mois ? MOIS[Number(mois) - 1] + ' ' : '') + annee

  function exporter() {
    exportRowsToCsv(`factures-pumpit-${annee}${mois ? '-' + mois : ''}.csv`,
      [['Numéro', 'numero'], ['Client', 'client'], ['Émise le', 'date_emission'], ['Début', 'periode_debut'], ['Fin', 'periode_fin'], ['Offre', 'formule'],
       ['Montant HT', 'montant_ht'], ['TVA', 'montant_tva'], ['Montant TTC', 'montant_ttc'], ['État', 'etat'], ['Payée le', 'paye_le'], ['Mode', 'mode_paiement'], ['Référence', 'reference_paiement']],
      journal.map(f => ({ ...f, client: nomClient[f.organisation_id] || '', etat: (STATUT_FACTURE[f.statut] || {}).label, montant_ht: Number(f.montant_ht), montant_tva: Number(f.montant_tva), montant_ttc: Number(f.montant_ttc) })))
  }

  async function emettre(e) {
    e.preventDefault()
    if (!emission.org) return fail('Choisissez le client à facturer.')
    setBusy(true)
    const { data, error } = await supabase.rpc('emettre_facture', { p_org: Number(emission.org), p_debut: emission.debut, p_mois: emission.mois })
    setBusy(false)
    if (error) return fail(error)
    ok(`Facture ${data.numero} émise : ${fcfa(data.montant_ttc)}.`); load()
  }
  async function encaisser(e) {
    e.preventDefault()
    const { error } = await supabase.rpc('encaisser_facture', { p_facture: encaisse.id, p_date: encaisse.date, p_mode: encaisse.mode, p_reference: encaisse.reference })
    if (error) return fail(error)
    setEncaisse(null); ok('Paiement enregistré. Abonnement prolongé, client actif.'); load()
  }
  async function annuler(f) {
    const { error } = await supabase.rpc('annuler_facture', { p_facture: f.id })
    if (error) return fail(error)
    ok(`Facture ${f.numero} annulée.`); load()
  }

  const orgChoisie = orgs.find(o => String(o.id) === String(emission.org))
  const montantEmission = orgChoisie ? (prixDe[orgChoisie.formule] || 0) * emission.mois : 0
  const annees = [...new Set([today().slice(0, 4), ...factures.map(f => f.date_emission.slice(0, 4))])].sort().reverse()

  const cols = [
    { key: 'numero', header: 'Facture', render: f => <b style={{ fontWeight: 600 }}>{f.numero}</b> },
    { key: 'client', header: 'Client', render: f => nomClient[f.organisation_id] || '—' },
    { key: 'date_emission', header: 'Émise le', optional: '1', muted: true, render: f => frDate(f.date_emission) },
    { key: 'periode', header: 'Période', optional: '2', muted: true, render: f => `${frDate(f.periode_debut)} au ${frDate(f.periode_fin)}` },
    { key: 'montant_ttc', header: 'Montant', numeric: true, align: 'right', render: f => fcfa(f.montant_ttc) },
    { key: 'statut', header: 'État', render: f => { const s = STATUT_FACTURE[f.statut] || STATUT_FACTURE.emise; return <Badge tone={s.tone}>{s.label}</Badge> } },
    { key: 'paye', header: 'Paiement', optional: '2', muted: true, render: f => f.statut === 'payee' ? `${frDate(f.paye_le)}${f.mode_paiement ? ', ' + f.mode_paiement : ''}` : '—' },
    { key: 'action', header: '', align: 'right', render: f => (
      <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
        {f.statut === 'emise' && <Button size="sm" tone="dark" onClick={() => setEncaisse({ id: f.id, numero: f.numero, montant: f.montant_ttc, date: today(), mode: 'Mobile Money', reference: '' })}>Encaisser</Button>}
        <Button size="sm" icon="printer" onClick={() => setAImprimer(f)}>Imprimer</Button>
        {f.statut === 'emise' && <Button size="sm" tone="ghost" onClick={() => annuler(f)}>Annuler</Button>}
      </span>) },
  ]
  const tooltip = { background: 'var(--surface-panel)', border: 0, borderRadius: 'var(--radius-1)', boxShadow: 'var(--shadow-pop)', font: '13px var(--font-ui)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')}>{msg}</AlertBanner>}

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <Select aria-label="Année" value={annee} onChange={e => setAnnee(e.target.value)} options={annees} />
        <Select aria-label="Mois" value={mois} onChange={e => setMois(e.target.value)} options={[{ value: '', label: 'Toute l\'année' }, ...MOIS.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))]} />
      </div>

      <div className="pi-bo-kpis">
        <MetricTile label={`Facturé, ${libellePeriode}`} value={fcfa(somme(emises))} sub={`${emises.length} facture${emises.length > 1 ? 's' : ''}${somme(emises, 'montant_tva') ? ', dont TVA ' + fcfa(somme(emises, 'montant_tva')) : ''}`} />
        <MetricTile label={`Encaissé, ${libellePeriode}`} value={fcfa(somme(encaissees))} sub={`${encaissees.length} paiement${encaissees.length > 1 ? 's' : ''}`} status="ok" />
        <MetricTile label="Reste à encaisser" value={fcfa(somme(dues))} sub={`${dues.length} facture${dues.length > 1 ? 's' : ''}, toutes périodes`} status={dues.length ? 'warn' : undefined} />
        <MetricTile label="Revenu mensuel récurrent" value={fcfa(mrr)} sub={`${payants.length} client${payants.length > 1 ? 's' : ''} payant${payants.length > 1 ? 's' : ''}, hors essai`} />
      </div>

      <Panel title="Facturé et encaissé" meta="12 derniers mois">
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={douze} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="mois" fontSize={12} stroke="var(--ardoise)" tickLine={false} axisLine={false} />
              <YAxis fontSize={12} stroke="var(--ardoise)" tickLine={false} axisLine={false} width={64} tickFormatter={v => v >= 1000 ? Math.round(v / 1000) + ' k' : v} />
              <Tooltip formatter={v => fcfa(v)} contentStyle={tooltip} cursor={{ fill: 'var(--brume)' }} />
              <Legend wrapperStyle={{ font: '13px var(--font-ui)' }} />
              <Bar dataKey="Facturé" fill="var(--nuit)" radius={[5, 5, 0, 0]} />
              <Bar dataKey="Encaissé" fill="var(--vert-pump)" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="pi-bo-2col pi-bo-large">
        <Panel title="Impayés par ancienneté" meta="depuis la date d'émission" flush>
          {balance.length ? <DataTable zebra={false} rows={balance} columns={[
            { key: 'client', header: 'Client' },
            { key: 'a', header: '0 à 30 j', numeric: true, align: 'right', render: l => l.a ? fcfa(l.a) : '—' },
            { key: 'b', header: '31 à 60 j', numeric: true, align: 'right', render: l => l.b ? fcfa(l.b) : '—' },
            { key: 'c', header: 'Plus de 60 j', numeric: true, align: 'right', render: l => l.c ? <span style={{ color: 'var(--state-alarm)', fontWeight: 600 }}>{fcfa(l.c)}</span> : '—' },
            { key: 'total', header: 'Total', numeric: true, align: 'right', render: l => <b>{fcfa(l.total)}</b> },
          ]} footer={{ client: 'Total', a: fcfa(somme(balance, 'a')), b: fcfa(somme(balance, 'b')), c: fcfa(somme(balance, 'c')), total: fcfa(somme(balance, 'total')) }} />
            : <PanelEmpty icon="check" label="Aucune facture en attente de règlement." />}
        </Panel>
        <Panel title="Encaissements par mode" meta={libellePeriode} flush>
          {parMode.length ? <DataTable zebra={false} rows={parMode} columns={[
            { key: 'mode', header: 'Mode de paiement' },
            { key: 'nb', header: 'Paiements', numeric: true, align: 'right' },
            { key: 'montant', header: 'Montant', numeric: true, align: 'right', render: l => fcfa(l.montant) },
          ]} footer={{ mode: 'Total', nb: encaissees.length, montant: fcfa(somme(encaissees)) }} />
            : <PanelEmpty icon="wallet" label="Aucun encaissement sur la période." />}
        </Panel>
      </div>

      <Panel title="Émettre une facture">
        <form onSubmit={emettre} style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          <Field label="Client" required style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <Select value={emission.org} onChange={e => { const o = orgs.find(x => String(x.id) === e.target.value); setEmission({ ...emission, org: e.target.value, debut: o?.abonnement_jusqu_au ? new Date(new Date(o.abonnement_jusqu_au + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10) : emission.debut }) }}
              options={[{ value: '', label: 'Choisir…' }, ...orgs.map(o => ({ value: o.id, label: o.nom }))]} style={{ width: '100%' }} />
          </Field>
          <Field label="À partir du"><Input type="date" value={emission.debut} onChange={e => setEmission({ ...emission, debut: e.target.value })} required /></Field>
          <Field label="Nombre de mois"><NumericStepper value={emission.mois} min={1} max={24} onChange={v => setEmission({ ...emission, mois: Math.round(v) || 1 })} /></Field>
          <Button type="submit" tone="primary" disabled={busy || !montantEmission}>{montantEmission ? `Émettre ${fcfa(montantEmission)} HT` : 'Émettre'}</Button>
        </form>
        {orgChoisie && !montantEmission && <p style={{ color: 'var(--text-muted)', margin: 'var(--sp-3) 0 0' }}>L'offre de ce client est gratuite : rien à facturer.</p>}
      </Panel>

      <Panel title="Journal des factures" meta={`${libellePeriode}, ${journal.length}`} flush actions={<Button size="sm" icon="download" disabled={!journal.length} onClick={exporter}>Exporter (CSV)</Button>}>
        <div style={{ padding: '0 var(--gutter-panel) var(--sp-4)' }}>
          <Tabs value={filtre} onChange={setFiltre} items={[{ value: 'toutes', label: 'Toutes' }, { value: 'emise', label: 'À régler' }, { value: 'payee', label: 'Payées' }, { value: 'annulee', label: 'Annulées' }]} style={{ background: 'var(--brume)', borderRadius: 'var(--radius-full)', display: 'inline-flex' }} />
        </div>
        {journal.length ? <DataTable columns={cols} rows={journal} zebra={false} /> : <PanelEmpty icon="receipt" label="Aucune facture sur cette période." />}
      </Panel>

      <Drawer open={!!encaisse} title="Encaisser" meta={encaisse ? `${encaisse.numero} · ${fcfa(encaisse.montant)}` : ''} width={420} onClose={() => setEncaisse(null)}>
        {encaisse && (
          <form onSubmit={encaisser} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <Field label="Payée le" required><Input type="date" value={encaisse.date} onChange={e => setEncaisse({ ...encaisse, date: e.target.value })} required /></Field>
            <Field label="Mode de paiement"><Select value={encaisse.mode} onChange={e => setEncaisse({ ...encaisse, mode: e.target.value })} options={['Mobile Money', 'Virement', 'Espèces', 'Chèque']} style={{ width: '100%' }} /></Field>
            <Field label="Référence" hint="Numéro de transaction, de virement ou de chèque."><Input value={encaisse.reference} onChange={e => setEncaisse({ ...encaisse, reference: e.target.value })} /></Field>
            <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>Valider le paiement</Button>
            <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Le paiement prolonge l'abonnement jusqu'à la fin de la période facturée, réactive le client et met fin à son essai.</p>
          </form>
        )}
      </Drawer>

      <FactureSheet facture={aImprimer} client={orgs.find(o => o.id === aImprimer?.organisation_id)} emetteur={emetteur} onDone={() => setAImprimer(null)} />
    </div>
  )
}
