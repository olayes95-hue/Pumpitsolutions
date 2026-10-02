// Envoie le fichier BRUT immédiatement au stockage (pas au submit final) : sur téléphone,
// l'appareil photo natif peut faire recharger l'onglet en arrière-plan (mémoire faible) — un File
// gardé en mémoire jusqu'au submit disparaît alors, obligeant à reprendre la photo. En l'envoyant
// dès la sélection, seul le chemin (une chaîne, sérialisable) reste à associer à la ligne au submit.
// PAS de compression ici volontairement (voir compressStoredPhoto ci-dessous) : décoder/redimensionner/
// ré-encoder une photo pleine résolution est une opération gourmande en mémoire, et la faire juste
// après le retour de l'appareil photo — le moment où l'OS est déjà sous la plus forte pression
// mémoire à cause de l'appareil photo natif — pouvait provoquer le rechargement qu'on essayait
// d'éviter. La compression est reportée au submit final, un moment plus sûr.
export async function uploadEvidence(supabase, bucket, folder, file) {
  const path = `${folder}/${Date.now()}_${(file.name || 'photo').replace(/[^\w.\-]/g, '_')}`
  const { error } = await supabase.storage.from(bucket).upload(path, file)
  if (error) throw error
  return path
}

// Recompresse en place (même chemin) un fichier déjà envoyé brut par uploadEvidence — appelé au
// submit final. Jamais bloquant : une erreur (réseau, fichier déjà supprimé...) laisse simplement
// le fichier brut tel quel, ce n'est qu'une optimisation de stockage, pas une étape critique.
export async function compressStoredPhoto(supabase, bucket, path) {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path)
    if (error || !data) return
    const compressed = await compressImage(data)
    if (compressed === data) return // pas de gain, ou pas une image compressible
    await supabase.storage.from(bucket).update(path, compressed)
  } catch { /* jamais bloquant */ }
}

export async function compressImage(file, { maxDim = 1600, quality = 0.7 } = {}) {
  try {
    if (!file || !file.type || !file.type.startsWith('image/')) return file
    if (file.type === 'image/gif') return file // ne pas casser les GIF animés
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap
    const scale = Math.min(1, maxDim / Math.max(width, height))
    width = Math.round(width * scale); height = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file // garde l'original s'il est déjà plus petit
    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || 0 })
  } catch {
    return file // en cas d'échec, on envoie l'original (jamais bloquant)
  }
}
