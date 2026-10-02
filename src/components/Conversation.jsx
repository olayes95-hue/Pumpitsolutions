import { useEffect, useRef, useState } from 'react'
import { supabase, BORDEREAUX_BUCKET } from '../lib/supabase'
import { uploadEvidence } from '../lib/image'
import { PhotoImage } from '../lib/photos.jsx'
import { dateHeure } from '../lib/plateforme'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { IconButton } from '../ds/pumpit/components/core/IconButton.jsx'
import { Tag } from '../ds/pumpit/components/core/Tag.jsx'
import { Textarea } from '../ds/pumpit/components/forms/Textarea.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

// Fil d'une demande d'assistance, côté client ou côté plateforme.
// Les nouveaux messages arrivent en temps réel ; un rafraîchissement toutes les 20 s
// prend le relais si la connexion temps réel tombe (réseau faible en station).
// `stationId` : dossier d'envoi de la photo jointe (côté client uniquement).
export default function Conversation({ demande, cote = 'client', stationId, onChanged }) {
  const [messages, setMessages] = useState([])
  const [texte, setTexte] = useState('')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fin = useRef(null)
  const fichier = useRef(null)
  const id = demande?.id

  async function load() {
    if (!id) return
    const { data } = await supabase.from('assistance_messages').select('*').eq('demande_id', id).order('created_at')
    setMessages(prev => {
      const next = data || []
      if (next.length !== prev.length) {
        supabase.rpc('assistance_marquer_lu', { p_demande: id }).then(() => onChanged && onChanged())
        setTimeout(() => fin.current?.scrollIntoView({ block: 'end' }), 30)
      }
      return next
    })
  }

  useEffect(() => {
    setMessages([]); setErr(''); setTexte(''); setPhoto(null)
    if (!id) return
    load()
    const ch = supabase.channel('assistance-' + id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assistance_messages', filter: `demande_id=eq.${id}` }, load)
      .subscribe()
    const t = setInterval(load, 20000)
    return () => { clearInterval(t); supabase.removeChannel(ch) }
  }, [id])

  async function envoyer(e) {
    e.preventDefault(); setErr('')
    if (!texte.trim()) return
    setBusy(true)
    try {
      let path = null
      if (photo) path = await uploadEvidence(supabase, BORDEREAUX_BUCKET, `${stationId}/assistance`, photo)
      const { error } = await supabase.rpc('assistance_envoyer', { p_demande: id, p_contenu: texte.trim(), p_photo: path })
      if (error) throw error
      setTexte(''); setPhoto(null); await load(); onChanged && onChanged()
    } catch (x) {
      setErr(`Message non envoyé : ${x.message || x}. Vérifiez votre connexion et réessayez.`)
    } finally { setBusy(false) }
  }

  if (!demande) return null
  const mien = (m) => (cote === 'plateforme') === !!m.de_plateforme
  const peutJoindre = cote === 'client' && !!stationId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {messages.map(m => (
          <div key={m.id} style={{ alignSelf: mien(m) ? 'flex-end' : 'flex-start', maxWidth: '86%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: mien(m) ? 'flex-end' : 'flex-start' }}>
            <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-2)', background: mien(m) ? 'var(--vert-fond)' : 'var(--brume)', color: 'var(--nuit)', font: '400 15px/1.5 var(--font-ui)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {m.contenu}
              {m.photo_path && <div style={{ marginTop: 'var(--sp-3)' }}><PhotoImage path={m.photo_path} alt="Photo jointe" size={160} /></div>}
            </div>
            <span style={{ font: '400 12px/1.2 var(--font-ui)', color: 'var(--text-muted)' }}>{m.auteur_nom || (m.de_plateforme ? 'Assistance PumpIT' : 'Client')} · {dateHeure(m.created_at)}</span>
          </div>
        ))}
        <div ref={fin} />
      </div>

      {err && <AlertBanner tone="alarm" title="Envoi impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}

      <form onSubmit={envoyer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <Textarea rows={3} value={texte} onChange={e => setTexte(e.target.value)} maxLength={4000}
          placeholder={demande.statut === 'resolue' ? 'Écrire rouvre la demande.' : 'Votre message'} aria-label="Votre message" />
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
          {peutJoindre && <>
            <IconButton icon="paperclip" tone="solid" title="Joindre une photo" onClick={() => fichier.current?.click()} />
            <input ref={fichier} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { setPhoto(e.target.files?.[0] || null); e.target.value = '' }} />
            {photo && <Tag onRemove={() => setPhoto(null)}>{photo.name}</Tag>}
          </>}
          <Button type="submit" tone="primary" icon="send" disabled={busy || !texte.trim()} style={{ marginLeft: 'auto' }}>{busy ? 'Envoi…' : 'Envoyer'}</Button>
        </div>
      </form>
    </div>
  )
}
