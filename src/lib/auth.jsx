import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

const SIGNIN_KEY = 'station_signin_at'
const DECONNEXION_DEFAUT_HEURES = 24

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [permissions, setPermissions] = useState(new Set())
  const [roleLabel, setRoleLabel] = useState('')
  const [loading, setLoading] = useState(true)
  // Distinct de `loading` (qui ne couvre que le tout premier chargement de la session) :
  // à chaque connexion/changement de session, onAuthStateChange met `session` à jour
  // immédiatement, avant que loadProfile() ait fini — sans ce flag, profile reste `null`
  // pendant ce court instant et App.jsx affichait à tort l'écran "en attente de validation"
  // pour un compte déjà validé, le temps que le vrai profil arrive.
  const [profileLoading, setProfileLoading] = useState(true)
  const [deconnexionHeures, setDeconnexionHeures] = useState(DECONNEXION_DEFAUT_HEURES)

  async function loadProfile(userId) {
    if (!userId) { setProfile(null); setPermissions(new Set()); setProfileLoading(false); return }
    setProfileLoading(true)
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data || null)
    // L'admin n'a jamais de ligne dans role_permissions (son accès passe toujours par
    // is_admin() côté RLS / isAdmin côté front, jamais par la matrice) — inutile de la
    // charger pour lui, et ça évite qu'une matrice mal configurée le concerne un jour.
    if (data && data.role !== 'admin') {
      const { data: rp } = await supabase.from('role_permissions').select('permission_key').eq('role_key', data.role)
      setPermissions(new Set((rp || []).map(r => r.permission_key)))
    } else {
      setPermissions(new Set())
    }
    setProfileLoading(false)
  }

  useEffect(() => {
    // Filet de sécurité : si getSession() ne répond jamais (réseau capricieux, verrou du SDK
    // malgré le contournement dans lib/supabase.js), ne pas bloquer l'app indéfiniment sur
    // "Chargement…" — onAuthStateChange, abonné juste après, mettra à jour la session dès
    // qu'elle sera réellement connue.
    let settled = false
    const timeout = setTimeout(() => { if (!settled) setLoading(false) }, 6000)
    supabase.auth.getSession().then(async ({ data }) => {
      settled = true; clearTimeout(timeout)
      setSession(data.session)
      await loadProfile(data.session?.user?.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      setSession(s)
      await loadProfile(s?.user?.id)
      if (event === 'SIGNED_IN') localStorage.setItem(SIGNIN_KEY, String(Date.now()))
      if (event === 'SIGNED_OUT') localStorage.removeItem(SIGNIN_KEY)
    })
    return () => { clearTimeout(timeout); sub.subscription.unsubscribe() }
  }, [])

  // Libellé du rôle affiché dans la barre du haut — lu depuis la table roles (plutôt que
  // codé en dur) pour que les futurs rôles créés depuis l'écran Rôles s'affichent correctement.
  useEffect(() => {
    if (!profile?.role) { setRoleLabel(''); return }
    supabase.from('roles').select('label').eq('key', profile.role).maybeSingle()
      .then(({ data }) => setRoleLabel(data?.label || profile.role))
  }, [profile?.role])

  // Seuil de déconnexion auto, réglable par l'admin (Stations & équipe) — utile sur les
  // téléphones partagés en station, pour ne pas rester connecté indéfiniment.
  useEffect(() => {
    supabase.from('settings').select('deconnexion_auto_heures').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data?.deconnexion_auto_heures) setDeconnexionHeures(Number(data.deconnexion_auto_heures)) })
  }, [])

  // Déconnexion auto après N heures depuis la connexion — vérifiée périodiquement, pas
  // seulement au chargement, sinon un onglet resté ouvert des jours ne serait jamais déconnecté.
  useEffect(() => {
    if (!session) return
    const check = () => {
      let signinAt = Number(localStorage.getItem(SIGNIN_KEY))
      if (!signinAt) { signinAt = Date.now(); localStorage.setItem(SIGNIN_KEY, String(signinAt)) }
      if (Date.now() - signinAt > deconnexionHeures * 3600 * 1000) {
        localStorage.removeItem(SIGNIN_KEY)
        supabase.auth.signOut()
      }
    }
    check()
    const id = setInterval(check, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [session, deconnexionHeures])

  const value = {
    session,
    profile,
    loading,
    profileLoading,
    role: profile?.role,
    roleLabel,
    isAdmin: profile?.role === 'admin',
    isPompiste: profile?.role === 'pompiste',
    isVendeuse: profile?.role === 'vendeuse',
    // Raccourci en dur, indépendant de la matrice — ne peut jamais être cassé par une
    // mauvaise manipulation dans l'écran Rôles (voir garde-fous du RBAC).
    can: (key) => profile?.role === 'admin' || permissions.has(key),
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, full_name) =>
      supabase.auth.signUp({ email, password, options: { data: { full_name } } }),
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
