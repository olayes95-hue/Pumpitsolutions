import { useState } from 'react'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'
import CongesAbsences from '../components/CongesAbsences.jsx'
import DemandesExplication from '../components/DemandesExplication.jsx'

const TABS = [
  { value: 'conges', label: 'Congés & absences' },
  { value: 'explications', label: "Demandes d'explication" },
]

// Onglet "Demandes" — regroupe tout ce qui se demande/s'instruit entre un employé et la
// direction (congés/absences, demandes d'explication), séparé de la saisie du jour : ce n'est
// pas une donnée d'exploitation quotidienne, c'est un suivi RH à son propre rythme.
export default function Demandes() {
  const [tab, setTab] = useState('conges')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <Tabs items={TABS} value={tab} onChange={setTab} />
      {tab === 'conges' && <CongesAbsences />}
      {tab === 'explications' && <DemandesExplication />}
    </div>
  )
}
