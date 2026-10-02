import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { StationProvider, useStation } from './lib/station.jsx'
import Login from './pages/Login.jsx'
import NotifBanner from './components/NotifBanner.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { Select } from './ds/pumpit/components/forms/Select.jsx'
import { Tag } from './ds/pumpit/components/core/Tag.jsx'
import { Icon } from './ds/pumpit/components/core/Icon.jsx'
import { Viewport } from './ds/pumpit/components/core/Viewport.jsx'
import { Button } from './ds/pumpit/components/core/Button.jsx'

// Chargées à la demande : réduit fortement le bundle initial (surtout pour gérant et vendeuse sur mobile).
const Submit = lazy(() => import('./pages/Submit.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const AlertsPage = lazy(() => import('./pages/Alerts.jsx'))
const History = lazy(() => import('./pages/History.jsx'))
const Suppliers = lazy(() => import('./pages/Suppliers.jsx'))
const Stations = lazy(() => import('./pages/Stations.jsx'))
const BankRecon = lazy(() => import('./pages/BankRecon.jsx'))
const Orders = lazy(() => import('./pages/Orders.jsx'))
const Inspections = lazy(() => import('./pages/Inspections.jsx'))
const OcrCheck = lazy(() => import('./pages/OcrCheck.jsx'))
const AuditLog = lazy(() => import('./pages/AuditLog.jsx'))
const Finance = lazy(() => import('./pages/Finance.jsx'))
const Products = lazy(() => import('./pages/Products.jsx'))
const Stock = lazy(() => import('./pages/Stock.jsx'))
const Aide = lazy(() => import('./pages/Aide.jsx'))
const Journal = lazy(() => import('./pages/Journal.jsx'))

// Rôles historiques (gérant, pompiste, vendeuse, admin) : accès opérationnel d'office.
// Tout autre rôle (directeur, comptable, rôle créé depuis l'écran Rôles) ne l'obtient
// que par la permission manage_orders.
function useAccess() {
  const { profile, isAdmin, isPompiste, isVendeuse, can } = useAuth()
  const op = isAdmin || profile?.role === 'gerant' || isPompiste || isVendeuse || can('manage_orders')
  return { op, can, isVendeuse }
}

// Les cinq espaces de l'application. Chaque entrée n'apparaît que si le profil y a droit ;
// un espace sans entrée disparaît de la navigation.
function useSpaces() {
  const { op, can, isVendeuse } = useAccess()
  const spaces = [
    { key: 'jour', label: "Aujourd'hui", icon: 'sun', items: [
      op && { to: '/saisie', icon: 'file-pen-line', label: isVendeuse ? 'Saisie supérette' : 'Saisie du jour' },
      (op || can('view_journal')) && { to: '/journal', icon: 'clipboard-list', label: 'Journal de bord' },
      op && { to: '/controles', icon: 'shield-check', label: 'Contrôles' },
    ] },
    { key: 'pilotage', label: 'Pilotage', icon: 'gauge', items: [
      can('view_dashboard') && { to: '/tableau', icon: 'layout-dashboard', label: 'Tableau de bord' },
      can('view_alerts') && { to: '/alertes', icon: 'bell', label: 'Alertes' },
      can('view_history') && { to: '/historique', icon: 'calendar-days', label: 'Historique' },
    ] },
    { key: 'stock', label: 'Stock', icon: 'package', items: [
      op && { to: '/stock', icon: isVendeuse ? 'shopping-cart' : 'package', label: isVendeuse ? 'Supérette' : 'Stock et mouvements' },
      (op || can('validate_orders')) && { to: '/commandes', icon: 'truck', label: 'Commandes' },
      can('manage_products') && { to: '/produits', icon: 'book-open', label: 'Produits et prix' },
      can('manage_suppliers') && { to: '/fournisseurs', icon: 'factory', label: 'Fournisseurs' },
    ] },
    { key: 'finance', label: 'Finance', icon: 'wallet', items: [
      can('view_finance') && { to: '/finance', icon: 'chart-column', label: 'Point financier' },
      can('view_bank_recon') && { to: '/rapprochement', icon: 'landmark', label: 'Rapprochement' },
      can('view_ocr_check') && { to: '/verif-photos', icon: 'camera', label: 'Bordereaux' },
    ] },
    { key: 'reglages', label: 'Réglages', icon: 'settings', items: [
      (can('manage_stations_config') || can('manage_team')) && { to: '/stations', icon: 'building-2', label: 'Stations et équipe' },
      can('view_audit_log') && { to: '/audit', icon: 'search', label: "Journal d'audit" },
      { to: '/aide', icon: 'circle-question-mark', label: 'Aide' },
    ] },
  ].map(s => ({ ...s, items: s.items.filter(Boolean) })).filter(s => s.items.length)
  // Un espace Réglages réduit à la seule page Aide s'appelle simplement « Aide ».
  return spaces.map(s => (s.key === 'reglages' && s.items.length === 1) ? { ...s, label: 'Aide', icon: 'circle-question-mark' } : s)
}

function StationPicker() {
  const { stations, stationId, setStationId, current } = useStation()
  if (stations.length <= 1) return <Tag><Icon name="map-pin" size={14} /> {current?.nom || 'Ma station'}</Tag>
  return (
    <Select size="sm" aria-label="Station" value={stationId || ''} onChange={e => setStationId(Number(e.target.value))}
      options={stations.map(s => ({ value: s.id, label: s.nom }))} style={{ maxWidth: 200 }} />
  )
}

function Shell({ children }) {
  const { profile, roleLabel, signOut } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const spaces = useSpaces()
  const space = spaces.find(s => s.items.some(i => pathname.startsWith(i.to))) || spaces[0]
  const page = space?.items.find(i => pathname.startsWith(i.to)) || space?.items[0]
  const initial = (profile?.full_name || '?').slice(0, 1).toUpperCase()
  const logout = () => signOut().then(() => nav('/'))

  return (
    <Viewport>
      <div className="pi-app">
        <aside className="pi-side" aria-label="Navigation principale">
          <img className="pi-side-logo" src="/brand/pumpit-logo-inverse.png" alt="PumpIT" />
          <nav className="pi-side-scroll">
            {spaces.map(s => (
              <div key={s.key}>
                <div className="pi-side-group">{s.label}</div>
                {s.items.map(it => (
                  <NavLink key={it.to} to={it.to}><Icon name={it.icon} size={18} />{it.label}</NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="pi-side-user">
            <span className="pi-avatar" aria-hidden="true">{initial}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="n">{profile?.full_name || 'Mon compte'}</div>
              <div className="r">{roleLabel}</div>
            </div>
            <button type="button" className="pi-ghost-dark" title="Se déconnecter" aria-label="Se déconnecter" onClick={logout}><Icon name="log-out" size={18} /></button>
          </div>
        </aside>

        <div className="pi-main">
          <div className="pi-mobile-brand">
            <img src="/brand/pumpit-logo-inverse.png" alt="PumpIT" />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="pi-avatar" aria-hidden="true" style={{ width: 30, height: 30, fontSize: 13 }}>{initial}</span>
              <button type="button" className="pi-ghost-dark" title="Se déconnecter" aria-label="Se déconnecter" onClick={logout}><Icon name="log-out" size={18} /></button>
            </span>
          </div>

          <header className="pi-top">
            <div style={{ minWidth: 0 }}>
              <div className="pi-top-space">{space?.label}</div>
              <h1>{page?.label}</h1>
            </div>
            <div className="pi-top-right"><StationPicker /></div>
          </header>

          {space && space.items.length > 1 && (
            <nav className="pi-subnav" aria-label={space.label}>
              {space.items.map(it => <NavLink key={it.to} to={it.to}>{it.label}</NavLink>)}
            </nav>
          )}

          <main className="content"><NotifBanner /><ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary></main>
        </div>

        <nav className="pi-bottom" aria-label="Espaces">
          {spaces.map(s => (
            // Lien simple (pas NavLink) : l'onglet est actif pour toutes les pages de l'espace.
            <Link key={s.key} to={s.items[0].to} className={s.key === space?.key ? 'active' : undefined}
              aria-current={s.key === space?.key ? 'page' : undefined}>
              <Icon name={s.icon} size={22} />{s.label}
            </Link>
          ))}
        </nav>
      </div>
    </Viewport>
  )
}

// Compte créé mais pas encore validé par un administrateur, ou validé sans station attribuée.
// Bloque tout accès opérationnel : mieux vaut un message clair qu'une application vide.
function PendingApproval() {
  const { session, signOut } = useAuth()
  return (
    <div className="center" style={{ flexDirection: 'column', gap: 'var(--sp-5)', textAlign: 'center', padding: 'var(--sp-6)' }}>
      <img src="/brand/pumpit-logo-principal.png" alt="PumpIT" style={{ height: 40 }} />
      <h2 style={{ fontSize: 24 }}>Compte en attente de validation</h2>
      <p style={{ font: '400 15px/1.55 var(--font-ui)', color: 'var(--text-secondary)', maxWidth: 440, margin: 0 }}>
        Votre compte{session?.user?.email ? ` (${session.user.email})` : ''} est créé. Un administrateur doit le valider et vous attribuer une station. Prévenez-le, puis reconnectez-vous.
      </p>
      <Button tone="outline" onClick={signOut}>Se déconnecter</Button>
    </div>
  )
}

function Loading() {
  return <div className="center" style={{ minHeight: '50dvh' }}>Chargement…</div>
}

function AppRoutes() {
  const { op, can, isVendeuse } = useAccess()
  // Première page accessible, dans l'ordre Aujourd'hui > Stock > Pilotage > Finance :
  // sert de destination à toute route interdite au profil courant.
  function home() {
    if (op) return isVendeuse ? '/stock' : '/saisie'
    if (can('validate_orders')) return '/commandes'
    if (can('view_dashboard')) return '/tableau'
    if (can('view_finance')) return '/finance'
    if (can('view_history')) return '/historique'
    return '/aide'
  }
  const guard = (ok, el) => ok ? el : <Navigate to={home()} />

  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/saisie" element={guard(op, <Submit />)} />
          <Route path="/journal" element={guard(op || can('view_journal'), <Journal />)} />
          <Route path="/controles" element={guard(op, <Inspections />)} />
          <Route path="/tableau" element={guard(can('view_dashboard'), <Dashboard />)} />
          <Route path="/alertes" element={guard(can('view_alerts'), <AlertsPage />)} />
          <Route path="/historique" element={guard(can('view_history'), <History />)} />
          <Route path="/saisies" element={<Navigate to="/historique" />} />
          <Route path="/stock" element={guard(op, <Stock />)} />
          <Route path="/commandes" element={guard(op || can('validate_orders'), <Orders />)} />
          <Route path="/produits" element={guard(can('manage_products'), <Products />)} />
          <Route path="/fournisseurs" element={guard(can('manage_suppliers'), <Suppliers />)} />
          <Route path="/finance" element={guard(can('view_finance'), <Finance />)} />
          <Route path="/rapprochement" element={guard(can('view_bank_recon'), <BankRecon />)} />
          <Route path="/verif-photos" element={guard(can('view_ocr_check'), <OcrCheck />)} />
          <Route path="/stations" element={guard(can('manage_stations_config') || can('manage_team'), <Stations />)} />
          <Route path="/audit" element={guard(can('view_audit_log'), <AuditLog />)} />
          <Route path="/aide" element={<Aide />} />
          <Route path="*" element={<Navigate to={home()} />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}

export default function App() {
  const { session, loading, profileLoading, profile } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Login />
  // profileLoading (et pas seulement `!profile`) : à chaque connexion, la session est connue
  // avant le profil. Sans ce garde-fou, l'écran d'attente de validation s'affichait un instant
  // même pour un compte déjà validé.
  if (profileLoading) return <Loading />
  if (!profile?.approved) return <PendingApproval />
  return (
    <StationProvider>
      <AppRoutes />
    </StationProvider>
  )
}
