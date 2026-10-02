import { numFR, today } from './format'

// Logique de réception d'une commande — strictement identique entre « Saisie du jour »
// (composant OrderReception, liste de toutes les commandes en attente) et « Commandes »
// (panneau de détail d'une seule commande) : un seul endroit à maintenir pour le garde-fou
// d'écart cuve et les écritures en base (order_receptions / fuel_orders / stock / attachments).

export const N = (v) => (v ? (numFR(v) ?? 0) : 0)

export const prixAchat = (produit, settings) =>
  produit === 'gasoil' ? N(settings.gasoil_pa || 730) : N(settings.essence_pa || 705)

// Quantité déclarée reçue vs mesure physique cuve_après−cuve_avant (CETTE réception).
// Un écart important signale un relevé « cuve avant » pris trop tôt (pollué par des ventes
// avant l'arrivée réelle du camion) ou une erreur de saisie — pas forcément une vraie perte.
export function ecartWarning({ recu, cuveAvant, cuveApres, tauxPerteAcceptable, force }) {
  if (force) return null
  const cuveDelta = N(cuveApres) - N(cuveAvant)
  const ecart = Math.abs(recu - cuveDelta)
  const seuil = Math.max(recu * (N(tauxPerteAcceptable) || 5) / 100, 50)
  if (ecart <= seuil) return null
  return `Déclaré reçu ${recu.toLocaleString('fr-FR')} L, mais cuve après−avant = ${cuveDelta.toLocaleString('fr-FR')} L (écart ${Math.round(ecart).toLocaleString('fr-FR')} L). Vérifiez que « cuve avant » a bien été relevée juste avant l'arrivée du camion.`
}

// État du cumul (déjà reçu + saisie en cours) vs commandé, affiché en temps réel pendant la
// saisie d'une réception partielle — pour qu'un dépassement de tolérance se voie tout de suite,
// pas seulement une fois la commande entièrement soldée (quand v_pertes_livraison la calcule).
// Purement informatif ici, ne bloque rien (cf. receptionner ci-dessous pour le garde-fou réel).
export function cumulStatus({ quantiteCommandee, deja, recuSaisi, tauxPerteAcceptable }) {
  const commande = N(quantiteCommandee)
  const cumul = N(deja) + N(recuSaisi)
  const seuil = commande * (N(tauxPerteAcceptable) || 5) / 100
  const perteNa = Math.max(0, (commande - cumul) - seuil)
  return { commande, cumul, seuil, perteNa, dansLaNorme: perteNa <= 0 }
}

// Calcule les champs de traçabilité conditionnement (carton/bidon → unité canonique) à partir
// d'une saisie scindée, pour la réception d'une commande gaz/lubrifiant — utilisé par les deux
// écrans de réception (OrderReception, Orders) pour rester identiques sur ce point aussi.
export function packagingSplit({ pr, qteCartons, qteUnites }) {
  const cartons = N(qteCartons), unites = N(qteUnites)
  const total = cartons * N(pr.conditionnement_qte) + unites
  const out = { quantite_recue: total ? String(total) : '', facteur_conversion: N(pr.conditionnement_qte) }
  if (cartons && unites) {
    out.unite_saisie = 'mixte'; out.qte_saisie = total
    out.detail_saisie = `${cartons} ${pr.conditionnement_nom || 'carton'}${cartons > 1 ? 's' : ''} + ${unites} ${pr.unite || 'unité'}${unites > 1 ? 's' : ''}`
  } else if (cartons) { out.unite_saisie = pr.conditionnement_nom || 'carton'; out.qte_saisie = cartons }
  else { out.unite_saisie = pr.unite || 'unite'; out.qte_saisie = unites }
  return out
}

// Recalcule le stock cuve (ess_stock/gas_stock) d'un jour à partir du MAX des « cuve après »
// de TOUTES les réceptions de ce produit ce jour-là, toutes commandes confondues — insensible à
// l'ordre dans lequel les réceptions ont été saisies. Root cause d'un vrai bug repéré : écrire
// littéralement la « cuve après » de CHAQUE réception au fil de l'eau fait que la dernière
// réception ENREGISTRÉE (pas forcément la dernière survenue physiquement) écrase les autres —
// deux livraisons le même jour saisies dans le désordre pouvaient faire disparaître la première
// du stock officiel (cas réel : 5000 L reçus en deux livraisons, seuls 2000 L retenus au final).
// Le MAX est robuste à cet ordre : quel que soit l'ordre de saisie, la valeur la plus haute
// finit toujours par gagner — exactement la cuve après la dernière livraison réelle. Ne fait
// JAMAIS baisser une valeur déjà enregistrée plus haute (ex. une déclaration manuelle « Stock
// du matin » plus précise que n'importe quelle réception) : prend le maximum entre l'existant
// et ce que les réceptions indiquent, jamais un écrasement pur.
export async function recomputeDailyStock({ supabase, stationId, produit, day }) {
  const champStock = produit === 'gasoil' ? 'gas_stock' : 'ess_stock'
  // order_receptions n'a pas de colonne "produit" directe (elle vient de fuel_orders) — on
  // récupère d'abord les commandes de ce produit, puis les réceptions de ce jour parmi elles.
  const { data: orders } = await supabase.from('fuel_orders').select('id').eq('station_id', stationId).eq('produit', produit)
  const orderIds = (orders || []).map(o => o.id)
  if (!orderIds.length) return
  const { data: recs } = await supabase.from('order_receptions').select('cuve_apres')
    .eq('station_id', stationId).eq('report_date', day).in('order_id', orderIds).not('cuve_apres', 'is', null)
  const maxCuveApres = (recs || []).reduce((m, r) => Math.max(m, N(r.cuve_apres)), -Infinity)
  if (maxCuveApres === -Infinity) return // aucune réception ce jour pour ce produit : ne touche rien
  const { data: dr } = await supabase.from('daily_reports').select(champStock).eq('station_id', stationId).eq('report_date', day).maybeSingle()
  const actuel = dr ? N(dr[champStock]) : -Infinity
  const nouveau = Math.max(actuel, maxCuveApres)
  if (nouveau === actuel) return
  const { error } = await supabase.from('daily_reports').upsert({ station_id: stationId, report_date: day, [champStock]: nouveau }, { onConflict: 'station_id,report_date' })
  if (error) throw error
}

// Valide + écrit en base une réception (partielle ou soldante). Lève une Error pour les
// erreurs de saisie bloquantes ; renvoie { warnEcart } pour un écart à confirmer (non bloquant,
// l'appelant réaffiche le formulaire avec la case « forcer ») ; renvoie { complet, total } au succès.
export async function receptionner({ supabase, bucket, stationId, session, order, recv, settings, deja }) {
  const day = recv.date || today()
  const recu = N(recv.quantite_recue)
  if (!recu || recu <= 0) throw new Error('Renseignez la quantité effectivement reçue (> 0).')
  const cat = order.categorie || 'carburant'
  if (cat === 'carburant' && (recv.cuve_avant === '' || recv.cuve_avant == null || recv.cuve_apres === '' || recv.cuve_apres == null)) {
    throw new Error('Renseignez la cuve avant et après.')
  }
  let matinManquant = false
  if (cat === 'carburant') {
    const warn = ecartWarning({ recu, cuveAvant: recv.cuve_avant, cuveApres: recv.cuve_apres, tauxPerteAcceptable: settings.taux_perte_acceptable, force: recv.forceEcart })
    if (warn) return { warnEcart: warn }
    // Si le relevé du matin de ce jour n'a pas encore été saisi, il risque de capter le niveau
    // APRÈS cette livraison plutôt que celui d'avant (le relevé du matin doit précéder toute
    // réception pour que l'anti-coulage reste fiable — cf. migration v53).
    const champMatin = order.produit === 'gasoil' ? 'gas_stock_matin' : 'ess_stock_matin'
    const champStock = order.produit === 'gasoil' ? 'gas_stock' : 'ess_stock'
    const { data: dr } = await supabase.from('daily_reports').select(`${champMatin},${champStock}`).eq('station_id', stationId).eq('report_date', day).maybeSingle()
    matinManquant = !dr || dr[champMatin] == null
    // Signal de qualité de saisie (pas une protection du stock lui-même — voir recomputeDailyStock,
    // qui prend le MAX de toutes les réceptions du jour et ne peut plus être écrasé par une seule
    // mauvaise lecture) : si « cuve avant » saisi ici est très inférieur au stock déjà enregistré,
    // c'est probablement un ancien chiffre réutilisé plutôt qu'une relève à l'instant présent —
    // vaut la peine d'être signalé, même si ça n'abîmera plus le stock final désormais.
    const stockActuel = dr ? N(dr[champStock]) : null
    if (!recv.forceEcart && stockActuel > 0) {
      const ecartStock = stockActuel - N(recv.cuve_avant)
      const seuilStock = Math.max(stockActuel * 0.1, 200)
      if (ecartStock > seuilStock) {
        return { warnEcart: `Le stock actuellement enregistré pour ce jour est ${Math.round(stockActuel).toLocaleString('fr-FR')} L, mais « cuve avant » saisi ici est ${N(recv.cuve_avant).toLocaleString('fr-FR')} L (écart ${Math.round(ecartStock).toLocaleString('fr-FR')} L). Si une autre réception a déjà eu lieu aujourd'hui, relève la cuve à l'instant présent plutôt que de réutiliser un ancien chiffre.` }
      }
    }
  }
  const total = N(deja) + recu
  const marge = N(order.quantite_commandee) * (N(settings.taux_perte_acceptable) || 5) / 100
  const complet = total >= N(order.quantite_commandee) - marge

  // La photo (si présente) a déjà été envoyée au stockage dès sa sélection — voir
  // handleReceptionPhoto dans Orders.jsx / OrderReception.jsx — recv.photo_path est son chemin.
  const photo_path = recv.photo_path || null

  // Chaque écriture vérifie son erreur et jette immédiatement : un échec RLS silencieux ici
  // (déjà arrivé — la mise à jour du statut fuel_orders était bloquée pour le gérant sans que
  // personne ne le voie, laissant des commandes "lancée" malgré des réceptions bien enregistrées)
  // doit remonter comme une vraie erreur, pas un faux succès.
  if (cat === 'carburant') {
    const prix = prixAchat(order.produit, settings)
    const { error: e1 } = await supabase.from('order_receptions').insert({ order_id: order.id, station_id: stationId, report_date: day, quantite_recue: recu, cuve_avant: N(recv.cuve_avant), cuve_apres: N(recv.cuve_apres), prix_achat: prix, montant: recu * prix, photo_path, created_by: session.user.id })
    if (e1) throw e1
    const { error: e2 } = await supabase.from('fuel_orders').update({ statut: complet ? 'recue' : 'partielle', cuve_avant: order.cuve_avant != null ? order.cuve_avant : N(recv.cuve_avant), cuve_apres: N(recv.cuve_apres), report_date: day, prix_achat: prix, montant: total * prix, recu_by: session.user.id, recu_at: new Date().toISOString() }).eq('id', order.id)
    if (e2) throw e2
    // Recalcule le stock cuve du jour à partir du MAX de toutes les réceptions (voir
    // recomputeDailyStock) — plus un simple écrasement par "cuve après" de CETTE réception,
    // donc insensible à l'ordre dans lequel plusieurs réceptions du même jour sont saisies.
    await recomputeDailyStock({ supabase, stationId, produit: order.produit, day })
  } else {
    const { error: e1 } = await supabase.from('order_receptions').insert({ order_id: order.id, station_id: stationId, report_date: day, quantite_recue: recu, photo_path, created_by: session.user.id })
    if (e1) throw e1
    const { error: e2 } = await supabase.from('fuel_orders').update({ statut: complet ? 'recue' : 'partielle', report_date: day, recu_by: session.user.id, recu_at: new Date().toISOString() }).eq('id', order.id)
    if (e2) throw e2
    const mvt = { station_id: stationId, categorie: cat, type: 'entree', source: 'reception', ref: 'CMD#' + order.id, date_mouvement: day, created_by: session.user.id }
    if (cat === 'superette') mvt.valeur = N(order.montant_paiement)
    else {
      mvt.produit = order.produit; mvt.quantite = recu
      if (recv.qte_saisie != null) mvt.qte_saisie = recv.qte_saisie
      if (recv.unite_saisie) mvt.unite_saisie = recv.unite_saisie
      if (recv.facteur_conversion != null) mvt.facteur_conversion = recv.facteur_conversion
      if (recv.detail_saisie) mvt.detail_saisie = recv.detail_saisie
    }
    const { error: e3 } = await supabase.from('stock_movements').insert(mvt)
    if (e3) throw e3
  }
  if (photo_path) {
    const { error: e4 } = await supabase.from('attachments').insert({ station_id: stationId, report_date: day, categorie: 'reception', note: `${order.produit || cat} — reçu ${recu} / ${N(order.quantite_commandee)}`, photo_path, created_by: session.user.id })
    if (e4) throw e4
  }

  return { complet, total, matinManquant }
}
