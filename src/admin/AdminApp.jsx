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
const Stats = lazy(() => import('./Stats.jsx'))
const Offres = lazy(() => import('./Offres.jsx'))
const Compta = lazy(() => import('./Compta.jsx'))
const Agents = lazy(() => import('./Agents.jsx'))
const Notifications = lazy(() => import('./Notifications.jsx'))

// Back-office PumpIT : l'espace de l'exploitant de la plateforme, séparé de l'application
// des clients. Ici on ne voit pas « un client » mais tous : supervision, abonnements,
// factures, assistance. Accès réservé à l'administrateur de la plateforme (contrôlé dans
// App.jsx pour l'affichage, et par la base pour chaque donnée).
const ROLE_LABEL = { super_admin: 'Super administrateur', support: 'Support', comptable: 'Comptable', commercial: 'Commercial' }

// Chaque rubrique demande une permission : un agent ne voit que ce que son rôle autorise.
// La base applique les mêmes permissions à chaque lecture et à chaque action.
const NAV = [
  { to: '/admin', end: true, perm: 'supervision', icon: 'activity', label: 'Supervision', court: 'Suivi', el: <Overview /> },
  { to: '/admin/statistiques', perm: 'supervision', icon: 'chart-column', label: 'Statistiques', court: 'Stats', el: <Stats /> },
  { to: '/admin/clients', perm: 'clients', icon: 'users', label: 'Clients', titre: 'Clients et abonnements', court: 'Clients', el: <Clients /> },
  { to: '/admin/offres', perm: 'offres', icon: 'package', label: 'Offres', titre: 'Offres et fonctions', court: 'Offres', el: <Offres /> },
  { to: '/admin/comptabilite', perm: 'facturation', icon: 'wallet', label: 'Comptabilité', court: 'Compta', el: <Compta /> },
  { to: '/admin/assistance', perm: 'assistance', icon: 'message-circle', label: 'Assistance', court: 'Aide', el: <Inbox /> },
  { to: '/admin/equipe', perm: 'agents', icon: 'shield-check', label: 'Équipe PumpIT', court: 'Équipe', el: <Agents /> },
  { to: '/admin/notifications', perm: 'notifications', icon: 'bell', label: 'Notifications', court: 'Notifs', el: <Notifications /> },
  { to: '/admin/reglages', perm: 'reglages', icon: 'settings', label: 'Réglages', court: 'Réglages', el: <Reglages /> },
]

export default function AdminApp() {
  const { profile, organisation, agentCan, signOut } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [nonLus, setNonLus] = useState(0)
  const nav_ = NAV.filter(n => agentCan(n.perm))
  const page = [...nav_].reverse().find(n => pathname.startsWith(n.to)) || nav_[0] || NAV[0]
  const accueil = nav_[0]?.to || '/'
  const initial = (profile?.full_name || '?').slice(0, 1).toUpperCase()

  // Pastille « demandes non lues », rafraîchie à chaque changement de page et toutes les 30 s.
  useEffect(() => {
    if (!agentCan('assistance')) return
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
            {nav_.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <Icon name={n.icon} size={18} />{n.label}
                {n.to === '/admin/assistance' && nonLus > 0 && <span className="pi-count">{nonLus}</span>}
              </NavLink>
            ))}
            {organisation && <>
              <div className="pi-side-group">Application</div>
              <Link to="/"><Icon name="external-link" size={18} />Ouvrir {organisation.nom}</Link>
            </>}
          </nav>
          <div className="pi-side-user">
            <span className="pi-avatar" aria-hidden="true">{initial}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="n">{profile?.full_name || 'Mon compte'}</div>
              <div className="r">{ROLE_LABEL[profile?.plateforme_role] || 'Agent PumpIT'}</div>
            </div>
            <button type="button" className="pi-ghost-dark" title="Se déconnecter" aria-label="Se déconnecter" onClick={() => signOut().then(() => nav('/'))}><Icon name="log-out" size={18} /></button>
          </div>
        </aside>

        <div className="pi-main">
          <div className="pi-mobile-brand">
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
              <img src="/brand/pumpit-logo-inverse.png" alt="PumpIT" /><span className="pi-bo-tag">Back-office</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {organisation && <Link to="/" className="pi-ghost-dark" title="Ouvrir l'application" aria-label="Ouvrir l'application"><Icon name="external-link" size={18} /></Link>}
              <button type="button" className="pi-ghost-dark" title="Se déconnecter" aria-label="Se déconnecter" onClick={() => signOut().then(() => nav('/'))}><Icon name="log-out" size={18} /></button>
            </span>
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
                  {nav_.map(n => <Route key={n.to} path={n.to} element={n.el} />)}
                  <Route path="*" element={<Navigate to={accueil} />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>

        <nav className="pi-bottom pi-bottom-scroll" aria-label="Back-office">
          {nav_.map(n => (
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
