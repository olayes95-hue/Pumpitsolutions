import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStation } from '../lib/station.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'

export default function NotifBanner() {
  const { stationId } = useStation()
  const [notifs, setNotifs] = useState([])

  async function load() {
    if (!stationId) { setNotifs([]); return }
    const { data } = await supabase.from('notifications').select('*')
      .eq('station_id', stationId).eq('resolved', false).order('created_at', { ascending: false })
    setNotifs(data || [])
  }
  useEffect(() => { load() }, [stationId])
  // rafraîchit à l'ouverture + toutes les 5 min (les notifs sont créées par le planificateur 9h/17h)
  useEffect(() => { const t = setInterval(load, 300000); return () => clearInterval(t) }, [stationId])

  async function resolve(id) {
    await supabase.from('notifications').update({ resolved: true }).eq('id', id)
    setNotifs(p => p.filter(n => n.id !== id))
  }

  if (!notifs.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
      {notifs.map(n => (
        <AlertBanner key={n.id} tone="warn" title="Rappel"
          action={<Button size="sm" onClick={() => resolve(n.id)}>Traité</Button>}>
          {n.message}
        </AlertBanner>
      ))}
    </div>
  )
}
