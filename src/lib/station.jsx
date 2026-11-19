import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth.jsx'

const Ctx = createContext(null)
export const useStation = () => useContext(Ctx)

// Rôles historiques : une seule station (profiles.station_id). Tout autre rôle
// (directeur/comptable, ou un rôle futur créé depuis l'écran Rôles) peut être
// rattaché à plusieurs stations via profile_stations.
const SINGLE_STATION_ROLES = ['gerant', 'pompiste', 'vendeuse', 'admin']

export function StationProvider({ children }) {
  const { profile, isAdmin } = useAuth()
  const [allStations, setAllStations] = useState([])
  const [myStationIds, setMyStationIds] = useState([])
  const [stationId, setStationId] = useState(null)
  // Vue consolidée (demande utilisateur) : choisie depuis le même sélecteur de station que le
  // reste de l'app ("Toutes les stations" en plus de la liste), pour que Tableau de bord, Stock
  // et Point financier basculent ensemble, sans bouton séparé par page. `stationId` lui-même
  // reste toujours une vraie station — jamais "toutes" — pour qu'aucune des pages qui écrivent
  // (Saisie du jour, Commandes, Rapprochement…) ne puisse se retrouver sans station valide.
  const [vueConsolidee, setVueConsolidee] = useState(false)

  useEffect(() => {
    supabase.from('stations').select('*').order('id').then(({ data }) => setAllStations(data || []))
  }, [])

  useEffect(() => {
    if (!profile || isAdmin || SINGLE_STATION_ROLES.includes(profile.role)) { setMyStationIds([]); return }
    supabase.from('profile_stations').select('station_id').eq('profile_id', profile.id)
      .then(({ data }) => setMyStationIds((data || []).map(r => r.station_id)))
    // Dépend des VALEURS utilisées (id, role), pas de l'objet `profile` entier : celui-ci change
    // de référence à chaque rafraîchissement silencieux du jeton (voir auth.jsx), ce qui recréait
    // inutilement ce tableau (et, en cascade, la liste des stations) sans aucun changement réel.
  }, [profile?.id, profile?.role, isAdmin])

  const stations = useMemo(() => {
    if (isAdmin) return allStations
    if (myStationIds.length) return allStations.filter(s => myStationIds.includes(s.id))
    return allStations.filter(s => s.id === profile?.station_id)
  }, [isAdmin, allStations, myStationIds, profile?.station_id])

  useEffect(() => {
    setStationId(prev => (prev && stations.some(s => s.id === prev)) ? prev : (stations[0]?.id ?? null))
  }, [stations])
  useEffect(() => { if (stations.length < 2 && vueConsolidee) setVueConsolidee(false) }, [stations.length])

  const current = stations.find(s => s.id === stationId) || null
  const stationIdsActifs = vueConsolidee ? stations.map(s => s.id) : (stationId ? [stationId] : [])
  return (
    <Ctx.Provider value={{ stations, stationId, setStationId, current, isAdmin, vueConsolidee, setVueConsolidee, stationIdsActifs }}>
      {children}
    </Ctx.Provider>
  )
}
