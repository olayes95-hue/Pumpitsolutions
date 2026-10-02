import { useEffect, useState } from 'react'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { PhotoImage } from '../lib/photos.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useStation } from '../lib/station.jsx'
import { fcfa, frDate } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { Kpi } from '../lib/Kpi.jsx'

const N = (v) => (v ? Number(v) : 0)

export default function OcrCheck() {
  const { session } = useAuth()
  const { stationId } = useStation()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [onlyUnverified, setOnlyUnverified] = useState(false)

  async function load() {
    if (!stationId) return
    const { data } = await supabase.from('deposits').select('*').eq('station_id', stationId)
      .not('photo_path', 'is', null).order('deposit_date', { ascending: false }).limit(200)
    setRows(data || [])
  }
  useEffect(() => { load() }, [stationId])

  async function analyser(dep) {
    setErr(''); setBusy(dep.id)
    try {
      const { data, error } = await supabase.functions.invoke('ocr-bordereau', { body: { deposit_id: dep.id } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      await load()
    } catch (e) { setErr('Analyse impossible : ' + (e.message || e) + ' — la fonction serveur est-elle déployée ?') }
    finally { setBusy(null) }
  }

  // Validation visuelle manuelle : l'admin/comptable regarde la photo à l'œil et confirme que le
  // montant déclaré correspond, sans passer par l'OCR (utile quand la photo est illisible par
  // l'IA, ou simplement pour aller plus vite sur des bordereaux déjà visiblement corrects).
  async function setVerifie(ids, verifie) {
    setErr(''); setBusy('batch')
    try {
      const patch = verifie
        ? { verifie: true, verifie_par: session.user.id, verifie_at: new Date().toISOString() }
        : { verifie: false, verifie_par: null, verifie_at: null }
      const { error } = await supabase.from('deposits').update(patch).in('id', ids)
      if (error) throw error
      setSelectedIds(p => p.filter(id => !ids.includes(id)))
      await load()
    } catch (e) { setErr("Échec de l'enregistrement : " + (e.message || e)) }
    finally { setBusy(null) }
  }

  const withOcr = rows.filter(r => r.montant_ocr != null)
  const mismatches = withOcr.filter(r => Math.abs(N(r.ocr_ecart)) > 100)
  const nbVerifies = rows.filter(r => r.verifie).length
  const shownRows = onlyUnverified ? rows.filter(r => !r.verifie) : rows

  const columns = [
    { key: 'photo', header: 'Photo', render: r => (
      <PhotoImage path={r.photo_path} size={64} />
    ) },
    { key: 'date', header: 'Date', render: r => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{frDate(r.deposit_date || r.report_date)}</span>
        <Tag>{r.pole}</Tag>
      </div>
    ) },
    { key: 'montant', header: 'Déclaré', numeric: true, align: 'right', render: r => fcfa(r.montant) },
    { key: 'montant_ocr', header: 'Lu (OCR)', numeric: true, align: 'right', render: r => r.montant_ocr != null ? fcfa(r.montant_ocr) : '—' },
    { key: 'ecart', header: 'Écart', numeric: true, align: 'right', render: r => {
      const ec = r.ocr_ecart
      const color = ec == null ? 'var(--text-muted)' : Math.abs(ec) > 100 ? 'var(--state-alarm)' : 'var(--state-ok)'
      return <span style={{ color, fontWeight: 600 }}>{ec == null ? '—' : Math.abs(ec) <= 100 ? '✓ OK' : (ec > 0 ? '+' : '') + fcfa(ec)}</span>
    } },
    { key: 'verifie', header: 'Vérifié à l\'œil', render: r => r.verifie
      ? <Badge tone="ok">✓ {r.verifie_at ? frDate(r.verifie_at.slice(0, 10)) : ''}</Badge>
      : <Badge tone="idle">Non vérifié</Badge> },
    { key: 'actions', header: '', align: 'right', render: r => (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <Button size="sm" disabled={busy === r.id} onClick={() => analyser(r)}>
          {busy === r.id ? '…' : (r.montant_ocr != null ? 'Ré-analyser' : 'Analyser')}
        </Button>
        <Button size="sm" tone={r.verifie ? 'outline' : 'primary'} disabled={busy === 'batch'}
          onClick={() => setVerifie([r.id], !r.verifie)}>{r.verifie ? 'Dévérifier' : 'Vérifier'}</Button>
      </div>
    ) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        <Kpi label="Bordereaux avec photo" value={rows.length} />
        <Kpi label="Vérifiés (à l'œil ou OCR)" value={nbVerifies} status={nbVerifies === rows.length && rows.length > 0 ? 'ok' : undefined} />
        <Kpi label="Analysés (OCR)" value={withOcr.length} />
        <Kpi label="Écarts détectés" value={mismatches.length} status={mismatches.length > 0 ? 'alarm' : 'ok'} />
      </div>

      <Panel title="Vérification des bordereaux (déclaré vs lu sur la photo)" flush>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
          Regardez la photo et comparez au montant déclaré — pas besoin de l'analyse IA pour valider ce qui se voit clairement à l'œil.
          Sélectionnez plusieurs lignes pour les valider d'un coup. « Analyser » reste disponible pour une lecture automatique par IA.
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
          <Checkbox label="N'afficher que les non vérifiés" checked={onlyUnverified} onChange={setOnlyUnverified} />
          {selectedIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
              <span style={{ font: '400 14px/1.25 var(--font-ui)', color: 'var(--text-muted)' }}>{selectedIds.length} sélectionné(s)</span>
              <Button size="sm" tone="dark" disabled={busy === 'batch'} onClick={() => setVerifie(selectedIds, true)}>
                {busy === 'batch' ? 'Enregistrement…' : `Valider la sélection (${selectedIds.length})`}
              </Button>
            </div>
          )}
        </div>
        <div style={{ marginTop: 'var(--sp-4)' }}>
          {rows.length
            ? <DataTable columns={columns} rows={shownRows} selectable selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
            : <PanelEmpty icon="camera" label="Aucun bordereau avec photo pour cette station" />}
        </div>
      </Panel>
    </div>
  )
}
