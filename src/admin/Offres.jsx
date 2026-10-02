import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { fcfa } from '../lib/format'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { Drawer } from '../ds/pumpit/components/feedback/Drawer.jsx'

const nombre = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return String(v ?? '').trim() === '' || isNaN(n) ? null : n }
const cleDepuis = (label) => label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)

// Offres et fonctions : ce que contient chaque offre se règle ici, sans toucher au code.
// Un changement s'applique à la prochaine connexion des clients concernés.
export default function Offres() {
  const { refreshOrganisation } = useAuth()
  const [offres, setOffres] = useState([])
  const [fonctions, setFonctions] = useState([])
  const [usage, setUsage] = useState({})            // offre -> nombre de clients
  const [matrice, setMatrice] = useState({})        // offre -> Set des fonctions cochées (brouillon)
  const [modifie, setModifie] = useState(false)
  const [fiche, setFiche] = useState(null)          // offre en cours d'édition ou de création
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const fail = (e) => { setMsg(''); setErr(e?.message || String(e)) }
  const ok = (m) => { setErr(''); setMsg(m) }

  async function load() {
    const [f, c, o] = await Promise.all([
      supabase.from('formules').select('*').order('ordre').order('prix_mensuel'),
      supabase.from('fonctions_catalogue').select('*').order('ordre'),
      supabase.from('organisations').select('formule'),
    ])
    setOffres(f.data || []); setFonctions(c.data || [])
    const u = {}; for (const x of o.data || []) u[x.formule] = (u[x.formule] || 0) + 1
    setUsage(u)
    setMatrice(Object.fromEntries((f.data || []).map(x => [x.key, new Set(x.fonctions || [])])))
    setModifie(false)
  }
  useEffect(() => { load() }, [])

  function basculer(offre, fonction) {
    setMatrice(m => { const s = new Set(m[offre]); s.has(fonction) ? s.delete(fonction) : s.add(fonction); return { ...m, [offre]: s } })
    setModifie(true)
  }
  async function enregistrerMatrice() {
    for (const o of offres) {
      const { error } = await supabase.from('formules').update({ fonctions: [...(matrice[o.key] || [])] }).eq('key', o.key)
      if (error) return fail(error)
    }
    ok('Fonctions enregistrées. Elles s\'appliquent à la prochaine connexion des clients.'); await load(); refreshOrganisation()
  }

  async function enregistrerFiche(e) {
    e.preventDefault()
    const prix = nombre(fiche.prix_mensuel)
    if (!String(fiche.label || '').trim()) return fail('Donnez un nom à l\'offre.')
    if (prix === null || prix < 0) return fail('Prix invalide. Mettez 0 pour une offre gratuite.')
    const champs = { label: fiche.label.trim(), description: String(fiche.description || '').trim() || null, prix_mensuel: prix, ordre: nombre(fiche.ordre) ?? 0 }
    if (fiche.nouvelle) {
      const key = cleDepuis(fiche.label)
      if (!key) return fail('Nom invalide.')
      if (offres.some(o => o.key === key)) return fail('Une offre porte déjà ce nom.')
      const { error } = await supabase.from('formules').insert({ key, ...champs, fonctions: [], actif: true })
      if (error) return fail(error)
      ok('Offre créée. Cochez ses fonctions dans le tableau ci-dessous.')
    } else {
      const { error } = await supabase.from('formules').update(champs).eq('key', fiche.key)
      if (error) return fail(error)
      ok('Offre modifiée. Le nouveau prix s\'applique aux prochaines factures.')
    }
    setFiche(null); load()
  }
  async function activer(o, actif) {
    const { error } = await supabase.from('formules').update({ actif }).eq('key', o.key)
    if (error) return fail(error)
    ok(actif ? 'Offre réactivée.' : 'Offre désactivée : elle n\'est plus proposée aux nouveaux clients. Les clients actuels la gardent.'); setFiche(null); load()
  }
  async function supprimer(o) {
    const { error } = await supabase.from('formules').delete().eq('key', o.key)
    if (error) return fail(/foreign key/i.test(error.message) ? 'Cette offre est utilisée (par un client ou par l\'essai gratuit). Désactivez-la, ou changez d\'abord l\'offre des clients concernés.' : error)
    ok('Offre supprimée.'); setFiche(null); load()
  }

  const th = { textAlign: 'center', padding: '10px var(--sp-4)', font: '600 13px/1.3 var(--font-ui)', color: 'var(--text-muted)', background: 'var(--brume)', whiteSpace: 'nowrap' }
  const td = { padding: '10px var(--sp-4)', borderBottom: '1px solid var(--border-hairline)', textAlign: 'center' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {!fiche && err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')}>{msg}</AlertBanner>}

      <Panel title="Offres" meta={`${offres.length}`} actions={<Button size="sm" tone="dark" icon="plus" onClick={() => { setErr(''); setFiche({ nouvelle: true, label: '', description: '', prix_mensuel: '', ordre: offres.length + 1 }) }}>Nouvelle offre</Button>}>
        {!offres.length ? <PanelEmpty icon="package" label="Aucune offre." /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 'var(--sp-4)' }}>
            {offres.map(o => (
              <div key={o.key} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--sp-5)', background: 'var(--brume)', borderRadius: 'var(--radius-2)', opacity: o.actif ? 1 : .65 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <span style={{ font: '700 18px/1.2 var(--font-display)' }}>{o.label}</span>
                  {!o.actif && <Badge tone="idle">Désactivée</Badge>}
                </div>
                <div><span style={{ font: '800 26px/1.1 var(--font-display)' }}>{Number(o.prix_mensuel) ? fcfa(o.prix_mensuel) : 'Gratuit'}</span>{Number(o.prix_mensuel) ? <span style={{ color: 'var(--text-muted)' }}> / mois</span> : null}</div>
                {o.description && <p style={{ margin: 0, font: '400 14px/1.45 var(--font-ui)', color: 'var(--text-secondary)' }}>{o.description}</p>}
                <span style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>{usage[o.key] || 0} client{(usage[o.key] || 0) > 1 ? 's' : ''} · {(o.fonctions || []).length} fonction{(o.fonctions || []).length > 1 ? 's' : ''} en option</span>
                <Button size="sm" style={{ alignSelf: 'flex-start', marginTop: 'auto' }} onClick={() => { setErr(''); setFiche({ ...o }) }}>Modifier</Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Fonctions incluses dans chaque offre" flush
        actions={<Button size="sm" tone="primary" disabled={!modifie} onClick={enregistrerMatrice}>Enregistrer les fonctions</Button>}>
        <p style={{ color: 'var(--text-muted)', margin: 0, padding: '0 var(--gutter-panel) var(--sp-4)' }}>
          Saisie du jour, stock, commandes, historique, tableau de bord et alertes de caisse sont dans toutes les offres. Cochez ce que chaque offre ajoute.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left', paddingLeft: 'var(--gutter-panel)' }}>Fonction</th>
              {offres.map(o => <th key={o.key} style={th}>{o.label}</th>)}
            </tr></thead>
            <tbody>
              {fonctions.map(f => (
                <tr key={f.key}>
                  <td style={{ ...td, textAlign: 'left', paddingLeft: 'var(--gutter-panel)' }}>
                    <div style={{ font: '600 14px/1.3 var(--font-ui)' }}>{f.label}</div>
                    {f.description && <div style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>{f.description}</div>}
                  </td>
                  {offres.map(o => <td key={o.key} style={td}><Checkbox checked={!!matrice[o.key]?.has(f.key)} onChange={() => basculer(o.key, f.key)} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0, padding: 'var(--sp-4) var(--gutter-panel)' }}>
          La liste des fonctions correspond à ce que l'application sait activer ou masquer. En ajouter une nouvelle demande un développement.
        </p>
      </Panel>

      <Drawer open={!!fiche} title={fiche?.nouvelle ? 'Nouvelle offre' : fiche?.label} meta={fiche && !fiche.nouvelle ? `${usage[fiche.key] || 0} client(s) sur cette offre` : ''} onClose={() => { setFiche(null); setErr('') }}>
        {fiche && (
          <form onSubmit={enregistrerFiche} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
            <Field label="Nom de l'offre" required><Input value={fiche.label || ''} onChange={e => setFiche({ ...fiche, label: e.target.value })} placeholder="ex : Découverte" /></Field>
            <Field label="Prix par mois" required hint="0 pour une offre gratuite."><Input numeric inputMode="numeric" suffix="F" value={fiche.prix_mensuel ?? ''} onChange={e => setFiche({ ...fiche, prix_mensuel: e.target.value })} /></Field>
            <Field label="Description" hint="Affichée dans le back-office."><Input value={fiche.description || ''} onChange={e => setFiche({ ...fiche, description: e.target.value })} /></Field>
            <Field label="Ordre d'affichage"><Input numeric inputMode="numeric" value={fiche.ordre ?? 0} onChange={e => setFiche({ ...fiche, ordre: e.target.value })} style={{ maxWidth: 120 }} /></Field>
            <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>{fiche.nouvelle ? 'Créer l\'offre' : 'Enregistrer'}</Button>
            {!fiche.nouvelle && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--border-hairline)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                  {fiche.actif ? <Button onClick={() => activer(fiche, false)}>Désactiver l'offre</Button> : <Button tone="dark" onClick={() => activer(fiche, true)}>Réactiver l'offre</Button>}
                  <Button tone="danger" disabled={(usage[fiche.key] || 0) > 0} onClick={() => supprimer(fiche)}>Supprimer</Button>
                </div>
                <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
                  Une offre désactivée n'est plus proposée aux nouveaux clients, mais ceux qui l'ont la gardent. La suppression n'est possible que si aucun client ne l'utilise.
                </p>
              </div>
            )}
          </form>
        )}
      </Drawer>
    </div>
  )
}
