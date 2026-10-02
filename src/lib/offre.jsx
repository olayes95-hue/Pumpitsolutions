import { useAuth } from './auth.jsx'
import { useStation } from './station.jsx'
import { fonctionsDe, activitesDe } from './formules'

// Offre de la station courante.
//
// Depuis la v101, chaque station a sa propre offre : un même client peut avoir une station en
// Complet et une autre en Essentiel. Les menus, les écrans et les activités affichés suivent
// donc la station choisie dans le sélecteur.
//   - pendant un essai, c'est l'offre d'essai (si elle est réglée) qui s'applique partout ;
//   - sans station courante, ou tant que la base n'a pas la v101, c'est l'offre du client.
//
// has('finance')     -> la fonction est-elle incluse ?
// activite('gaz')    -> l'activité est-elle incluse ? (carburant, lubrifiant, gaz, superette)
export function useOffre() {
  const { organisation, formules, reglagesPlateforme, abonnement } = useAuth()
  const station = useStation()
  const cle = abonnement?.enEssai && reglagesPlateforme?.essai_formule
    ? reglagesPlateforme.essai_formule
    : (station?.current?.formule || organisation?.formule)
  const fonctions = fonctionsDe(formules, cle)
  const activites = activitesDe(formules, cle)
  return {
    cle,
    offre: (formules || []).find(f => f.key === cle) || null,
    has: (fonction) => !fonctions || fonctions.includes(fonction),
    activite: (a) => !activites || activites.includes(a),
  }
}
