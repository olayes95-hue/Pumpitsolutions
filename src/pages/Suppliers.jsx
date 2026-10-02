import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'

const CATEGORIES = [
  { value: 'superette', label: 'Supérette' },
  { value: 'lubrifiant', label: 'Lubrifiant' },
  { value: 'gaz', label: 'Gaz' },
  { value: 'autre', label: 'Autre' },
]

export default function Suppliers() {
  const [list, setList] = useState([])
  const [f, setF] = useState({ nom: '', categorie: 'superette', contact: '' })
  const [err, setErr] = useState('')

  async function load() { setList((await supabase.from('suppliers').select('*').order('nom')).data || []) }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault(); setErr('')
    if (!f.nom) return
    const { error } = await supabase.from('suppliers').insert({ nom: f.nom, categorie: f.categorie, contact: f.contact || null })
    if (error) setErr(error.message)
    else { setF({ nom: '', categorie: 'superette', contact: '' }); load() }
  }
  async function del(id) {
    await supabase.from('suppliers').delete().eq('id', id); load()
  }

  const columns = [
    { key: 'nom', header: 'Nom' },
    { key: 'categorie', header: 'Catégorie', render: r => CATEGORIES.find(c => c.value === r.categorie)?.label || r.categorie },
    { key: 'contact', header: 'Contact', muted: true, render: r => r.contact || '—' },
    { key: 'actions', header: '', align: 'right', render: r => <Button size="sm" tone="danger" onClick={() => del(r.id)}>Suppr.</Button> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <Panel title="Ajouter un fournisseur">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Le carburant a un fournisseur unique (non géré ici). Ajoutez ici les fournisseurs supérette / lubrifiant / gaz / autre.
        </p>
        {err && <AlertBanner tone="alarm" title="Erreur" style={{ marginBottom: 'var(--sp-4)' }}>{err}</AlertBanner>}
        <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <Field label="Nom" required style={{ flex: '1 1 200px' }}>
              <Input value={f.nom} onChange={e => setF({ ...f, nom: e.target.value })} required />
            </Field>
            <Field label="Catégorie" style={{ flex: '1 1 160px' }}>
              <Select value={f.categorie} onChange={e => setF({ ...f, categorie: e.target.value })} options={CATEGORIES} style={{ width: '100%' }} />
            </Field>
          </div>
          <Field label="Contact (tél / email)">
            <Input value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} />
          </Field>
          <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>Ajouter</Button>
        </form>
      </Panel>

      <Panel title="Fournisseurs" meta={`${list.length}`} flush>
        {list.length
          ? <DataTable columns={columns} rows={list} />
          : <PanelEmpty icon="truck" label="Aucun fournisseur" />}
      </Panel>
    </div>
  )
}
