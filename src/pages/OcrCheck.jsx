import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
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
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { Kpi } from '../lib/Kpi.jsx'

export default function OcrCheck() {
  const { session } = useAuth()
  const { stationId } = useStation()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  // Par défaut on ne montre que ce qui reste à vérifier — l'essentiel est déjà couvert par le
  // rapprochement bancaire (verifie_source='rapprochement'), cet écran ne sert plus qu'au reste.
  const [onlyUnverified, setOnlyUnverified] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  async function load() {
    if (!stationId) return
    const { data } = await supabase.from('deposits').select('*').eq('station_id', stationId)
      .not('photo_path', 'is', null).order('deposit_date', { ascending: false }).limit(200)
    setRows(data || [])
  }
  useEffect(() => { load() }, [stationId])
  useEffect(() => { setPage(1) }, [onlyUnverified])

  // Validation visuelle manuelle : l'admin/comptable regarde la photo à l'œil et confirme que le
  // montant déclaré correspond — pour les versements pas encore rapprochés avec la banque (ceux-là
  // sont déjà vérifiés automatiquement, voir BankRecon.jsx / verifie_source='rapprochement').
  async function setVerifie(ids, verifie) {
    setErr(''); setBusy('batch')
    try {
      const patch = verifie
        ? { verifie: true, verifie_par: session.user.id, verifie_at: new Date().toISOString(), verifie_source: 'manuel' }
        : { verifie: false, verifie_par: null, verifie_at: null, verifie_source: null }
      const { error } = await supabase.from('deposits').update(patch).in('id', ids)
      if (error) throw error
      setSelectedIds(p => p.filter(id => !ids.includes(id)))
      await load()
    } catch (e) { setErr("Échec de l'enregistrement : " + (e.message || e)) }
    finally { setBusy(null) }
  }

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
    { key: 'verifie', header: 'Vérifié', render: r => r.verifie
      ? <Badge tone="ok">✓ {r.verifie_source === 'rapprochement' ? 'Rapprochement bancaire' : 'À l\'œil'}{r.verifie_at ? ` — ${frDate(r.verifie_at.slice(0, 10))}` : ''}</Badge>
      : <Badge tone="idle">Non vérifié</Badge> },
    { key: 'actions', header: '', align: 'right', render: r => (
      <Button size="sm" tone={r.verifie ? 'outline' : 'primary'} disabled={busy === 'batch'}
        onClick={() => setVerifie([r.id], !r.verifie)}>{r.verifie ? 'Dévérifier' : 'Vérifier'}</Button>
    ) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
        <Kpi label="Bordereaux avec photo" value={rows.length} />
        <Kpi label="Vérifiés (à l'œil ou rapprochement)" value={nbVerifies} status={nbVerifies === rows.length && rows.length > 0 ? 'ok' : undefined} />
        <Kpi label="Restant à vérifier" value={rows.length - nbVerifies} status={rows.length - nbVerifies > 0 ? 'alarm' : 'ok'} />
      </div>

      <Panel title="Vérification des bordereaux (déclaré vs photo)" flush>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
          Un versement déjà rapproché avec la banque (écran Rapprochement) est vérifié automatiquement. Il ne reste ici que ce que la banque n'a pas encore confirmé — regardez la photo et comparez au montant déclaré. Sélectionnez plusieurs lignes pour les valider d'un coup.
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
            ? <>
                <DataTable columns={columns} rows={shownRows.slice((page - 1) * pageSize, page * pageSize)} selectable selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
                <Pagination page={Math.min(page, Math.max(1, Math.ceil(shownRows.length / pageSize)))}
                  pageCount={Math.max(1, Math.ceil(shownRows.length / pageSize))} total={shownRows.length} pageSize={pageSize}
                  onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />
              </>
            : <PanelEmpty icon="camera" label="Aucun bordereau avec photo pour cette station" />}
        </div>
      </Panel>
    </div>
  )
}
