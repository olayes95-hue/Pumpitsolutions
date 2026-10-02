import { MetricTile } from '../ds/pumpit/components/data/MetricTile.jsx'

// Wrapper unique sur MetricTile (OCTANE) — remplace les 3 helpers KPI dupliqués
// trouvés dans le code existant (Kpi dans Dashboard.jsx/Finance.jsx, K dans
// BankRecon.jsx/OcrCheck.jsx, StockKpi dans Dashboard.jsx), chacun avec des noms
// de props légèrement différents. Câblé page par page en Phase 4+ ; construit
// maintenant pour que ces conversions n'aient pas à réinventer la même chose.
// status : 'ok' | 'warn' | 'alarm' | 'info' (remplace le booléen `danger` ou les
// couleurs hex arbitraires utilisés par les anciennes variantes).
export function Kpi({ label, value, unit, sub, delta, direction, status, style }) {
  return <MetricTile label={label} value={value} unit={unit} sub={sub} delta={delta} direction={direction} status={status} style={style} />
}
