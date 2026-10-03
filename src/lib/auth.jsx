import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { fonctionsDe, etatAbonnement } from './formules'
import { today } from './format'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

const SIGNIN_KEY = 'station_signin_at'
const DECONNEXION_DEFAUT_HEURES = 24

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [permissions, setPermissions] = useState(new Set())
  const [roleLabel, setRoleLabel] = useState('')
  const [organisation, setOrganisation] = useState(null)
  const [organisationReady, setOrganisationReady] = useState(false)
  const [orgVersion, setOrgVersion] = useState(0)
  const [formules, setFormules] = useState([])
  const [reglagesPlateforme, setReglagesPlateforme] = useState(null)
  const [permsPlateforme, setPermsPlateforme] = useState([])
  const [loading, setLoading] = useState(true)
  // Distinct de `loading` (qui ne couvre que le tout premier chargement de la session) :
  // à chaque connexion/changement de session, onAuthStateChange met `session` à jour
  // immédiatement, avant que loadProfile() ait fini — sans ce flag, profile reste `null`
  // pendant ce court instant et App.jsx affichait à tort l'écran "en attente de validation"
  // pour un compte déjà validé, le temps que le vrai profil arrive.
  const [profileLoading, setProfileLoading] = useState(true)
  const [deconnexionHeures, setDeconnexionHeures] = useState(DECONNEXION_DEFAUT_HEURES)

  async function loadProfile(userId, { silent = false } = {}) {
    if (!userId) { setProfile(null); setPermissions(new Set()); setProfileLoading(false); return }
    // silent : utilisé pour un rafraîchissement de jeton (voir onAuthStateChange plus bas) —
    // ne fait PAS repasser profileLoading à true, sinon App.jsx démonte tout l'arbre (y compris
    // la page en cours, ex. Saisie du jour) le temps du calcul, et l'écran revient à son état
    // par défaut au lieu de garder celui sur lequel l'utilisateur était.
    if (!silent) setProfileLoading(true)
    // role_permissions est une toute petite table (une poignée de lignes, tous rôles confondus) —
    // la charger en ENTIER en parallèle du profil, plutôt qu'après (filtrée par rôle), retire un
    // aller-retour réseau séquentiel du chemin critique de CHAQUE chargement de page.
    const [{ data }, { data: rp }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('role_permissions').select('role_key,permission_key'),
    ])
    setProfile(data || null)
    // L'admin n'a jamais de ligne dans role_permissions (son accès passe toujours par
    // is_admin() côté RLS / isAdmin côté front, jamais par la matrice) — inutile de s'en
    // servir pour lui, et ça évite qu'une matrice mal configurée le concerne un jour.
    if (data && data.role !== 'admin') {
      setPermissions(new Set((rp || []).filter(r => r.role_key === data.role).map(r => r.permission_key)))
    } else {
      setPermissions(new Set())
    }
    if (!silent) setProfileLoading(false)
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
      // TOKEN_REFRESHED/USER_UPDATED se déclenchent aussi au retour sur l'onglet (reprise du
      // rafraîchissement automatique du jeton par le SDK après une mise en arrière-plan) —
      // ce n'est pas une vraie connexion/déconnexion, donc silencieux (voir loadProfile).
      const silent = event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED'
      setSession(s)
      await loadProfile(s?.user?.id, { silent })
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

  // Organisation (client) du compte. Le cloisonnement est fait par la base (RLS) :
  // cette lecture ne sert qu'à l'affichage (nom du client, code d'invitation).
  useEffect(() => {
    if (!profile?.organisation_id) { setOrganisation(null); setOrganisationReady(true); return }
    setOrganisationReady(false)
    // L'offre et les réglages d'essai sont chargés en même temps : sans eux, on ne sait pas
    // quelles fonctions afficher ni si l'accès est ouvert.
    Promise.all([
      supabase.from('organisations').select('*').eq('id', profile.organisation_id).maybeSingle(),
      supabase.from('formules').select('*'),
      supabase.from('plateforme_reglages').select('essai_formule, suspendre_fin_essai').eq('id', 1).maybeSingle(),
    ]).then(([o, f, r]) => {
      setOrganisation(o.data || null); setFormules(f.data || []); setReglagesPlateforme(r.data || null)
      setOrganisationReady(true)
    })
  }, [profile?.organisation_id, orgVersion])

  // Agent PumpIT : permissions sur la plateforme (back-office). Avant la v100, seul
  // existait l'administrateur de la plateforme, qui a alors tous les droits.
  useEffect(() => {
    if (!profile?.id) { setPermsPlateforme([]); return }
    const TOUT = ['supervision', 'clients', 'offres', 'facturation', 'assistance', 'ouvrir_client', 'reglages', 'agents']
    supabase.rpc('mes_permissions_plateforme').then(({ data, error }) => {
      if (error) setPermsPlateforme(profile.is_platform_admin ? TOUT : [])
      else setPermsPlateforme(Array.isArray(data) ? data : [])
    })
  }, [profile?.id, profile?.plateforme_role, profile?.is_platform_admin])

  // Seuil de déconnexion auto, réglable par l'admin (Stations & équipe) — utile sur les
  // téléphones partagés en station, pour ne pas rester connecté indéfiniment.
  useEffect(() => {
    supabase.from('settings').select('deconnexion_auto_heures').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data?.deconnexion_auto_heures) setDeconnexionHeures(Number(data.deconnexion_auto_heures)) })
  }, [profile?.organisation_id])

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

  // Abonnement : pendant l'essai, le client a les fonctions de l'offre d'essai (si elle est
  // réglée dans le back-office), sinon celles de son offre.
  const abonnement = etatAbonnement(organisation, reglagesPlateforme, today())
  const cleOffre = abonnement.enEssai && reglagesPlateforme?.essai_formule ? reglagesPlateforme.essai_formule : organisation?.formule
  const fonctions = fonctionsDe(formules, cleOffre)
  const estAgent = permsPlateforme.length > 0 || !!profile?.plateforme_role || !!profile?.is_platform_admin

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
    // Multi-clients : organisation courante et statut d'administrateur de la plateforme
    // (celui qui gère tous les clients). Voir supabase/migration_v96_multiclient.sql.
    organisation,
    // Super administrateur de la plateforme (gère aussi les rôles des clients).
    isPlatformAdmin: profile?.plateforme_role ? profile.plateforme_role === 'super_admin' : !!profile?.is_platform_admin,
    // Agent PumpIT : toute personne ayant un rôle dans le back-office, et ses permissions.
    isAgent: estAgent,
    agentCan: (permission) => permsPlateforme.includes(permission),
    // Abonnement : offre du client, fonctions incluses, essai, blocage.
    // Un client bloqué (suspendu ou essai terminé) ne reçoit plus aucune donnée de la base
    // (voir current_org_id()) ; un agent PumpIT n'est jamais bloqué.
    formules,
    reglagesPlateforme,
    // `formule`, `offre` et `has` ci-dessous valent pour l'offre par défaut du client. Dans
    // l'application, utiliser useOffre() (lib/offre.jsx), qui suit la station courante.
    formule: cleOffre,
    offre: formules.find(f => f.key === cleOffre) || null,
    has: (fonction) => !fonctions || fonctions.includes(fonction),
    abonnement,
    suspendu: abonnement.bloque && !estAgent,
    // Tant que l'organisation n'est pas connue, on ne sait ni la formule ni l'état de
    // l'abonnement : l'application attend avant d'afficher quoi que ce soit.
    organisationReady,
    refreshProfile: () => loadProfile(session?.user?.id),
    refreshOrganisation: () => setOrgVersion(v => v + 1),
    // Raccourci en dur, indépendant de la matrice — ne peut jamais être cassé par une
    // mauvaise manipulation dans l'écran Rôles (voir garde-fous du RBAC).
    can: (key) => profile?.role === 'admin' || permissions.has(key),
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    // org_code : code d'invitation du client, lu par le trigger handle_new_user pour
    // rattacher le nouveau compte à son organisation.
    signUp: (email, password, full_name, org_code) =>
      supabase.auth.signUp({ email, password, options: { data: { full_name, org_code: (org_code || '').trim().toUpperCase() } } }),
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
