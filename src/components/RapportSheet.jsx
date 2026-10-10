import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fcfa, frDate } from '../lib/format'

// Rapport mensuel A4 imprimable, même mécanisme que FactureSheet.jsx : rendu hors de
// l'application (portail), visible uniquement à l'impression — window.print() propose
// l'impression ou l'enregistrement en PDF.
export default function RapportSheet({ rapport, station, onDone }) {
  useEffect(() => {
    if (!rapport) return
    const fin = () => { document.body.classList.remove('pi-printing'); onDone && onDone() }
    document.body.classList.add('pi-printing')
    window.addEventListener('afterprint', fin, { once: true })
    const t = setTimeout(() => window.print(), 80)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', fin); document.body.classList.remove('pi-printing') }
  }, [rapport?.moisLabel])

  if (!rapport) return null
  const r = rapport
  const ligne = (label, value, bold) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px', font: bold ? 'var(--fw-semibold) 14px/1.3 var(--font-ui)' : '400 13px/1.4 var(--font-ui)' }}>
      <span>{label}</span><span className="r">{value}</span>
    </div>
  )

  return createPortal(
    <div className="pi-print-sheet">
      <div className="pi-rapport">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
          <img src="/brand/pumpit-logo-principal.png" alt="PumpIT" style={{ height: 40, width: 'auto' }} />
          <div style={{ textAlign: 'right' }}>
            <h1>RAPPORT MENSUEL</h1>
            <div style={{ marginTop: 6 }}>{station?.nom || 'Station'} — {r.moisLabel}</div>
            <div style={{ color: 'var(--ardoise)', fontSize: 12 }}>Généré le {frDate(r.genereLe)}</div>
          </div>
        </div>

        <h2>En clair</h2>
        {r.resume.map((p, i) => <p key={i} style={{ margin: '0 0 6px' }}>{p}</p>)}

        <h2>Compte de résultat</h2>
        <div className="bloc">
          {ligne('Commission carburant', fcfa(r.commCarb))}
          {ligne('Commission gaz + lubrifiant', fcfa(r.commGazLub))}
          {ligne('Commission supérette', fcfa(r.commSuperette))}
          {r.autresProduits > 0 && ligne('Autres produits', fcfa(r.autresProduits))}
          {ligne('= PRODUITS', fcfa(r.produits), true)}
          <div style={{ height: 8 }} />
          {ligne('SBEE + carburant/déplacement (auto)', fcfa(r.autoCharges))}
          {r.perteMontant > 0 && ligne('Pertes livraison (auto)', fcfa(r.perteMontant))}
          {ligne('Charges fixes (loyer, salaires...)', fcfa(r.totManuel))}
          {ligne('= CHARGES', fcfa(r.totCharges), true)}
          {ligne('RÉSULTAT', fcfa(r.resultat), true)}
        </div>

        <h2>Manque à verser — compté comme charge dans ce rapport</h2>
        <div className="bloc">
          {ligne('Manque à verser (non remis à ce jour, toutes caisses)', fcfa(r.gapVerse))}
          {ligne('RÉSULTAT AJUSTÉ (= résultat − manque à verser)', fcfa(r.resultatAjuste), true)}
        </div>
        <p style={{ color: 'var(--ardoise)', fontSize: 12, marginTop: 4 }}>
          Le résultat affiché sur le Point financier ne déduit pas le manque à verser ; ce rapport le compte comme une vraie charge pour refléter l'argent dû à la station mais pas encore remis.
        </p>

        <h2>Bilan simplifié (au {r.bilanAu})</h2>
        <div style={{ display: 'flex', gap: 24 }}>
          <div className="bloc" style={{ flex: 1 }}>
            <div className="et">ACTIF</div>
            {ligne('Stock carburant (cuves)', fcfa(r.stockCarburant))}
            {ligne('Stock gaz + lubrifiant + supérette', fcfa(r.stockTotal))}
            {ligne('Bons en cours (créance)', fcfa(r.bonsRestant))}
            {ligne('Cash non encore versé (cumulé)', fcfa(r.cashCumule))}
            {ligne('Total actif', fcfa(r.totalActif), true)}
          </div>
          <div className="bloc" style={{ flex: 1 }}>
            <div className="et">PASSIF</div>
            {ligne('Charges à payer (cumulées)', fcfa(r.chargesAPayerCumule))}
            {ligne('Total passif', fcfa(r.totalPassif), true)}
            <div style={{ height: 8 }} />
            {ligne('Situation nette', fcfa(r.situationNette), true)}
          </div>
        </div>

        <h2>Recommandations</h2>
        {r.conseils.map((c, i) => <div key={i} className="conseil">{i + 1}. {c}</div>)}

        <div style={{ marginTop: 32, paddingTop: 12, borderTop: '1px solid var(--filet)', color: 'var(--ardoise)', fontSize: 11 }}>
          PumpIT Solutions — rapport généré automatiquement depuis les données saisies par la station, à titre d'information de gestion.
        </div>
      </div>
    </div>,
    document.body
  )
}
