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

  useEffect(() => {
    supabase.from('stations').select('*').order('id').then(({ data }) => setAllStations(data || []))
  }, [])

  useEffect(() => {
    if (!profile || isAdmin || SINGLE_STATION_ROLES.includes(profile.role)) { setMyStationIds([]); return }
    supabase.from('profile_stations').select('station_id').eq('profile_id', profile.id)
      .then(({ data }) => setMyStationIds((data || []).map(r => r.station_id)))
  }, [profile, isAdmin])

  const stations = useMemo(() => {
    if (isAdmin) return allStations
    if (myStationIds.length) return allStations.filter(s => myStationIds.includes(s.id))
    return allStations.filter(s => s.id === profile?.station_id)
  }, [isAdmin, allStations, myStationIds, profile?.station_id])

  useEffect(() => {
    setStationId(prev => (prev && stations.some(s => s.id === prev)) ? prev : (stations[0]?.id ?? null))
  }, [stations])

  const current = stations.find(s => s.id === stationId) || null
  return (
    <Ctx.Provider value={{ stations, stationId, setStationId, current, isAdmin }}>
      {children}
    </Ctx.Provider>
  )
}
