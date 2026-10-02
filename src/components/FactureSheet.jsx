import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fcfa, frDate } from '../lib/format'

// Facture A4 selon la charte (papeterie). Rendue hors de l'application, visible à
// l'impression uniquement : `window.print()` propose l'impression ou l'enregistrement en PDF.
export default function FactureSheet({ facture, client, emetteur, onDone }) {
  useEffect(() => {
    if (!facture) return
    const fin = () => { document.body.classList.remove('pi-printing'); onDone && onDone() }
    document.body.classList.add('pi-printing')
    window.addEventListener('afterprint', fin, { once: true })
    const t = setTimeout(() => window.print(), 80)   // laisse le temps au logo de se charger
    return () => { clearTimeout(t); window.removeEventListener('afterprint', fin); document.body.classList.remove('pi-printing') }
  }, [facture?.id])

  if (!facture) return null
  const e = emetteur || {}
  const lignes = (...x) => x.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)
  return createPortal(
    <div className="pi-print-sheet">
      <div className="pi-facture">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
          <img src="/brand/pumpit-logo-principal.png" alt="PumpIT" style={{ height: 44 }} />
          <div style={{ textAlign: 'right' }}>
            <h1>FACTURE</h1>
            <div style={{ marginTop: 6 }}>N° {facture.numero} · {frDate(facture.date_emission)}</div>
            {facture.statut === 'payee' && <div style={{ fontWeight: 600, color: 'var(--vert-fonce)' }}>Payée le {frDate(facture.paye_le)}{facture.mode_paiement ? ` (${facture.mode_paiement})` : ''}</div>}
            {facture.statut === 'annulee' && <div style={{ fontWeight: 600, color: 'var(--rouge-texte)' }}>Annulée</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: 32 }}>
          <div className="bloc">
            <div className="et">Émetteur</div>
            <div style={{ fontWeight: 600 }}>{e.raison_sociale || 'PumpIT Solutions'}</div>
            {lignes(e.adresse, e.telephone, e.email)}
          </div>
          <div className="bloc">
            <div className="et">Client</div>
            <div style={{ fontWeight: 600 }}>{client?.nom}</div>
            {lignes(client?.adresse, client?.telephone, client?.ifu && `IFU : ${client.ifu}`)}
          </div>
        </div>

        <table>
          <thead><tr><th>Désignation</th><th className="r">Qté</th><th className="r">Prix unitaire</th><th className="r">Montant</th></tr></thead>
          <tbody>
            <tr>
              <td>{facture.designation}<div style={{ color: 'var(--ardoise)' }}>Du {frDate(facture.periode_debut)} au {frDate(facture.periode_fin)}</div></td>
              <td className="r">{Number(facture.quantite)}</td>
              <td className="r">{fcfa(facture.prix_unitaire)}</td>
              <td className="r">{fcfa(facture.montant_ht)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px' }}><span>Total HT</span><span className="r">{fcfa(facture.montant_ht)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px' }}><span>TVA ({Number(facture.taux_tva)} %)</span><span className="r">{fcfa(facture.montant_tva)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', marginTop: 6, borderTop: '2px solid var(--nuit)', font: '800 18px/1.2 var(--font-display)' }}><span>Total TTC</span><span className="r">{fcfa(facture.montant_ttc)}</span></div>
          </div>
        </div>

        <div style={{ marginTop: 56, paddingTop: 12, borderTop: '1px solid var(--filet)', color: 'var(--ardoise)', fontSize: 12 }}>
          {[e.raison_sociale || 'PumpIT Solutions', e.rccm && `RCCM ${e.rccm}`, e.ifu && `IFU ${e.ifu}`, e.coordonnees_bancaires].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>,
    document.body
  )
}
