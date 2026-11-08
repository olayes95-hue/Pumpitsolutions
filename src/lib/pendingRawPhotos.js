// File d'attente persistante (localStorage, pas en mémoire) des photos envoyées brutes
// (uploadEvidence) qui restent à recompresser — voir lib/image.js:compressStoredPhoto.
//
// Pourquoi : la compression est tentée à la fin de la saisie (submit final), à partir d'une
// simple liste en mémoire (useRef). Sur mobile, l'appareil photo natif peut recharger l'onglet
// entre la prise de photo et le submit (cas documenté dans Submit.jsx) — la liste en mémoire
// disparaît alors avec l'onglet, et la photo reste brute (parfois plusieurs Mo) pour toujours.
// En la notant aussi ici (survit à un rechargement), on peut retenter plus tard, à la prochaine
// ouverture de l'app — voir l'appel à retryPendingRawPhotos() dans App.jsx.
//
// Nombre d'essais plafonné : un fichier qui échoue sans arrêt (ex. supprimé depuis, comme lors
// du remplacement d'une photo compteur) ne doit pas rester indéfiniment dans la liste.
const KEY = 'pi_pending_raw_photos'
const MAX_ATTEMPTS = 5

function readList() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function writeList(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* stockage plein/indisponible — pas bloquant */ }
}

export function addPendingRawPhoto(bucket, path) {
  const list = readList()
  if (!list.some(x => x.bucket === bucket && x.path === path)) {
    list.push({ bucket, path, attempts: 0 })
    writeList(list)
  }
}
export function removePendingRawPhoto(bucket, path) {
  writeList(readList().filter(x => !(x.bucket === bucket && x.path === path)))
}

// Reprend la compression de tout ce qui n'a pas pu l'être lors d'une session précédente —
// appelé une fois au chargement de l'app (voir App.jsx), indépendamment de la station/date
// affichée (l'app peut avoir redémarré sur un autre écran que celui qui a pris la photo).
export async function retryPendingRawPhotos(supabase) {
  const list = readList()
  if (!list.length) return
  const { compressStoredPhoto } = await import('./image')
  const reste = []
  for (const item of list) {
    const ok = await compressStoredPhoto(supabase, item.bucket, item.path)
    if (!ok && item.attempts + 1 < MAX_ATTEMPTS) reste.push({ ...item, attempts: item.attempts + 1 })
    // ok, ou nombre d'essais épuisé : on abandonne cette entrée (fichier probablement déjà
    // supprimé ou introuvable — ne doit pas rester indéfiniment dans la liste).
  }
  writeList(reste)
}
