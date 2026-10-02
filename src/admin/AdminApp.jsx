import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import { Icon } from '../ds/pumpit/components/core/Icon.jsx'
import { Viewport } from '../ds/pumpit/components/core/Viewport.jsx'

const Overview = lazy(() => import('./Overview.jsx'))
const Clients = lazy(() => import('./Clients.jsx'))
const Inbox = lazy(() => import('./Inbox.jsx'))
const Reglages = lazy(() => import('./Reglages.jsx'))

// Back-office PumpIT : l'espace de l'exploitant de la plateforme, séparé de l'application
// des clients. Ici on ne voit pas « un client » mais tous : supervision, abonnements,
// factures, assistance. Accès réservé à l'administrateur de la plateforme (contrôlé dans
// App.jsx pour l'affichage, et par la base pour chaque donnée).
const NAV = [
  { to: '/admin', end: true, icon: 'activity', label: 'Supervision', court: 'Supervision' },
  { to: '/admin/clients', icon: 'users', label: 'Clients', titre: 'Clients et abonnements', court: 'Clients' },
  { to: '/admin/assistance', icon: 'message-circle', label: 'Assistance', court: 'Assistance' },
  { to: '/admin/reglages', icon: 'settings', label: 'Réglages', court: 'Réglages' },
]

export default function AdminApp() {
  const { profile, organisation, signOut } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [nonLus, setNonLus] = useState(0)
  const page = [...NAV].reverse().find(n => pathname.startsWith(n.to)) || NAV[0]
  const initial = (profile?.full_name || '?').slice(0, 1).toUpperCase()

  // Pastille « demandes non lues », rafraîchie à chaque changement de page et toutes les 30 s.
  useEffect(() => {
    const compter = () => supabase.from('assistance_demandes').select('id', { count: 'exact', head: true }).eq('non_lu_plateforme', true)
      .then(({ count }) => setNonLus(count || 0))
    compter()
    const t = setInterval(compter, 30000)
    return () => clearInterval(t)
  }, [pathname])

  return (
    <Viewport>
      <div className="pi-app">
        <aside className="pi-side" aria-label="Navigation du back-office">
          <img className="pi-side-logo" src="/brand/pumpit-logo-inverse.png" alt="PumpIT" style={{ marginBottom: 'var(--sp-2)' }} />
          <div style={{ margin: '0 var(--sp-3) var(--sp-5)' }}><span className="pi-bo-tag">Back-office</span></div>
          <nav className="pi-side-scroll">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <Icon name={n.icon} size={18} />{n.label}
                {n.to === '/admin/assistance' && nonLus > 0 && <span className="pi-count">{nonLus}</span>}
              </NavLink>
            ))}
            <div className="pi-side-group">Application</div>
            <Link to="/"><Icon name="external-link" size={18} />Ouvrir {organisation?.nom || "l'application"}</Link>
          </nav>
          <div className="pi-side-user">
            <span className="pi-avatar" aria-hidden="true">{initial}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="n">{profile?.full_name || 'Mon compte'}</div>
              <div className="r">Administrateur de la plateforme</div>
            </div>
            <button type="button" className="pi-ghost-dark" title="Se déconnecter" aria-label="Se déconnecter" onClick={() => signOut().then(() => nav('/'))}><Icon name="log-out" size={18} /></button>
          </div>
        </aside>

        <div className="pi-main">
          <div className="pi-mobile-brand">
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
              <img src="/brand/pumpit-logo-inverse.png" alt="PumpIT" /><span className="pi-bo-tag">Back-office</span>
            </span>
            <Link to="/" className="pi-ghost-dark" title="Ouvrir l'application" aria-label="Ouvrir l'application"><Icon name="external-link" size={18} /></Link>
          </div>
          <header className="pi-top">
            <div style={{ minWidth: 0 }}>
              <div className="pi-top-space">Back-office</div>
              <h1>{page.titre || page.label}</h1>
            </div>
          </header>
          <main className="content">
            <ErrorBoundary resetKey={pathname}>
              <Suspense fallback={<div className="center" style={{ minHeight: '50dvh' }}>Chargement…</div>}>
                <Routes>
                  <Route path="/admin" element={<Overview />} />
                  <Route path="/admin/clients" element={<Clients />} />
                  <Route path="/admin/assistance" element={<Inbox />} />
                  <Route path="/admin/reglages" element={<Reglages />} />
                  <Route path="*" element={<Navigate to="/admin" />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>

        <nav className="pi-bottom" aria-label="Back-office">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <Icon name={n.icon} size={22} />{n.court}
              {n.to === '/admin/assistance' && nonLus > 0 && <span className="pi-dot" />}
            </NavLink>
          ))}
        </nav>
      </div>
    </Viewport>
  )
}
