import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuth } from './lib/auth.jsx'
import { StationProvider, useStation } from './lib/station.jsx'
import { useOffre } from './lib/offre.jsx'
import Login from './pages/Login.jsx'
import NotifBanner from './components/NotifBanner.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { Select } from './ds/pumpit/components/forms/Select.jsx'
import { Tag } from './ds/pumpit/components/core/Tag.jsx'
import { Icon } from './ds/pumpit/components/core/Icon.jsx'
import { Viewport } from './ds/pumpit/components/core/Viewport.jsx'
import { Button } from './ds/pumpit/components/core/Button.jsx'
import { AlertBanner } from './ds/pumpit/components/feedback/AlertBanner.jsx'
import { frDate } from './lib/format'

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
const Prevision = lazy(() => import('./pages/Prevision.jsx'))
const Entreprise = lazy(() => import('./pages/Entreprise.jsx'))
const Assistance = lazy(() => import('./pages/Assistance.jsx'))
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'))

// Rôles historiques (gérant, pompiste, vendeuse, admin) : accès opérationnel d'office.
// Tout autre rôle (directeur, comptable, rôle créé depuis l'écran Rôles) ne l'obtient
// que par la permission manage_orders.
function useAccess() {
  const { profile, isAdmin, isPompiste, isVendeuse, isPlatformAdmin, can } = useAuth()
  const { has, activite } = useOffre()   // offre de la station courante
  const isGerant = profile?.role === 'gerant'
  const op = isAdmin || isGerant || isPompiste || isVendeuse || can('manage_orders')
  // Page Entreprise : code d'invitation, abonnement et factures, pour l'administrateur du
  // client. La gestion des clients est dans le back-office (/admin).
  const org = isAdmin || isPlatformAdmin
  // La page Stock suit le gaz, les lubrifiants et la supérette : sans aucune de ces
  // activités dans l'offre (carburant seul), elle n'a rien à montrer.
  const stock = op && (isVendeuse ? activite('superette') : (activite('gaz') || activite('lubrifiant') || activite('superette')))
  return { op, can, isVendeuse, isGerant, org, isPlatformAdmin, has, stock }
}

// Les cinq espaces de l'application. Chaque entrée n'apparaît que si le profil y a droit ;
// un espace sans entrée disparaît de la navigation.
function useSpaces() {
  const { op, can, isVendeuse, isGerant, org, isPlatformAdmin, has, stock } = useAccess()
  const spaces = [
    { key: 'jour', label: "Aujourd'hui", icon: 'sun', items: [
      op && { to: '/saisie', icon: 'file-pen-line', label: isVendeuse ? 'Saisie supérette' : 'Saisie du jour' },
      op && { to: '/controles', icon: 'shield-check', label: 'Contrôles' },
    ] },
    // Son propre onglet en barre du bas (plutôt qu'un sous-onglet d'Aujourd'hui) : accès direct,
    // pas une page de plus à chercher — demandé explicitement pour la version mobile du gérant.
    { key: 'journal', label: 'Journal de bord', icon: 'clipboard-list', items: [
      (op || can('view_journal')) && { to: '/journal', icon: 'clipboard-list', label: 'Journal de bord' },
    ] },
    { key: 'pilotage', label: 'Pilotage', icon: 'gauge', items: [
      can('view_dashboard') && { to: '/tableau', icon: 'layout-dashboard', label: 'Tableau de bord' },
      can('view_alerts') && { to: '/alertes', icon: 'bell', label: 'Alertes' },
      can('view_history') && { to: '/historique', icon: 'calendar-days', label: 'Historique' },
      can('view_prevision') && has('prevision') && { to: '/prevision', icon: 'truck', label: 'Prévision de commande' },
    ] },
    { key: 'stock', label: 'Stock', icon: 'package', items: [
      // Gérant : Commandes en premier (accès direct au tap sur l'onglet Stock de la barre du
      // bas, qui mène toujours au premier élément de l'espace) — c'est ce qu'il consulte le
      // plus souvent, pas le niveau de stock lui-même.
      ...(isGerant ? [
        (op || can('validate_orders')) && { to: '/commandes', icon: 'truck', label: 'Commandes' },
        stock && { to: '/stock', icon: 'package', label: 'Stock et mouvements' },
      ] : [
        stock && { to: '/stock', icon: isVendeuse ? 'shopping-cart' : 'package', label: isVendeuse ? 'Supérette' : 'Stock et mouvements' },
        (op || can('validate_orders')) && { to: '/commandes', icon: 'truck', label: 'Commandes' },
      ]),
      (can('manage_products') || can('view_price_history')) && { to: '/produits', icon: 'book-open', label: 'Produits et prix' },
      can('manage_suppliers') && { to: '/fournisseurs', icon: 'factory', label: 'Fournisseurs' },
    ] },
    { key: 'finance', label: 'Finance', icon: 'wallet', items: [
      can('view_finance') && has('finance') && { to: '/finance', icon: 'chart-column', label: 'Point financier' },
      can('view_bank_recon') && has('finance') && { to: '/rapprochement', icon: 'landmark', label: 'Rapprochement' },
      can('view_ocr_check') && has('bordereaux') && { to: '/verif-photos', icon: 'camera', label: 'Bordereaux' },
    ] },
    { key: 'reglages', label: 'Réglages', icon: 'settings', items: [
      (can('manage_stations_config') || can('manage_team')) && { to: '/stations', icon: 'building-2', label: 'Stations et équipe' },
      (org || can('view_finance')) && { to: '/entreprise', icon: 'landmark', label: 'Entreprise' },
      can('view_audit_log') && has('audit') && { to: '/audit', icon: 'search', label: "Journal d'audit" },
      { to: '/aide', icon: 'circle-question-mark', label: 'Aide' },
      { to: '/assistance', icon: 'life-buoy', label: 'Assistance' },
    ] },
  ].map(s => ({ ...s, items: s.items.filter(Boolean) })).filter(s => s.items.length)
  // Sans page de réglage (gérant, pompiste, vendeuse), l'espace ne contient que l'aide et
  // l'assistance : il s'appelle alors simplement « Aide ».
  const aideSeule = (s) => s.items.every(i => i.to === '/aide' || i.to === '/assistance')
  return spaces.map(s => (s.key === 'reglages' && aideSeule(s)) ? { ...s, label: 'Aide', icon: 'life-buoy' } : s)
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
  const { profile, roleLabel, organisation, isAgent, isAdmin, abonnement, signOut } = useAuth()
  const nav = useNavigate()
  const [reponses, setReponses] = useState(0)
  const { pathname } = useLocation()
  const spaces = useSpaces()
  const space = spaces.find(s => s.items.some(i => pathname.startsWith(i.to))) || spaces[0]
  const page = space?.items.find(i => pathname.startsWith(i.to)) || space?.items[0]
  const initial = (profile?.full_name || '?').slice(0, 1).toUpperCase()
  const logout = () => signOut().then(() => nav('/'))

  // Sur téléphone, la rangée de sous-pages défile : on amène la page courante à l'écran.
  useEffect(() => {
    document.querySelector('.pi-subnav a.active')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])

  // Pastille « réponse de l'assistance non lue ».
  useEffect(() => {
    const compter = () => supabase.from('assistance_demandes').select('id', { count: 'exact', head: true }).eq('non_lu_client', true)
      .then(({ count }) => setReponses(count || 0))
    compter()
    const t = setInterval(compter, 60000)
    return () => clearInterval(t)
  }, [pathname])

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
                  <NavLink key={it.to} to={it.to}><Icon name={it.icon} size={18} />{it.label}
                    {it.to === '/assistance' && reponses > 0 && <span className="pi-count">{reponses}</span>}
                  </NavLink>
                ))}
              </div>
            ))}
            {isAgent && (
              <div>
                <div className="pi-side-group">Plateforme</div>
                <Link to="/admin"><Icon name="activity" size={18} />Back-office</Link>
              </div>
            )}
          </nav>
          <div className="pi-side-user">
            <span className="pi-avatar" aria-hidden="true">{initial}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="n">{profile?.full_name || 'Mon compte'}</div>
              <div className="r">{[roleLabel, organisation?.nom].filter(Boolean).join(' · ')}</div>
            </div>
            <button type="button" className="pi-ghost-dark" title="Se déconnecter" aria-label="Se déconnecter" onClick={logout}><Icon name="log-out" size={18} /></button>
          </div>
        </aside>

        <div className="pi-main">
          <div className="pi-mobile-brand">
            <img src="/brand/pumpit-logo-inverse.png" alt="PumpIT" />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {isAgent && <Link to="/admin" className="pi-ghost-dark" title="Back-office" aria-label="Back-office"><Icon name="activity" size={18} /></Link>}
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

          <main className="content">
            {abonnement?.enEssai && isAdmin && !isAgent && (
              <AlertBanner tone="info" title={`Essai gratuit : ${abonnement.joursRestants === 0 ? 'dernier jour' : `il reste ${abonnement.joursRestants} jour${abonnement.joursRestants > 1 ? 's' : ''}`}`} style={{ marginBottom: 'var(--sp-4)' }}>
                Votre essai se termine le {frDate(organisation.essai_jusqu_au)}. Pour continuer ensuite, contactez PumpIT depuis la page Assistance.
              </AlertBanner>
            )}
            <NotifBanner /><ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary></main>
        </div>

        <nav className="pi-bottom" aria-label="Espaces">
          {spaces.map(s => (
            // Lien simple (pas NavLink) : l'onglet est actif pour toutes les pages de l'espace.
            <Link key={s.key} to={s.items[0].to} className={s.key === space?.key ? 'active' : undefined}
              aria-current={s.key === space?.key ? 'page' : undefined}>
              <Icon name={s.icon} size={22} />{s.label}
              {s.key === 'reglages' && reponses > 0 && <span className="pi-dot" />}
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
  const { session, profile, signOut } = useAuth()
  return (
    <div className="center" style={{ flexDirection: 'column', gap: 'var(--sp-5)', textAlign: 'center', padding: 'var(--sp-6)' }}>
      <img src="/brand/pumpit-logo-principal.png" alt="PumpIT" style={{ height: 40 }} />
      <h2 style={{ fontSize: 24 }}>Compte en attente de validation</h2>
      <p style={{ font: '400 15px/1.55 var(--font-ui)', color: 'var(--text-secondary)', maxWidth: 440, margin: 0 }}>
        {profile?.organisation_id === null
          ? <>Votre compte{session?.user?.email ? ` (${session.user.email})` : ''} est créé, mais le code entreprise saisi n'a pas été reconnu. Communiquez votre e-mail à votre administrateur pour qu'il fasse rattacher le compte.</>
          : <>Votre compte{session?.user?.email ? ` (${session.user.email})` : ''} est créé. Un administrateur doit le valider et vous attribuer une station. Prévenez-le, puis reconnectez-vous.</>}
      </p>
      <Button tone="outline" onClick={signOut}>Se déconnecter</Button>
    </div>
  )
}

// Abonnement suspendu : la base ne renvoie plus aucune donnée à ce client. On l'explique
// clairement plutôt que d'afficher une application vide. L'administrateur du client garde
// l'accès à ses factures.
function Suspended() {
  const { organisation, isAdmin, abonnement, signOut } = useAuth()
  const finEssai = abonnement?.motif === 'essai'
  return (
    <div className="center" style={{ flexDirection: 'column', gap: 'var(--sp-5)', textAlign: 'center', padding: 'var(--sp-6)' }}>
      <img src="/brand/pumpit-logo-principal.png" alt="PumpIT" style={{ height: 40 }} />
      <h2 style={{ fontSize: 24 }}>{finEssai ? 'Essai terminé' : 'Accès suspendu'}</h2>
      <p style={{ font: '400 15px/1.55 var(--font-ui)', color: 'var(--text-secondary)', maxWidth: 460, margin: 0 }}>
        {finEssai
          ? `L'essai gratuit de ${organisation?.nom || 'votre entreprise'} s'est terminé le ${frDate(organisation?.essai_jusqu_au)}. Vos données sont conservées et l'accès revient dès la souscription.`
          : `L'abonnement de ${organisation?.nom || 'votre entreprise'} est suspendu. Vos données sont conservées et l'accès revient dès le règlement.`}
        {isAdmin ? ' Vos factures sont ci-dessous.' : ' Contactez votre administrateur.'}
      </p>
      <div style={{ width: '100%', maxWidth: 720, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
        <Suspense fallback={null}>
          {isAdmin && <Entreprise facturesSeules />}
          <Assistance />
        </Suspense>
      </div>
      <Button tone="outline" onClick={signOut}>Se déconnecter</Button>
    </div>
  )
}

function Loading() {
  return (
    <div className="pi-loading" style={{ minHeight: '50dvh' }}>
      <Icon name="fuel" size={32} className="pi-loading-icon" />
      <div className="pi-loading-bar" />
      <span>Chargement…</span>
    </div>
  )
}

function AppRoutes() {
  const { op, can, isVendeuse, org, has, stock } = useAccess()
  // Première page accessible, dans l'ordre Aujourd'hui > Stock > Pilotage > Finance :
  // sert de destination à toute route interdite au profil courant.
  function home() {
    if (op) return isVendeuse ? (stock ? '/stock' : '/saisie') : '/saisie'
    if (can('validate_orders')) return '/commandes'
    if (can('view_dashboard')) return '/tableau'
    if (can('view_finance') && has('finance')) return '/finance'
    if (can('view_history')) return '/historique'
    return '/aide'
  }
  const guard = (ok, el) => ok ? el : <Navigate to={home()} />

  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/saisie" element={guard(op || can('view_history'), <Submit />)} />
          <Route path="/journal" element={guard(op || can('view_journal'), <Journal />)} />
          <Route path="/controles" element={guard(op, <Inspections />)} />
          <Route path="/tableau" element={guard(can('view_dashboard'), <Dashboard />)} />
          <Route path="/alertes" element={guard(can('view_alerts'), <AlertsPage />)} />
          <Route path="/historique" element={guard(can('view_history'), <History />)} />
          <Route path="/prevision" element={guard(can('view_prevision') && has('prevision'), <Prevision />)} />
          <Route path="/saisies" element={<Navigate to="/historique" />} />
          <Route path="/stock" element={guard(stock, <Stock />)} />
          <Route path="/commandes" element={guard(op || can('validate_orders'), <Orders />)} />
          <Route path="/produits" element={guard(can('manage_products') || can('view_price_history'), <Products />)} />
          <Route path="/fournisseurs" element={guard(can('manage_suppliers'), <Suppliers />)} />
          <Route path="/finance" element={guard(can('view_finance') && has('finance'), <Finance />)} />
          <Route path="/rapprochement" element={guard(can('view_bank_recon') && has('finance'), <BankRecon />)} />
          <Route path="/verif-photos" element={guard(can('view_ocr_check') && has('bordereaux'), <OcrCheck />)} />
          <Route path="/stations" element={guard(can('manage_stations_config') || can('manage_team'), <Stations />)} />
          <Route path="/entreprise" element={guard(org || can('view_finance'), <Entreprise />)} />
          <Route path="/audit" element={guard(can('view_audit_log') && has('audit'), <AuditLog />)} />
          <Route path="/aide" element={<Aide />} />
          <Route path="/assistance" element={<Assistance />} />
          <Route path="*" element={<Navigate to={home()} />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}

export default function App() {
  const { session, loading, profileLoading, profile, suspendu, organisationReady, isAgent } = useAuth()
  const { pathname } = useLocation()
  if (loading) return <Loading />
  if (!session) return <Login />
  // profileLoading (et pas seulement `!profile`) : à chaque connexion, la session est connue
  // avant le profil. Sans ce garde-fou, l'écran d'attente de validation s'affichait un instant
  // même pour un compte déjà validé.
  if (profileLoading) return <Loading />
  if (!profile?.approved) return <PendingApproval />
  if (!organisationReady) return <Loading />
  if (suspendu) return <Suspended />
  // Back-office : espace séparé de l'application des clients, réservé aux agents
  // PumpIT. Les données, elles, sont protégées par la base quel que soit l'écran.
  if (pathname.startsWith('/admin')) {
    return isAgent ? <Suspense fallback={<Loading />}><AdminApp /></Suspense> : <Navigate to="/" />
  }
  // Un agent PumpIT qui n'a « ouvert » aucun client n'a rien à voir dans l'application : back-office.
  if (isAgent && !profile.organisation_id) return <Navigate to="/admin" />
  return (
    <StationProvider>
      <AppRoutes />
    </StationProvider>
  )
}
