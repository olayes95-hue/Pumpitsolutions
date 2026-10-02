import { useEffect, useState } from 'react'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { PhotoImage } from '../lib/photos.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { frDate, today } from '../lib/format'
import { uploadEvidence } from '../lib/image'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Textarea } from '../ds/pumpit/components/forms/Textarea.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { Drawer, DrawerRow } from '../ds/pumpit/components/feedback/Drawer.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { EvidenceUpload } from '../ds/pumpit/components/evidence/EvidenceUpload.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? Number(v) : 0)
const MAX_MACHINES = 10
const machineNums = (n) => Array.from({ length: n }, (_, i) => i + 1)
const CONFORME_OPTIONS = [
  { value: '', label: '— non précisé —' },
  { value: 'oui', label: 'Oui' },
  { value: 'non', label: 'Non' },
]
const ORGANISME_OPTIONS = ['ANM', 'Bénin Pétro', 'Autre']

function FormSection({ title, children, style }) {
  return (
    <div style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', ...style }}>
      <div style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

export default function Inspections() {
  const { session, isAdmin } = useAuth()
  const { stationId, current } = useStation()
  const [list, setList] = useState([])
  const [f, setF] = useState(blank())
  const [organismeAutre, setOrganismeAutre] = useState('')
  const [pompesSel, setPompesSel] = useState({})   // { 'E1': { prelevement_litres, retour_cuve_litres, index_avant, index_apres }, ... }
  const [fichePhotoPath, setFichePhotoPath] = useState(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('')
  const [fYear, setFYear] = useState('all')
  // Le formulaire reste caché par défaut : on arrive directement sur l'historique, le
  // formulaire ne s'ouvre qu'à la demande (bouton "+ Enregistrer un nouveau contrôle").
  const [formOpen, setFormOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)

  const nombreMachines = Math.min(MAX_MACHINES, Math.max(1, Number(current?.nombre_machines) || 4))
  const pompesDisponibles = machineNums(nombreMachines).flatMap(n => [
    { key: `E${n}`, label: `Pompe E${n}`, produit: 'essence' },
    { key: `G${n}`, label: `Pompe G${n}`, produit: 'gasoil' },
  ])

  async function load() {
    if (!stationId) return
    setList((await supabase.from('inspections').select('*').eq('station_id', stationId).order('date_controle', { ascending: false })).data || [])
  }
  useEffect(() => { load() }, [stationId])

  function togglePompe(key, checked) {
    setPompesSel(p => {
      if (!checked) { const { [key]: _, ...rest } = p; return rest }
      return { ...p, [key]: p[key] || { prelevement_litres: '', retour_cuve_litres: '', index_avant: '', index_apres: '' } }
    })
  }
  function updatePompe(key, champ, v) { setPompesSel(p => ({ ...p, [key]: { ...p[key], [champ]: v } })) }

  // Photo envoyée immédiatement à la sélection (pas au submit final) : même fix que Submit.jsx —
  // un File gardé en mémoire jusqu'au submit disparaît si l'onglet recharge entre-temps (téléphone).
  async function handleFichePhoto(file) {
    if (!file || !stationId) return
    setPhotoBusy(true)
    try {
      const path = await uploadEvidence(supabase, BORDEREAUX_BUCKET, `${stationId}/inspections/${f.date_controle || today()}`, file)
      setFichePhotoPath(path)
    } catch (e) { setErr(`Échec de l'envoi de la photo : ${e.message || e}. Vérifiez votre connexion et réessayez.`) }
    finally { setPhotoBusy(false) }
  }

  async function add(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const fiche_photo_path = fichePhotoPath
      const organisme = f.organisme === 'Autre' ? (organismeAutre || 'Autre') : f.organisme
      const pompesDetail = Object.entries(pompesSel).map(([key, v]) => {
        const pr = pompesDisponibles.find(p => p.key === key)
        return {
          pompe: key, produit: pr?.produit || null,
          prelevement_litres: v.prelevement_litres ? Number(v.prelevement_litres) : null,
          retour_cuve_litres: v.retour_cuve_litres ? Number(v.retour_cuve_litres) : null,
          index_avant: v.index_avant ? Number(v.index_avant) : null,
          index_apres: v.index_apres ? Number(v.index_apres) : null,
        }
      })
      const totalPreleve = pompesDetail.reduce((s, p) => s + N(p.prelevement_litres), 0)
      const totalRetour = pompesDetail.reduce((s, p) => s + N(p.retour_cuve_litres), 0)
      const { error } = await supabase.from('inspections').insert({
        station_id: stationId, date_controle: f.date_controle, organisme,
        pompes: pompesDetail.length ? pompesDetail.map(p => p.pompe).join(', ') : null,
        pompes_detail: pompesDetail.length ? pompesDetail : null,
        prelevement_litres: pompesDetail.length ? totalPreleve : (f.prelevement_litres ? Number(f.prelevement_litres) : null),
        retour_cuve_litres: pompesDetail.length ? totalRetour : (f.retour_cuve_litres ? Number(f.retour_cuve_litres) : null),
        conforme: f.conforme === '' ? null : f.conforme === 'oui',
        motif: f.motif || null,
        pieces_a_remplacer: f.pieces_a_remplacer || null,
        observations: f.observations || null,
        actions_direction: f.actions_direction || null,
        a_adresser_direction: !!f.a_adresser_direction,
        agent_nom: f.agent_nom || null, agent_contact: f.agent_contact || null,
        heure_arrivee: f.heure_arrivee || null, heure_depart: f.heure_depart || null,
        fiche_photo_path, created_by: session.user.id })
      if (error) throw error
      setF(blank()); setOrganismeAutre(''); setPompesSel({}); setFichePhotoPath(null)
      setFormOpen(false)
      setMsg('Contrôle enregistré'); setTimeout(() => setMsg(''), 2500); load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function del(id) { await supabase.from('inspections').delete().eq('id', id); load() }
  async function marquerTraite(id) { await supabase.from('inspections').update({ traite: true }).eq('id', id); load() }

  // list est trié par date_controle décroissant : le premier élément est le dernier contrôle.
  const dernier = list[0] || null
  const nonConformes = list.filter(c => c.conforme === false).length
  const actionsEnAttente = list.filter(c => c.a_adresser_direction && !c.traite).length
  const years = [...new Set(list.map(c => (c.date_controle || '').slice(0, 4)).filter(Boolean))].sort().reverse()
  const shownList = fYear === 'all' ? list : list.filter(c => (c.date_controle || '').slice(0, 4) === fYear)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      {dernier?.conforme === false && (
        <AlertBanner tone="alarm" title="Dernier contrôle non conforme">
          {frDate(dernier.date_controle)} — {dernier.organisme}{dernier.observations ? ` : ${dernier.observations}` : ''}. Vérifiez que les corrections nécessaires ont bien été apportées.
        </AlertBanner>
      )}
      {isAdmin && actionsEnAttente > 0 && (
        <AlertBanner tone="warn" title="Actions en attente">
          {actionsEnAttente} intervention(s) attendent une décision de la direction — voir « Action requise » dans l'historique ci-dessous.
        </AlertBanner>
      )}

      {list.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-4)' }}>
          <Kpi label="Contrôles enregistrés" value={list.length} />
          <Kpi label="Dernier contrôle" value={frDate(dernier?.date_controle)} />
          <Kpi label="Non conformes" value={nonConformes} status={nonConformes > 0 ? 'alarm' : 'ok'} />
          {actionsEnAttente > 0 && <Kpi label="Actions en attente (direction)" value={actionsEnAttente} status="warn" />}
        </div>
      )}

      {/* Par défaut, seul l'historique est affiché — le formulaire ne s'ouvre qu'à la demande. */}
      {!formOpen && (
        <Button tone="primary" style={{ alignSelf: 'flex-start' }} onClick={() => setFormOpen(true)}>
          + Enregistrer un nouveau contrôle
        </Button>
      )}

      {formOpen && (
      <Panel title="Enregistrer un contrôle / une intervention" actions={<Button tone="outline" onClick={() => setFormOpen(false)}>Annuler</Button>}>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Contrôle inopiné (ANM, Bénin Pétro…) ou intervention d'un agent dépanneur — prélèvement, retour en cuve, motif, pièces, observations, photo de la fiche.
        </p>
        <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <Field label="Date du contrôle" style={{ flex: '1 1 180px' }}>
              <Input type="date" value={f.date_controle} max={today()} onChange={e => setF({ ...f, date_controle: e.target.value })} />
            </Field>
            <Field label="Organisme / intervenant" style={{ flex: '1 1 180px' }}>
              <Select value={f.organisme} onChange={e => setF({ ...f, organisme: e.target.value })}
                options={ORGANISME_OPTIONS.map(o => ({ value: o, label: o }))} style={{ width: '100%' }} />
            </Field>
            {f.organisme === 'Autre' && (
              <Field label="Précise lequel" style={{ flex: '1 1 180px' }}>
                <Input value={organismeAutre} onChange={e => setOrganismeAutre(e.target.value)} placeholder="ex : technicien indépendant" />
              </Field>
            )}
          </div>

          <Field label="Motif de l'intervention">
            <Input value={f.motif} onChange={e => setF({ ...f, motif: e.target.value })} placeholder="ex : contrôle inopiné, panne pompe E2, étalonnage…" />
          </Field>

          <FormSection title="Agent dépanneur / intervenant">
            <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              <Field label="Nom" style={{ flex: '1 1 180px' }}>
                <Input value={f.agent_nom} onChange={e => setF({ ...f, agent_nom: e.target.value })} />
              </Field>
              <Field label="Contact (téléphone)" style={{ flex: '1 1 180px' }}>
                <Input value={f.agent_contact} onChange={e => setF({ ...f, agent_contact: e.target.value })} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              <Field label="Heure d'arrivée" style={{ flex: '1 1 140px' }}>
                <Input type="time" value={f.heure_arrivee} onChange={e => setF({ ...f, heure_arrivee: e.target.value })} />
              </Field>
              <Field label="Heure de départ" style={{ flex: '1 1 140px' }}>
                <Input type="time" value={f.heure_depart} onChange={e => setF({ ...f, heure_depart: e.target.value })} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Pompes concernées">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
              {pompesDisponibles.map(p => (
                <Checkbox key={p.key} label={p.label} checked={!!pompesSel[p.key]} onChange={v => togglePompe(p.key, v)} />
              ))}
            </div>
            {Object.keys(pompesSel).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
                {Object.keys(pompesSel).map(key => (
                  <div key={key} style={{ padding: 'var(--sp-3)', background: 'var(--surface-panel)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)' }}>
                    <div style={{ font: 'var(--fw-semibold) 14px/1.2 var(--font-ui)', color: 'var(--text-primary)', marginBottom: 'var(--sp-2)' }}>{pompesDisponibles.find(p => p.key === key)?.label}</div>
                    <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                      <Field label="Prélevé (L)" style={{ flex: '1 1 110px' }}>
                        <Input size="sm" type="number" inputMode="decimal" numeric value={pompesSel[key].prelevement_litres} onChange={e => updatePompe(key, 'prelevement_litres', e.target.value)} />
                      </Field>
                      <Field label="Retour cuve (L)" style={{ flex: '1 1 110px' }}>
                        <Input size="sm" type="number" inputMode="decimal" numeric value={pompesSel[key].retour_cuve_litres} onChange={e => updatePompe(key, 'retour_cuve_litres', e.target.value)} />
                      </Field>
                      <Field label="Index avant" style={{ flex: '1 1 110px' }}>
                        <Input size="sm" type="number" inputMode="decimal" numeric value={pompesSel[key].index_avant} onChange={e => updatePompe(key, 'index_avant', e.target.value)} />
                      </Field>
                      <Field label="Index après" style={{ flex: '1 1 110px' }}>
                        <Input size="sm" type="number" inputMode="decimal" numeric value={pompesSel[key].index_apres} onChange={e => updatePompe(key, 'index_apres', e.target.value)} />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!Object.keys(pompesSel).length && (
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Prélevé (litres) — total" style={{ flex: '1 1 180px' }}>
                  <Input type="number" inputMode="decimal" numeric value={f.prelevement_litres} onChange={e => setF({ ...f, prelevement_litres: e.target.value })} />
                </Field>
                <Field label="Retour en cuve (litres) — total" style={{ flex: '1 1 180px' }}>
                  <Input type="number" inputMode="decimal" numeric value={f.retour_cuve_litres} onChange={e => setF({ ...f, retour_cuve_litres: e.target.value })} />
                </Field>
              </div>
            )}
          </FormSection>

          <Field label="Pompes conformes ?">
            <Select value={f.conforme} onChange={e => setF({ ...f, conforme: e.target.value })} options={CONFORME_OPTIONS} style={{ width: '100%' }} />
          </Field>
          <Field label="Pièces à remplacer">
            <Textarea rows={2} value={f.pieces_a_remplacer} onChange={e => setF({ ...f, pieces_a_remplacer: e.target.value })} placeholder="ex : joint pompe E2, flexible fissuré…" />
          </Field>
          <Field label="Observations">
            <Textarea rows={3} value={f.observations} onChange={e => setF({ ...f, observations: e.target.value })} />
          </Field>

          <FormSection title="Actions / dispositions à prendre">
            <Textarea rows={2} value={f.actions_direction} onChange={e => setF({ ...f, actions_direction: e.target.value })} placeholder="ex : commander la pièce, planifier un arrêt pompe…" />
            <Checkbox label="Nécessite une décision de la direction" checked={f.a_adresser_direction} onChange={v => setF({ ...f, a_adresser_direction: v })} />
          </FormSection>

          <Field label="Photo de la fiche">
            <EvidenceUpload disabled={photoBusy}
              label={photoBusy ? 'Envoi…' : fichePhotoPath ? 'Photo ✓ (reprendre)' : 'Déposer la photo'}
              multiple={false} onFiles={files => files[0] && handleFichePhoto(files[0])} />
          </Field>
          <Button type="submit" tone="primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
            {busy ? 'Enregistrement…' : 'Enregistrer le contrôle'}
          </Button>
        </form>
      </Panel>
      )}

      <Panel title="Historique des contrôles" meta={`${shownList.length}`} flush
        actions={years.length > 1 && <Select size="sm" value={fYear} onChange={e => setFYear(e.target.value)}
          options={[{ value: 'all', label: 'Toutes années' }, ...years.map(y => ({ value: y, label: y }))]} />}>
        {!shownList.length
          ? <PanelEmpty icon="shield-check" label="Aucun contrôle enregistré" />
          : <DataTable
              columns={[
                { key: 'date', header: 'Date', render: c => frDate(c.date_controle) },
                { key: 'organisme', header: 'Organisme' },
                { key: 'motif', header: 'Motif', render: c => c.motif || '—' },
                { key: 'conforme', header: 'Conforme', render: c => c.conforme == null ? '—' : <Badge tone={c.conforme ? 'ok' : 'alarm'}>{c.conforme ? 'Oui' : 'Non'}</Badge> },
                // Visible d'un coup d'œil pour la direction/l'admin, sans ouvrir chaque ligne —
                // c'est précisément ce qu'une liste de cartes ne permettait pas de voir globalement.
                { key: 'action', header: 'Action', render: c => c.a_adresser_direction ? <Badge tone={c.traite ? 'ok' : 'warn'}>{c.traite ? 'Traité' : 'Action requise'}</Badge> : '—' },
                { key: 'photo', header: 'Photo', render: c => c.fiche_photo_path ? <PhotoImage path={c.fiche_photo_path} alt="" size={32} /> : '—' },
              ]}
              rows={shownList}
              onRowClick={c => setDetailId(c.id)}
            />}
      </Panel>

      {/* Détail d'un contrôle : lecture seule pour le gérant — ni modification ni suppression
          possibles depuis ce tiroir pour ce rôle, seulement pour l'administrateur. */}
      <Drawer open={!!detailId} onClose={() => setDetailId(null)}
        title={detailId && list.find(c => c.id === detailId) ? `${frDate(list.find(c => c.id === detailId).date_controle)} — ${list.find(c => c.id === detailId).organisme}` : ''}
        footer={(() => {
          const c = list.find(x => x.id === detailId)
          if (!c || !isAdmin) return null
          return <>
            {c.a_adresser_direction && !c.traite && <Button tone="dark" onClick={() => marquerTraite(c.id)}>Marquer comme traité</Button>}
            <Button tone="danger" onClick={() => { del(c.id); setDetailId(null) }}>Supprimer</Button>
          </>
        })()}>
        {(() => {
          const c = list.find(x => x.id === detailId)
          if (!c) return null
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {c.conforme != null && <DrawerRow label="Conforme" value={c.conforme ? 'Oui' : 'Non'} status={c.conforme ? 'ok' : 'alarm'} />}
              {c.a_adresser_direction && <DrawerRow label="Action direction" value={c.traite ? 'Traité' : 'Action requise'} status={c.traite ? 'ok' : 'warn'} />}
              {c.motif && <DrawerRow label="Motif" value={c.motif} mono={false} />}
              {c.agent_nom && <DrawerRow label="Agent" value={`${c.agent_nom}${c.agent_contact ? ` (${c.agent_contact})` : ''}`} mono={false} />}
              {(c.heure_arrivee || c.heure_depart) && (
                <DrawerRow label="Horaires" mono={false} value={`${c.heure_arrivee ? 'arrivée ' + c.heure_arrivee.slice(0, 5) : ''}${c.heure_depart ? ' — départ ' + c.heure_depart.slice(0, 5) : ''}`} />
              )}
              {Array.isArray(c.pompes_detail) && c.pompes_detail.length > 0 ? (
                <div style={{ marginTop: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  {c.pompes_detail.map((p, i) => (
                    <div key={i} style={{ font: '400 14px/1.5 var(--font-ui)', color: 'var(--text-body)' }}>
                      <b>{p.pompe}</b> — prélevé {N(p.prelevement_litres)} L · retour cuve {N(p.retour_cuve_litres)} L
                      {p.index_avant != null && p.index_apres != null && ` · index ${p.index_avant} → ${p.index_apres}`}
                    </div>
                  ))}
                </div>
              ) : (
                <DrawerRow label="Prélevé / retour cuve" mono={false} value={`${N(c.prelevement_litres)} L / ${N(c.retour_cuve_litres)} L${c.pompes ? ' — ' + c.pompes : ''}`} />
              )}
              {c.pieces_a_remplacer && <DrawerRow label="Pièces à remplacer" value={c.pieces_a_remplacer} mono={false} status="warn" />}
              {c.observations && <DrawerRow label="Observations" value={c.observations} mono={false} />}
              {c.actions_direction && <DrawerRow label="Actions à prendre" value={c.actions_direction} mono={false} />}
              {c.fiche_photo_path && (
                <div style={{ marginTop: 'var(--sp-4)' }}>
                  <PhotoImage path={c.fiche_photo_path} alt="Fiche d'intervention" size={220} />
                </div>
              )}
            </div>
          )
        })()}
      </Drawer>
    </div>
  )
}
function blank() {
  return {
    date_controle: today(), organisme: 'ANM', motif: '',
    prelevement_litres: '', retour_cuve_litres: '', conforme: '',
    pieces_a_remplacer: '', observations: '', actions_direction: '', a_adresser_direction: false,
    agent_nom: '', agent_contact: '', heure_arrivee: '', heure_depart: '',
  }
}
