import { describe, it, expect } from 'vitest'
import { compressImage } from '../src/lib/image.js'

// compressImage doit être « jamais bloquant » : elle renvoie toujours un fichier
// exploitable (l’original) quand la compression n’est pas possible/pertinente.
describe('compressImage (branches sûres)', () => {
  it('retourne l’entrée telle quelle si ce n’est pas une image', async () => {
    const fake = { type: 'text/plain', name: 'doc.txt', size: 10 }
    expect(await compressImage(fake)).toBe(fake)
  })

  it('retourne null/undefined tel quel', async () => {
    expect(await compressImage(null)).toBeNull()
    expect(await compressImage(undefined)).toBeUndefined()
  })

  it('ne casse pas les GIF animés (retour original)', async () => {
    const gif = { type: 'image/gif', name: 'anim.gif', size: 100 }
    expect(await compressImage(gif)).toBe(gif)
  })

  it('retombe sur l’original quand la compression échoue (pas de canvas en jsdom)', async () => {
    // createImageBitmap n’existe pas sous jsdom -> le try/catch renvoie l’original.
    const png = { type: 'image/png', name: 'photo.png', size: 12345 }
    expect(await compressImage(png)).toBe(png)
  })
})
