import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { usePlateforme, STATUT_FACTURE } from '../lib/plateforme'
import { fcfa, frDate, today } from '../lib/format'
import { etatClient, ouvrirClient } from './outils'
import FactureSheet from '../components/FactureSheet.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { NumericStepper } from '../ds/pumpit/components/forms/NumericStepper.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'
import { Drawer } from '../ds/pumpit/components/feedback/Drawer.jsx'

const lendemain = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

// Clients et abonnements : création, formule, suspension, factures, encaissements.
export default function Clients() {
  const { organisation, refreshOrganisation, agentCan } = useAuth()
  const peutFacturer = agentCan('facturation')
  const emetteur = usePlateforme()
  const [orgs, setOrgs] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [formules, setFormules] = useState([])
  const [orphans, setOrphans] = useState([])
  const [stations, setStations] = useState([])     // toutes les stations, avec leur offre et son prix (bo_stations)
  const [target, setTarget] = useState({})
  const [nouveau, setNouveau] = useState({ nom: '', formule: 'pro', essai: true })
  const [ficheId, setFicheId] = useState(null)
  const [fiche, setFiche] = useState(null)          // copie modifiable du client ouvert dans le tiroir
  const [factures, setFactures] = useState([])
  const [emission, setEmission] = useState({ debut: today(), mois: 1 })
  const [encaisse, setEncaisse] = useState(null)    // { id, date, mode, reference }
  const [aImprimer, setAImprimer] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const fail = (e) => { setMsg(''); setErr(e?.message || String(e)) }
  const ok = (m) => { setErr(''); setMsg(m) }

  async function load() {
    const [o, f, p] = await Promise.all([
      supabase.from('organisations').select('*').order('nom'),
      supabase.from('formules').select('*').order('ordre'),
      supabase.from('profiles').select('id, full_name, created_at').is('organisation_id', null).order('created_at', { ascending: false }),
    ])
    setOrgs(o.data || []); setFormules(f.data || []); setOrphans(p.data || [])
    const st = await supabase.rpc('bo_stations')
    setStations(st.data || [])
    return o.data || []
  }
  useEffect(() => { load() }, [])

  async function loadFactures(id) {
    if (!peutFacturer) return
    const { data } = await supabase.from('factures').select('*').eq('organisation_id', id).order('date_emission', { ascending: false }).order('id', { ascending: false })
    setFactures(data || [])
  }
  function ouvrirFiche(o) {
    setFicheId(o.id); setFiche({ ...o }); setEncaisse(null); setFactures([])
    setEmission({ debut: o.abonnement_jusqu_au ? lendemain(o.abonnement_jusqu_au) : today().slice(0, 8) + '01', mois: 1 })
    loadFactures(o.id)
  }
  async function recharger() {
    const liste = await load()
    const o = liste.find(x => x.id === ficheId)
    if (o) setFiche(f => ({ ...f, ...o }))
    if (ficheId) loadFactures(ficheId)
    if (ficheId === organisation?.id) refreshOrganisation()
  }

  async function creer(e) {
    e.preventDefault()
    if (!nouveau.nom.trim()) { fail('Renseignez le nom du client.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('create_organisation', { p_nom: nouveau.nom.trim(), p_formule: nouveau.formule, p_essai: nouveau.essai && essaiJours > 0 })
    setBusy(false)
    if (error) return fail(error)
    setNouveau({ nom: '', formule: nouveau.formule, essai: true })
    ok(`Client créé. Code d'invitation : ${data?.code_invitation || ''}${data?.essai_jusqu_au ? `. Essai gratuit jusqu'au ${frDate(data.essai_jusqu_au)}` : ''}`); load()
  }

  async function majClient(champs, message) {
    const { error } = await supabase.from('organisations').update({ ...champs, updated_at: new Date().toISOString() }).eq('id', ficheId)
    if (error) return fail(error)
    ok(message); recharger()
  }

  // Un seul client peut recevoir les inscriptions sans code : on retire l'option aux autres d'abord.
  async function basculerSansCode(v) {
    if (v) {
      const { error } = await supabase.from('organisations').update({ accepte_inscription_sans_code: false }).neq('id', ficheId).eq('accepte_inscription_sans_code', true)
      if (error) return fail(error)
    }
    majClient({ accepte_inscription_sans_code: v }, v ? 'Les inscriptions sans code arrivent maintenant chez ce client.' : 'Inscriptions sans code refusées.')
  }

  async function emettre(e) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await supabase.rpc('emettre_facture', { p_org: ficheId, p_debut: emission.debut, p_mois: emission.mois })
    setBusy(false)
    if (error) return fail(error)
    ok(`Facture ${data.numero} émise : ${fcfa(data.montant_ttc)}.`)
    setEmission({ debut: lendemain(data.periode_fin), mois: 1 }); recharger()
  }
  async function encaisser(e) {
    e.preventDefault()
    const { error } = await supabase.rpc('encaisser_facture', { p_facture: encaisse.id, p_date: encaisse.date, p_mode: encaisse.mode, p_reference: encaisse.reference })
    if (error) return fail(error)
    setEncaisse(null); ok('Paiement enregistré. Abonnement prolongé, client actif.'); recharger()
  }
  async function annuler(f) {
    const { error } = await supabase.rpc('annuler_facture', { p_facture: f.id })
    if (error) return fail(error)
    ok(`Facture ${f.numero} annulée.`); recharger()
  }

  async function rattacher(p) {
    const org = Number(target[p.id])
    if (!org) { fail('Choisissez le client auquel rattacher ce compte.'); return }
    const { error } = await supabase.rpc('assign_organisation', { p_profile: p.id, p_org: org })
    if (error) return fail(error)
    ok("Compte rattaché. L'administrateur du client peut maintenant le valider."); load()
  }

  const libelleOffre = (f) => `${f.label} (${Number(f.prix_mensuel) ? fcfa(f.prix_mensuel) + ' / station / mois' : 'gratuit'})${f.actif === false ? ', désactivée' : ''}`
  // Nouveau client : offres actives seulement. Fiche d'un client : aussi son offre actuelle, même désactivée.
  const optionsFormule = formules.filter(f => f.actif !== false).map(f => ({ value: f.key, label: libelleOffre(f) }))
  const optionsFiche = formules.filter(f => f.actif !== false || f.key === fiche?.formule).map(f => ({ value: f.key, label: libelleOffre(f) }))
  const essaiJours = Number(emetteur.essai_jours ?? 30)
  // Le prix d'une offre s'entend par station et par mois : le montant mensuel d'un client
  // est la somme des offres de ses stations.
  const stationsDe = (id) => stations.filter(s => s.organisation_id === id)
  const mensuelDe = (id) => stationsDe(id).reduce((t, s) => t + Number(s.prix_mensuel || 0), 0)
  const stationsFiche = fiche ? stationsDe(fiche.id) : []
  const prix = fiche ? mensuelDe(fiche.id) : 0
  const ht = prix * emission.mois

  async function offreStation(st, formule) {
    const { error } = await supabase.rpc('station_definir_offre', { p_station: st.station_id, p_formule: formule })
    if (error) return fail(error)
    ok(`${st.station} passe en offre ${formules.find(f => f.key === formule)?.label || formule}.`); recharger()
  }
  const tva = Math.round(ht * Number(emetteur.taux_tva || 0) / 100)

  const cols = [
    { key: 'nom', header: 'Client', render: o => <b style={{ fontWeight: 600 }}>{o.nom}</b> },
    { key: 'stations', header: 'Stations', optional: '1', numeric: true, align: 'right', render: o => stationsDe(o.id).length },
    { key: 'mensuel', header: 'Par mois', optional: '1', numeric: true, align: 'right', render: o => mensuelDe(o.id) ? fcfa(mensuelDe(o.id)) : '—' },
    { key: 'etat', header: 'État', render: o => { const e = etatClient(o, emetteur); return <Badge tone={e.tone}>{e.label}</Badge> } },
    { key: 'abonnement_jusqu_au', header: "Réglé jusqu'au", optional: '1', render: o => o.abonnement_jusqu_au ? frDate(o.abonnement_jusqu_au) : '—' },
    { key: 'code_invitation', header: 'Code', optional: '2', numeric: true },
    { key: 'action', header: '', align: 'right', render: o => <Button size="sm" tone="dark" onClick={() => ouvrirFiche(o)}>Gérer</Button> },
  ]
  const orphanCols = [
    { key: 'full_name', header: 'Compte' },
    { key: 'created_at', header: 'Inscrit le', optional: '1', muted: true, render: p => frDate(String(p.created_at).slice(0, 10)) },
    { key: 'org', header: 'Client', render: p => <Select size="sm" value={target[p.id] || ''} onChange={e => setTarget(t => ({ ...t, [p.id]: e.target.value }))}
      options={[{ value: '', label: 'Choisir…' }, ...orgs.map(o => ({ value: o.id, label: o.nom }))]} /> },
    { key: 'action', header: '', align: 'right', render: p => <Button size="sm" tone="dark" onClick={() => rattacher(p)}>Rattacher</Button> },
  ]
  const bloc = { display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', padding: 'var(--sp-5) 0', borderTop: '1px solid var(--border-hairline)' }
  const titre = { font: '700 16px/1.3 var(--font-display)', margin: 0 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {!ficheId && err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      {!ficheId && msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')}>{msg}</AlertBanner>}

      <Panel title="Clients" meta={`${orgs.length}`} flush>
        {orgs.length ? <>
          <DataTable columns={cols} rows={orgs.slice((page - 1) * pageSize, page * pageSize)} zebra={false} rowStatus={o => etatClient(o, emetteur).rang} onRowClick={ouvrirFiche} />
          <Pagination page={Math.min(page, Math.max(1, Math.ceil(orgs.length / pageSize)))}
            pageCount={Math.max(1, Math.ceil(orgs.length / pageSize))} total={orgs.length} pageSize={pageSize}
            onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />
        </> : <PanelEmpty icon="users" label="Aucun client." />}
      </Panel>

      <Panel title="Nouveau client">
        <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--sp-4)' }}>
          Un code d'invitation est généré. Le futur administrateur du client crée son compte avec ce code ; vous ouvrez ensuite ce client pour valider son compte et créer sa première station.
        </p>
        <form onSubmit={creer} style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          <Field label="Nom du client" required style={{ flex: '1 1 240px', maxWidth: 380 }}>
            <Input value={nouveau.nom} onChange={e => setNouveau({ ...nouveau, nom: e.target.value })} placeholder="ex : Stations Dossou" />
          </Field>
          <Field label="Offre de ses stations"><Select value={nouveau.formule} onChange={e => setNouveau({ ...nouveau, formule: e.target.value })} options={optionsFormule} /></Field>
          <Button type="submit" tone="primary" disabled={busy}>Créer le client</Button>
        </form>
        {essaiJours > 0 && <Checkbox checked={nouveau.essai} onChange={v => setNouveau({ ...nouveau, essai: v })} label={`Commencer par un essai gratuit de ${essaiJours} jours`} style={{ marginTop: 'var(--sp-4)' }} />}
      </Panel>

      {orphans.length > 0 && (
        <Panel title="Comptes sans entreprise" meta="code d'invitation absent ou erroné à l'inscription" status="warn" flush>
          <DataTable columns={orphanCols} rows={orphans} zebra={false} />
        </Panel>
      )}

      <Drawer open={!!fiche} title={fiche?.nom} meta={fiche ? `Code d'invitation ${fiche.code_invitation}` : ''} width={560}
        status={fiche ? (etatClient(fiche, emetteur).rang || 'ok') : undefined} onClose={() => { setFicheId(null); setFiche(null); setErr(''); setMsg('') }}
        footer={fiche && fiche.id !== organisation?.id && agentCan('ouvrir_client') ? <Button tone="outline" icon="external-link" onClick={() => ouvrirClient(fiche.id).catch(fail)}>Ouvrir ce client dans l'application</Button> : undefined}>
        {fiche && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')} style={{ marginBottom: 'var(--sp-4)' }}>{err}</AlertBanner>}
            {msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')} style={{ marginBottom: 'var(--sp-4)' }}>{msg}</AlertBanner>}

            <div style={{ ...bloc, borderTop: 0, paddingTop: 0 }}>
              <h3 style={titre}>Abonnement</h3>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                <Badge tone={etatClient(fiche, emetteur).tone}>{etatClient(fiche, emetteur).label}</Badge>
                <span style={{ color: 'var(--text-muted)' }}>{fiche.abonnement_jusqu_au ? `Réglé jusqu'au ${frDate(fiche.abonnement_jusqu_au)}` : 'Aucun paiement enregistré'}</span>
              </div>
              <Field label="Offre par défaut" hint="Appliquée aux stations que le client créera ensuite.">
                <Select value={fiche.formule} options={optionsFiche} style={{ width: '100%' }}
                  onChange={e => majClient({ formule: e.target.value }, 'Offre par défaut modifiée. Les stations existantes gardent leur offre.')} />
              </Field>
              {fiche.statut === 'suspendu'
                ? <Button tone="dark" onClick={() => majClient({ statut: 'actif' }, 'Client réactivé.')} style={{ alignSelf: 'flex-start' }}>Réactiver le client</Button>
                : <Button tone="danger" disabled={fiche.id === organisation?.id} title={fiche.id === organisation?.id ? 'Ouvrez un autre client avant de suspendre celui-ci.' : undefined}
                    onClick={() => majClient({ statut: 'suspendu' }, 'Client suspendu : ses comptes ne voient plus aucune donnée.')} style={{ alignSelf: 'flex-start' }}>Suspendre le client</Button>}
              <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
                Un client suspendu garde ses données. Ses comptes voient un écran « Accès suspendu », ses factures et l'assistance. Encaisser une facture le réactive.
              </p>
            </div>

            <div style={bloc}>
              <h3 style={titre}>Stations et offres</h3>
              {!stationsFiche.length && <span style={{ color: 'var(--text-muted)' }}>Aucune station. Ouvrez ce client pour créer sa première station.</span>}
              {stationsFiche.map(st => (
                <div key={st.station_id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                  <span style={{ flex: '1 1 140px', font: '600 14px/1.3 var(--font-ui)' }}>{st.station}</span>
                  <Select size="sm" value={st.formule} onChange={e => offreStation(st, e.target.value)} style={{ flex: '1 1 200px' }}
                    options={formules.filter(f => f.actif !== false || f.key === st.formule).map(f => ({ value: f.key, label: libelleOffre(f) }))} />
                </div>
              ))}
              {stationsFiche.length > 0 && <span style={{ font: '700 16px/1.3 var(--font-display)' }}>Total : {fcfa(prix)} par mois</span>}
              <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
                Chaque station a sa propre offre : elle fixe son prix, ses fonctions et ses activités. Le client ne peut pas la changer lui-même.
              </p>
            </div>

            <div style={bloc}>
              <h3 style={titre}>Essai gratuit</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                <Field label="Essai jusqu'au"><Input type="date" value={fiche.essai_jusqu_au || ''} onChange={e => setFiche({ ...fiche, essai_jusqu_au: e.target.value || null })} /></Field>
                <Button onClick={() => majClient({ essai_jusqu_au: fiche.essai_jusqu_au || null }, fiche.essai_jusqu_au ? `Essai fixé jusqu'au ${frDate(fiche.essai_jusqu_au)}.` : 'Essai retiré.')}>Enregistrer la date</Button>
                {fiche.essai_jusqu_au && <Button tone="ghost" onClick={() => majClient({ essai_jusqu_au: null }, 'Essai retiré : le client suit maintenant le régime normal.')}>Retirer l'essai</Button>}
              </div>
              <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
                {emetteur.suspendre_fin_essai === false
                  ? 'À la fin de l\'essai, le client garde son accès et apparaît « Essai terminé ».'
                  : 'À la fin de l\'essai, l\'accès est bloqué automatiquement.'} Le premier paiement encaissé met fin à l'essai. Repousser la date prolonge l'essai.
              </p>
            </div>

            {peutFacturer && <div style={bloc}>
              <h3 style={titre}>Émettre une facture</h3>
              <form onSubmit={emettre} style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
                <Field label="À partir du"><Input type="date" value={emission.debut} onChange={e => setEmission({ ...emission, debut: e.target.value })} required /></Field>
                <Field label="Nombre de mois"><NumericStepper value={emission.mois} min={1} max={24} onChange={v => setEmission({ ...emission, mois: Math.round(v) || 1 })} /></Field>
                <Button type="submit" tone="primary" disabled={busy || !prix}>Émettre {fcfa(ht + tva)}</Button>
              </form>
              <span style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>
                {emission.mois} mois × {fcfa(prix)} ({stationsFiche.length} station{stationsFiche.length > 1 ? 's' : ''}){tva ? ` + TVA ${Number(emetteur.taux_tva)} % (${fcfa(tva)})` : ''}
              </span>
            </div>}

            {peutFacturer && <div style={bloc}>
              <h3 style={titre}>Factures</h3>
              {!factures.length && <span style={{ color: 'var(--text-muted)' }}>Aucune facture.</span>}
              {factures.map(f => {
                const s = STATUT_FACTURE[f.statut] || STATUT_FACTURE.emise
                return (
                  <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--sp-4)', background: 'var(--brume)', borderRadius: 'var(--radius-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                      <b style={{ fontWeight: 600 }}>{f.numero}</b><Badge tone={s.tone}>{s.label}</Badge>
                      <span style={{ marginLeft: 'auto', font: '700 16px/1.2 var(--font-display)' }}>{fcfa(f.montant_ttc)}</span>
                    </div>
                    <span style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>
                      Du {frDate(f.periode_debut)} au {frDate(f.periode_fin)}{f.statut === 'payee' ? ` · payée le ${frDate(f.paye_le)}${f.mode_paiement ? ', ' + f.mode_paiement : ''}${f.reference_paiement ? ' (' + f.reference_paiement + ')' : ''}` : ''}
                    </span>
                    {encaisse?.id === f.id ? (
                      <form onSubmit={encaisser} style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                        <Field label="Payée le"><Input size="sm" type="date" value={encaisse.date} onChange={e => setEncaisse({ ...encaisse, date: e.target.value })} required /></Field>
                        <Field label="Mode"><Select size="sm" value={encaisse.mode} onChange={e => setEncaisse({ ...encaisse, mode: e.target.value })} options={['Mobile Money', 'Virement', 'Espèces', 'Chèque']} /></Field>
                        <Field label="Référence" style={{ flex: '1 1 120px' }}><Input size="sm" value={encaisse.reference} onChange={e => setEncaisse({ ...encaisse, reference: e.target.value })} /></Field>
                        <Button size="sm" type="submit" tone="dark">Valider le paiement</Button>
                        <Button size="sm" tone="ghost" onClick={() => setEncaisse(null)}>Annuler</Button>
                      </form>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                        {f.statut === 'emise' && <Button size="sm" tone="dark" onClick={() => setEncaisse({ id: f.id, date: today(), mode: 'Mobile Money', reference: '' })}>Encaisser</Button>}
                        <Button size="sm" icon="printer" onClick={() => setAImprimer(f)}>Imprimer</Button>
                        {f.statut === 'emise' && <Button size="sm" tone="ghost" onClick={() => annuler(f)}>Annuler la facture</Button>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>}

            <div style={bloc}>
              <h3 style={titre}>Coordonnées (figurent sur les factures)</h3>
              <Field label="Nom du client"><Input value={fiche.nom || ''} onChange={e => setFiche({ ...fiche, nom: e.target.value })} /></Field>
              <Field label="Adresse"><Input value={fiche.adresse || ''} onChange={e => setFiche({ ...fiche, adresse: e.target.value })} /></Field>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
                <Field label="Téléphone" style={{ flex: '1 1 160px' }}><Input type="tel" value={fiche.telephone || ''} onChange={e => setFiche({ ...fiche, telephone: e.target.value })} /></Field>
                <Field label="IFU" style={{ flex: '1 1 160px' }}><Input value={fiche.ifu || ''} onChange={e => setFiche({ ...fiche, ifu: e.target.value })} /></Field>
              </div>
              <Button style={{ alignSelf: 'flex-start' }} disabled={!String(fiche.nom || '').trim()}
                onClick={() => majClient({ nom: fiche.nom.trim(), adresse: fiche.adresse || null, telephone: fiche.telephone || null, ifu: fiche.ifu || null }, 'Coordonnées enregistrées.')}>Enregistrer les coordonnées</Button>
            </div>

            <div style={bloc}>
              <h3 style={titre}>Ancienne application</h3>
              <Checkbox checked={!!fiche.accepte_inscription_sans_code} onChange={basculerSansCode} label="Rattacher à ce client les comptes créés sans code" />
              <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
                L'ancienne application n'a pas de champ « code entreprise ». Tant qu'elle sert, ses nouvelles inscriptions arrivent chez le client coché ici (un seul possible). Décochez quand elle est arrêtée.
              </p>
            </div>
          </div>
        )}
      </Drawer>

      <FactureSheet facture={aImprimer} client={fiche} emetteur={emetteur} onDone={() => setAImprimer(null)} />
    </div>
  )
}
