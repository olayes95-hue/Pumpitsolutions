import { useEffect, useState } from 'react'
import { supabase, BORDEREAUX_BUCKET } from './supabase'
import { EvidenceThumb } from '../ds/pumpit/components/evidence/EvidenceThumb.jsx'

// Photos du bucket privé `bordereaux` : aucun lien public. Chaque affichage passe par un
// lien signé, valable une heure, que Supabase ne délivre que si le compte a le droit de
// voir la photo (règle can_read_photo côté base).
//
// Les demandes faites au même instant (un tableau de 40 lignes, une galerie) sont
// regroupées en un seul appel, et les liens sont gardés en mémoire 50 minutes.
const DUREE = 3600
const VALIDITE_CACHE = 50 * 60 * 1000
const cache = new Map()          // path -> { url, exp }
let attente = new Map()          // path -> [resolve, ...]
let minuteur = null

async function vider() {
  const lot = attente; attente = new Map(); minuteur = null
  const paths = [...lot.keys()]
  let urls = {}
  try {
    const { data } = await supabase.storage.from(BORDEREAUX_BUCKET).createSignedUrls(paths, DUREE)
    for (const s of data || []) if (s.signedUrl && s.path) urls[s.path] = s.signedUrl
  } catch { /* liens absents : les vignettes restent vides, sans bloquer la page */ }
  for (const p of paths) {
    if (urls[p]) cache.set(p, { url: urls[p], exp: Date.now() + VALIDITE_CACHE })
    for (const resolve of lot.get(p)) resolve(urls[p] || '')
  }
}

export function signedUrl(path) {
  if (!path) return Promise.resolve('')
  const c = cache.get(path)
  if (c && c.exp > Date.now()) return Promise.resolve(c.url)
  return new Promise(resolve => {
    if (!attente.has(path)) attente.set(path, [])
    attente.get(path).push(resolve)
    if (!minuteur) minuteur = setTimeout(vider, 20)
  })
}

export function useSignedUrl(path) {
  const [url, setUrl] = useState(() => { const c = cache.get(path); return c && c.exp > Date.now() ? c.url : '' })
  useEffect(() => {
    let actif = true
    setUrl('')
    signedUrl(path).then(u => { if (actif) setUrl(u) })
    return () => { actif = false }
  }, [path])
  return url
}

// Lien « Voir la photo ». Le lien signé est préparé à l'affichage : le clic ouvre un vrai
// lien (pas de window.open après attente, que les navigateurs mobiles bloquent).
export function PhotoLink({ path, children = 'Photo', style }) {
  const url = useSignedUrl(path)
  if (!path) return null
  if (!url) return <span style={{ color: 'var(--text-disabled)', ...style }}>{children}</span>
  return <a href={url} target="_blank" rel="noreferrer" style={style}>{children}</a>
}

// Image cliquable (ouvre la photo en grand).
export function PhotoImage({ path, alt = '', size = 96, style }) {
  const url = useSignedUrl(path)
  const box = { width: size, height: size, borderRadius: 'var(--radius-2)', background: 'var(--gris-fond)', display: 'block', objectFit: 'cover', ...style }
  if (!url) return <span aria-hidden="true" style={box} />
  return <a href={url} target="_blank" rel="noreferrer" style={{ display: 'inline-block' }}><img src={url} alt={alt} style={box} /></a>
}

// Vignette du design system branchée sur un chemin de photo.
export function PhotoThumb({ path, ...rest }) {
  const url = useSignedUrl(path)
  return <EvidenceThumb src={url || undefined} onClick={url ? () => window.open(url, '_blank', 'noopener') : undefined} {...rest} />
}
