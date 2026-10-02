import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import NotifBanner from '../src/components/NotifBanner.jsx'

// --- Mocks -----------------------------------------------------------------
// Faux « query builder » Supabase : select/eq/order renvoient le même objet,
// et l’objet est « thenable » (awaitable) et résout { data }.
const state = { notifs: [] }

function makeQuery(result) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    update: () => q,
    then: (resolve) => Promise.resolve(result).then(resolve),
  }
  return q
}

vi.mock('../src/lib/supabase', () => ({
  supabase: { from: () => makeQuery({ data: state.notifs }) },
  BORDEREAUX_BUCKET: 'bordereaux',
}))

// On isole le composant de la vraie chaîne Auth -> Station (qui touche la DB).
vi.mock('../src/lib/station.jsx', () => ({
  useStation: () => ({ stationId: 1 }),
  StationProvider: ({ children }) => children,
}))

// --- Tests -----------------------------------------------------------------
describe('<NotifBanner />', () => {
  beforeEach(() => {
    state.notifs = []
  })

  it('ne rend rien quand il n’y a aucune notification', async () => {
    const { container } = render(<NotifBanner />)
    // load() résout de façon asynchrone, mais avec 0 notif le composant reste vide.
    // waitFor enveloppe l’attente dans act() et vide les mises à jour en attente.
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('affiche les notifications non résolues avec un bouton « Traité »', async () => {
    state.notifs = [
      { id: 1, message: 'Versement manquant du 12/07', resolved: false },
      { id: 2, message: 'Stock bas carburant', resolved: false },
    ]
    render(<NotifBanner />)
    expect(await screen.findByText('Versement manquant du 12/07')).toBeInTheDocument()
    expect(screen.getByText('Stock bas carburant')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Traité' })).toHaveLength(2)
  })
})
