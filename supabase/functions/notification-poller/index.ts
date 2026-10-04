// Supabase Edge Function : à appeler périodiquement (Cron Supabase, voir README) — regarde
// ce qu'il s'est passé depuis le dernier passage pour chaque déclencheur actif dans
// notification_rules, et envoie les e-mails correspondants via Brevo.
//
// Catalogue de déclencheurs (voir migration_v114_notifications_v2.sql pour le détail des
// règles de démarrage) :
//   Alertes station (v_alerts, un déclencheur par type) :
//     versement_manquant, versement_incomplet, ecart_caisse, ecart_compteur, ecart_stock,
//     stock_bas, point_manquant, releve_compteur_manquant, depense_non_justifiee
//   Commandes : commande_a_valider, commande_statut, reception_ecart
//   Compte/plateforme : essai_j3, essai_termine, facture_emise, facture_retard
//
// Paramétrage par offre : une règle peut poser requiert_fonction (clé de formules.fonctions)
// ou formules (liste de clés d'offre) — le déclenchement est alors filtré sur l'offre de la
// station (ou de l'organisation, pour les triggers de compte) concernée.
//
// Déploiement : voir supabase/functions/README_NOTIFICATIONS.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!
const SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "notifications@pumpit.app"
const SENDER_NOM = Deno.env.get("BREVO_SENDER_NOM") ?? "PumpIT"
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS, GET" }
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } })

// Gabarit e-mail (logo + "Bonjour," + corps + pied de page) — dupliqué dans send-notification
// ET notification-poller plutôt que partagé via _shared/ : certaines versions du CLI Supabase
// n'embarquent pas correctement ce dossier au déploiement ("Module not found _shared/...").
// Deux petites fonctions, le doublon est moins coûteux que ce risque de déploiement.
const LOGO_URL = "https://pumpit-app.vercel.app/brand/pumpit-logo-principal.png"
function enveloppeEmail(corpsHtml: string): string {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1F17;line-height:1.5">
  <div style="margin-bottom:24px">
    <img src="${LOGO_URL}" alt="PumpIT" style="height:32px;display:block">
  </div>
  <p style="margin:0 0 16px">Bonjour,</p>
  <div style="margin:0 0 20px">${corpsHtml}</div>
  <p style="margin:0">Cordialement,<br>L'équipe PumpIT</p>
  <hr style="border:none;border-top:1px solid #DCE5E0;margin:24px 0">
  <p style="font-size:12px;color:#6b7a72;margin:0">
    Cet e-mail est envoyé automatiquement par votre back-office PumpIT.<br>
    Pour toute question, contactez l'assistance depuis votre espace PumpIT.
  </p>
</div>`.trim()
}
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

// ---------- Envoi + journal ----------
async function envoyer(ruleId: number, triggerKey: string, email: string, sujet: string, corps: string, vars: Record<string, string>) {
  const sujetRendu = render(sujet, vars)
  const corpsRendu = enveloppeEmail(render(corps, vars))
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: SENDER_EMAIL, name: SENDER_NOM }, to: [{ email }], subject: sujetRendu, htmlContent: corpsRendu }),
  })
  const ok = resp.ok
  const body = await resp.json().catch(() => ({}))
  await sb.from("notification_log").insert({
    rule_id: ruleId, trigger_key: triggerKey, destinataire_email: email, sujet: sujetRendu,
    statut: ok ? "envoye" : "echec", erreur: ok ? null : JSON.stringify(body), payload: vars,
  })
}

// ---------- Curseurs (jusqu'où chaque trigger a déjà été traité) ----------
async function getCursor(trigger: string): Promise<string> {
  const { data } = await sb.from("notification_cursors").select("dernier_at").eq("trigger_key", trigger).maybeSingle()
  return data?.dernier_at || "2000-01-01T00:00:00Z"
}
async function setCursor(trigger: string, at: string) {
  await sb.from("notification_cursors").upsert({ trigger_key: trigger, dernier_at: at })
}

// ---------- Offre de la station (pour le filtre par offre d'une règle) ----------
let formulesCache: any[] | null = null
async function fonctionsDe(formuleKey: string | null): Promise<string[]> {
  if (!formuleKey) return []
  if (!formulesCache) { const { data } = await sb.from("formules").select("*"); formulesCache = data || [] }
  return formulesCache.find((f: any) => f.key === formuleKey)?.fonctions || []
}
async function formuleDeStation(stationId: number): Promise<string | null> {
  const { data: s } = await sb.from("stations").select("formule, organisation_id").eq("id", stationId).maybeSingle()
  if (s?.formule) return s.formule
  if (!s?.organisation_id) return null
  const { data: o } = await sb.from("organisations").select("formule").eq("id", s.organisation_id).maybeSingle()
  return o?.formule ?? null
}
// true si la règle s'applique à cette offre (ni requiert_fonction ni formules posés = toutes offres)
async function regleAutoriseeOffre(regle: any, formuleKey: string | null): Promise<boolean> {
  if (regle.formules?.length) return !!formuleKey && regle.formules.includes(formuleKey)
  if (regle.requiert_fonction) return (await fonctionsDe(formuleKey)).includes(regle.requiert_fonction)
  return true
}

// ---------- Résolution des destinataires ----------
async function emailDe(profileId: string): Promise<string | null> {
  const { data } = await sb.auth.admin.getUserById(profileId)
  return data?.user?.email ?? null
}
// admin/directeur d'une organisation (triggers de compte) ou d'une station précise (triggers
// opérationnels — admin via l'organisation, directeur via profiles.station_id OU profile_stations).
async function emailsRoles(roles: string[], opts: { organisationId?: number; stationId?: number }): Promise<string[]> {
  const ids = new Set<string>()
  if (opts.organisationId) {
    const { data } = await sb.from("profiles").select("id").eq("organisation_id", opts.organisationId).in("role", roles)
    for (const p of data || []) ids.add(p.id)
  }
  if (opts.stationId) {
    const { data: d1 } = await sb.from("profiles").select("id").eq("station_id", opts.stationId).in("role", roles)
    for (const p of d1 || []) ids.add(p.id)
    const { data: d2 } = await sb.from("profile_stations").select("profile_id, profiles(role)").eq("station_id", opts.stationId)
    for (const p of d2 || []) if (roles.includes((p as any).profiles?.role)) ids.add((p as any).profile_id)
  }
  const emails: string[] = []
  for (const id of ids) { const e = await emailDe(id); if (e) emails.push(e) }
  return emails
}
function destinatairesStatiques(regle: any): string[] {
  return regle.destinataires?.type === "fixe" && Array.isArray(regle.destinataires.emails) ? regle.destinataires.emails : []
}

// ---------- Déclencheurs : alertes station (v_alerts) ----------
const ALERT_TYPES: Record<string, string> = {
  versement_manquant: "VERSEMENT_MANQUANT", versement_incomplet: "VERSEMENT_INCOMPLET",
  ecart_caisse: "ECART_CAISSE", ecart_compteur: "ECART_COMPTEUR", ecart_stock: "ECART_STOCK",
  stock_bas: "STOCK_BAS", point_manquant: "POINT_MANQUANT",
  releve_compteur_manquant: "RELEVE_COMPTEUR_MANQUANT", depense_non_justifiee: "DEPENSE_NON_JUSTIFIEE",
}
async function traiterAlerte(triggerKey: string, regles: any[]) {
  const cursor = await getCursor(triggerKey)
  const curDate = cursor.slice(0, 10)
  const { data: alertes } = await sb.from("v_alerts").select("*").eq("type", ALERT_TYPES[triggerKey]).gt("report_date", curDate).order("report_date")
  if (!alertes?.length) return
  const stationIds = [...new Set(alertes.map((a: any) => a.station_id))]
  const { data: stations } = await sb.from("stations").select("id, nom").in("id", stationIds)
  const nomStation = new Map((stations || []).map((s: any) => [s.id, s.nom]))
  let dernier = cursor
  for (const a of alertes) {
    const formule = await formuleDeStation(a.station_id)
    // v_alerts n'a qu'un champ "detail" (phrase déjà formatée côté SQL, ex. "carburant :
    // (espèce 45000 − dépenses 2000) ≠ versé 0 → écart 43000 F") — pas de montant/écart
    // séparés à extraire proprement ; les gabarits utilisent {{detail}} tel quel.
    const vars = { station: nomStation.get(a.station_id) || `station #${a.station_id}`, date: a.report_date, detail: a.detail }
    for (const r of regles) {
      if (!(await regleAutoriseeOffre(r, formule))) continue
      const dest = r.destinataires?.type === "roles_client"
        ? await emailsRoles(r.destinataires.roles, { stationId: a.station_id })
        : destinatairesStatiques(r)
      for (const email of dest) await envoyer(r.id, triggerKey, email, r.sujet, r.corps_html, vars)
    }
    if (a.report_date > dernier) dernier = a.report_date
  }
  await setCursor(triggerKey, dernier)
}

// ---------- Commandes ----------
async function traiterCommandeAValider(regles: any[]) {
  const cursor = await getCursor("commande_a_valider")
  const { data: ordres } = await sb.from("fuel_orders").select("*, stations(nom, organisation_id)").eq("statut", "proposee").gt("proposed_at", cursor).order("proposed_at")
  if (!ordres?.length) return
  let dernier = cursor
  for (const o of ordres as any[]) {
    const formule = await formuleDeStation(o.station_id)
    const gerant = o.proposed_by ? await emailDe(o.proposed_by) : null
    const vars = { station: o.stations?.nom || `station #${o.station_id}`, produit: o.produit, quantite: String(o.quantite_commandee ?? ""), date: (o.proposed_at || "").slice(0, 10), gerant: gerant || "le gérant" }
    for (const r of regles) {
      if (!(await regleAutoriseeOffre(r, formule))) continue
      const dest = r.destinataires?.type === "roles_client" ? await emailsRoles(r.destinataires.roles, { stationId: o.station_id }) : destinatairesStatiques(r)
      for (const email of dest) await envoyer(r.id, "commande_a_valider", email, r.sujet, r.corps_html, vars)
    }
    if (o.proposed_at > dernier) dernier = o.proposed_at
  }
  await setCursor("commande_a_valider", dernier)
}

async function traiterCommandeStatut(regles: any[]) {
  const cursor = await getCursor("commande_statut")
  const { data: ordres } = await sb.from("fuel_orders").select("*, stations(nom)").in("statut", ["validee", "annulee"]).gt("validated_at", cursor).order("validated_at")
  if (!ordres?.length) return
  let dernier = cursor
  for (const o of ordres as any[]) {
    if (!o.proposed_by) continue
    const emailProposeur = await emailDe(o.proposed_by)
    if (!emailProposeur) continue
    const valideur = o.validated_by ? await emailDe(o.validated_by) : null
    const vars = { station: o.stations?.nom || `station #${o.station_id}`, produit: o.produit, statut: o.statut === "validee" ? "validée" : "refusée", valideur: valideur || "la direction" }
    for (const r of regles) for (const email of [emailProposeur]) await envoyer(r.id, "commande_statut", email, r.sujet, r.corps_html, vars)
    if (o.validated_at > dernier) dernier = o.validated_at
  }
  await setCursor("commande_statut", dernier)
}

async function traiterReceptionEcart(regles: any[]) {
  const cursor = await getCursor("reception_ecart")
  const { data: receptions } = await sb.from("order_receptions").select("*, fuel_orders(produit, station_id, quantite_commandee, stations(nom))").gt("created_at", cursor).order("created_at")
  if (!receptions?.length) return
  let dernier = cursor
  const parOrdre = new Map<number, any[]>()
  for (const r of receptions as any[]) {
    if (!parOrdre.has(r.order_id)) parOrdre.set(r.order_id, [])
    parOrdre.get(r.order_id)!.push(r)
    if (r.created_at > dernier) dernier = r.created_at
  }
  for (const [orderId, recs] of parOrdre) {
    const { data: vr } = await sb.from("v_order_reception").select("*").eq("order_id", orderId).maybeSingle()
    if (!vr || vr.complet) continue   // pas un écart significatif (dans la marge acceptée)
    const o = recs[0].fuel_orders
    const formule = o?.station_id ? await formuleDeStation(o.station_id) : null
    const vars = { station: o?.stations?.nom || "", produit: o?.produit || "", quantite_commandee: String(vr.quantite_commandee ?? ""), quantite_recue: String(vr.quantite_recue_total ?? "") }
    for (const r of regles) {
      if (!(await regleAutoriseeOffre(r, formule))) continue
      const dest = r.destinataires?.type === "roles_client" ? await emailsRoles(r.destinataires.roles, { stationId: o?.station_id }) : destinatairesStatiques(r)
      for (const email of dest) await envoyer(r.id, "reception_ecart", email, r.sujet, r.corps_html, vars)
    }
  }
  await setCursor("reception_ecart", dernier)
}

// ---------- Compte / plateforme ----------
async function traiterEssaiJ3(regles: any[]) {
  const cursor = await getCursor("essai_j3")
  if (cursor.slice(0, 10) === new Date().toISOString().slice(0, 10)) return   // déjà traité aujourd'hui
  const cible = new Date(); cible.setDate(cible.getDate() + 3)
  const cibleStr = cible.toISOString().slice(0, 10)
  const { data: orgs } = await sb.from("organisations").select("id, nom, essai_jusqu_au").eq("essai_jusqu_au", cibleStr)
  for (const o of orgs || []) {
    const vars = { station: o.nom, date_fin: o.essai_jusqu_au }
    for (const r of regles) {
      const dest = r.destinataires?.type === "roles_client" ? await emailsRoles(r.destinataires.roles, { organisationId: o.id }) : destinatairesStatiques(r)
      for (const email of dest) await envoyer(r.id, "essai_j3", email, r.sujet, r.corps_html, vars)
    }
  }
  await setCursor("essai_j3", new Date().toISOString())
}
async function traiterEssaiTermine(regles: any[]) {
  const cursor = await getCursor("essai_termine")
  if (cursor.slice(0, 10) === new Date().toISOString().slice(0, 10)) return
  const hier = new Date(); hier.setDate(hier.getDate() - 1)
  const hierStr = hier.toISOString().slice(0, 10)
  const { data: orgs } = await sb.from("organisations").select("id, nom, essai_jusqu_au").eq("essai_jusqu_au", hierStr)
  for (const o of orgs || []) {
    const vars = { station: o.nom, date_fin: o.essai_jusqu_au }
    for (const r of regles) {
      const dest = r.destinataires?.type === "roles_client" ? await emailsRoles(r.destinataires.roles, { organisationId: o.id }) : destinatairesStatiques(r)
      for (const email of dest) await envoyer(r.id, "essai_termine", email, r.sujet, r.corps_html, vars)
    }
  }
  await setCursor("essai_termine", new Date().toISOString())
}
async function traiterFactureEmise(regles: any[]) {
  const cursor = await getCursor("facture_emise")
  const { data: factures } = await sb.from("factures").select("*, organisations(nom)").gt("created_at", cursor).neq("statut", "annulee").order("created_at")
  if (!factures?.length) return
  let dernier = cursor
  for (const f of factures as any[]) {
    const vars = { numero: f.numero, montant: String(f.montant_ttc), periode_debut: f.periode_debut, periode_fin: f.periode_fin }
    for (const r of regles) {
      const dest = r.destinataires?.type === "roles_client" ? await emailsRoles(r.destinataires.roles, { organisationId: f.organisation_id }) : destinatairesStatiques(r)
      for (const email of dest) await envoyer(r.id, "facture_emise", email, r.sujet, r.corps_html, vars)
    }
    if (f.created_at > dernier) dernier = f.created_at
  }
  await setCursor("facture_emise", dernier)
}
async function traiterFactureRetard(regles: any[]) {
  const cursor = await getCursor("facture_retard")
  if (cursor.slice(0, 10) === new Date().toISOString().slice(0, 10)) return
  const seuil = new Date(); seuil.setDate(seuil.getDate() - 7)
  const { data: factures } = await sb.from("factures").select("*").eq("statut", "emise").lt("date_emission", seuil.toISOString().slice(0, 10))
  for (const f of factures || []) {
    const vars = { numero: f.numero, montant: String(f.montant_ttc), date_emission: f.date_emission }
    for (const r of regles) {
      const dest = r.destinataires?.type === "roles_client" ? await emailsRoles(r.destinataires.roles, { organisationId: f.organisation_id }) : destinatairesStatiques(r)
      for (const email of dest) await envoyer(r.id, "facture_retard", email, r.sujet, r.corps_html, vars)
    }
  }
  await setCursor("facture_retard", new Date().toISOString())
}

const HANDLERS: Record<string, (regles: any[]) => Promise<void>> = {
  versement_manquant: (r) => traiterAlerte("versement_manquant", r),
  versement_incomplet: (r) => traiterAlerte("versement_incomplet", r),
  ecart_caisse: (r) => traiterAlerte("ecart_caisse", r),
  ecart_compteur: (r) => traiterAlerte("ecart_compteur", r),
  ecart_stock: (r) => traiterAlerte("ecart_stock", r),
  stock_bas: (r) => traiterAlerte("stock_bas", r),
  point_manquant: (r) => traiterAlerte("point_manquant", r),
  releve_compteur_manquant: (r) => traiterAlerte("releve_compteur_manquant", r),
  depense_non_justifiee: (r) => traiterAlerte("depense_non_justifiee", r),
  commande_a_valider: traiterCommandeAValider,
  commande_statut: traiterCommandeStatut,
  reception_ecart: traiterReceptionEcart,
  essai_j3: traiterEssaiJ3,
  essai_termine: traiterEssaiTermine,
  facture_emise: traiterFactureEmise,
  facture_retard: traiterFactureRetard,
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const { data: regles } = await sb.from("notification_rules").select("*").eq("actif", true)
    const resultats: Record<string, string> = {}
    for (const [trigger, handler] of Object.entries(HANDLERS)) {
      const r = (regles || []).filter((x: any) => x.trigger_key === trigger)
      if (!r.length) continue
      try { await handler(r); resultats[trigger] = "ok" }
      catch (e) { resultats[trigger] = "erreur: " + String(e) }
    }
    return json({ ok: true, resultats })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
