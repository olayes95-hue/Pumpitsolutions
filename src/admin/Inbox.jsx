import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUT_DEMANDE, dateHeure, lienTel, lienWhatsApp } from '../lib/plateforme'
import Conversation from '../components/Conversation.jsx'
import { Panel, PanelEmpty } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { IconButton } from '../ds/pumpit/components/core/IconButton.jsx'
import { Icon } from '../ds/pumpit/components/core/Icon.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

// Boîte de réception de l'assistance : les demandes de tous les clients, au même endroit.
export default function Inbox() {
  const [demandes, setDemandes] = useState([])
  const [orgs, setOrgs] = useState({})
  const [filtre, setFiltre] = useState('a_traiter')
  const [ouverteId, setOuverteId] = useState(null)
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await supabase.from('assistance_demandes').select('*').order('dernier_message_at', { ascending: false }).limit(300)
    setDemandes(data || [])
  }
  useEffect(() => {
    supabase.from('organisations').select('id, nom').then(({ data }) => setOrgs(Object.fromEntries((data || []).map(o => [o.id, o.nom]))))
    load()
    const ch = supabase.channel('assistance-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assistance_demandes' }, load).subscribe()
    const t = setInterval(load, 30000)
    return () => { clearInterval(t); supabase.removeChannel(ch) }
  }, [])

  const aTraiter = demandes.filter(d => d.statut !== 'resolue')
  const liste = filtre === 'a_traiter' ? aTraiter : demandes
  const ouverte = useMemo(() => demandes.find(d => d.id === ouverteId) || null, [demandes, ouverteId])

  async function statut(s) {
    const { error } = await supabase.rpc('assistance_statut', { p_demande: ouverte.id, p_statut: s })
    if (error) { setErr(error.message); return }
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      <div className="pi-bo-split" data-open={ouverte ? 'true' : 'false'}>
        <div className="pi-bo-list" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', minWidth: 0 }}>
          <Tabs value={filtre} onChange={setFiltre} items={[{ value: 'a_traiter', label: 'À traiter', count: aTraiter.length }, { value: 'toutes', label: 'Toutes', count: demandes.length }]} />
          <Panel flush>
            {!liste.length ? <PanelEmpty icon="message-circle" label={filtre === 'a_traiter' ? 'Aucune demande à traiter.' : 'Aucune demande.'} /> : liste.map((d, i) => {
              const st = STATUT_DEMANDE[d.statut] || STATUT_DEMANDE.ouverte
              const actif = d.id === ouverteId
              return (
                <button key={d.id} type="button" onClick={() => setOuverteId(d.id)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)', width: '100%', textAlign: 'left', padding: 'var(--sp-4) var(--sp-5)', background: actif ? 'var(--vert-fond)' : 'transparent', border: 0, borderTop: i ? '1px solid var(--border-hairline)' : 0, cursor: 'pointer' }}>
                  <span style={{ width: 10, height: 10, marginTop: 6, borderRadius: 'var(--radius-full)', background: d.non_lu_plateforme ? 'var(--vert-pump)' : 'transparent', flex: '0 0 auto' }} title={d.non_lu_plateforme ? 'Non lu' : undefined} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', font: '500 13px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>{orgs[d.organisation_id] || 'Client'} · {dateHeure(d.dernier_message_at)}</span>
                    <span style={{ display: 'block', font: (d.non_lu_plateforme ? '600' : '500') + ' 15px/1.35 var(--font-ui)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.sujet}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginTop: 6 }}>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {d.rappel_demande && d.statut !== 'resolue' && <Badge tone="accent">Rappel demandé</Badge>}
                    </span>
                  </span>
                </button>
              )
            })}
          </Panel>
        </div>

        <div className="pi-bo-thread" style={{ minWidth: 0 }}>
          {!ouverte ? <Panel><PanelEmpty icon="message-circle" label="Choisissez une demande dans la liste." /></Panel> : (
            <Panel>
              <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
                <IconButton icon="arrow-left" tone="solid" title="Retour à la liste" onClick={() => setOuverteId(null)} />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <h2 style={{ fontSize: 20 }}>{ouverte.sujet}</h2>
                  <div style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 2 }}>{orgs[ouverte.organisation_id] || 'Client'} · {ouverte.auteur_nom} · ouverte le {dateHeure(ouverte.created_at)}</div>
                </div>
                {ouverte.statut === 'resolue'
                  ? <Button size="sm" onClick={() => statut('en_cours')}>Rouvrir</Button>
                  : <Button size="sm" tone="dark" icon="check" onClick={() => statut('resolue')}>Marquer résolue</Button>}
              </div>
              {ouverte.telephone_rappel && (
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)', background: ouverte.rappel_demande ? 'var(--citron-fond)' : 'var(--brume)', borderRadius: 'var(--radius-2)' }}>
                  <Icon name="phone" size={18} />
                  <span style={{ font: '600 14px/1.3 var(--font-ui)' }}>{ouverte.rappel_demande ? 'Le client demande à être rappelé :' : 'Numéro du client :'} {ouverte.telephone_rappel}</span>
                  <a href={lienTel(ouverte.telephone_rappel)} style={{ marginLeft: 'auto', fontWeight: 600 }}>Appeler</a>
                  <a href={lienWhatsApp(ouverte.telephone_rappel)} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>WhatsApp</a>
                </div>
              )}
              <Conversation demande={ouverte} cote="plateforme" onChanged={load} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
