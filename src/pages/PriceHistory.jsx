import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fcfa } from '../lib/format'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Pagination } from '../ds/pumpit/components/data/Pagination.jsx'

const CHAMP_LABEL = { prix_achat: "Prix d'achat", prix_vente: 'Prix de vente' }
const frDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

export default function PriceHistory() {
  const [rows, setRows] = useState([])
  const [produitFilter, setProduitFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    supabase.from('v_price_history').select('*').order('changed_at', { ascending: false }).limit(500)
      .then(({ data }) => setRows(data || []))
  }, [])
  useEffect(() => { setPage(1) }, [produitFilter])

  const produits = [...new Set(rows.map(r => r.produit))].sort()
  const shown = produitFilter ? rows.filter(r => r.produit === produitFilter) : rows

  const columns = [
    { key: 'changed_at', header: 'Date', render: r => frDateTime(r.changed_at) },
    { key: 'produit', header: 'Produit' },
    { key: 'categorie', header: 'Catégorie' },
    { key: 'champ', header: 'Champ', render: r => CHAMP_LABEL[r.champ] || r.champ },
    { key: 'ancienne_valeur', header: 'Ancien prix', align: 'right', render: r => r.ancienne_valeur != null ? fcfa(r.ancienne_valeur) : '—' },
    { key: 'nouvelle_valeur', header: 'Nouveau prix', align: 'right', render: r => r.nouvelle_valeur != null ? fcfa(r.nouvelle_valeur) : '—' },
    { key: 'variation', header: 'Variation', align: 'right', render: r => {
      if (r.ancienne_valeur == null || r.nouvelle_valeur == null) return '—'
      const d = r.nouvelle_valeur - r.ancienne_valeur
      if (d === 0) return <Badge tone="idle">0 F</Badge>
      return <Badge tone={d > 0 ? 'warn' : 'ok'}>{d > 0 ? '+' : ''}{fcfa(d)}</Badge>
    } },
    { key: 'changed_by_name', header: 'Modifié par', render: r => r.changed_by_name || '—' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      <Panel title="Historique des prix" actions={
        <Select size="sm" value={produitFilter} onChange={e => setProduitFilter(e.target.value)}
          options={[{ value: '', label: 'Tous les produits' }, ...produits.map(p => ({ value: p, label: p }))]} style={{ width: 200 }} />
      }>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Chaque changement de prix d'achat ou de vente — carburant, gaz, lubrifiant, supérette — est enregistré automatiquement, avec l'ancien et le nouveau montant, qui l'a fait et quand. Les 500 derniers changements.
        </p>
        {shown.length
          ? <>
              <DataTable columns={columns} rows={shown.slice((page - 1) * pageSize, page * pageSize)} />
              <Pagination page={Math.min(page, Math.max(1, Math.ceil(shown.length / pageSize)))}
                pageCount={Math.max(1, Math.ceil(shown.length / pageSize))} total={shown.length} pageSize={pageSize}
                onPage={setPage} onPageSize={s => { setPageSize(s); setPage(1) }} />
            </>
          : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Aucun changement de prix enregistré pour le moment.</p>}
      </Panel>
    </div>
  )
}
