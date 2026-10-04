// Supabase Edge Function : à appeler périodiquement (Cron Supabase, voir README) — regarde
// ce qu'il s'est passé depuis le dernier passage pour chaque déclencheur actif dans
// notification_rules, et envoie les e-mails correspondants via Brevo.
//
// Déclencheurs gérés ici (étendre cette liste pour en ajouter d'autres) :
//   'user_signup'  — nouveau compte (profiles.created_at)
//   'alerte_haute' — nouvelle alerte de gravité haute (v_alerts, toutes stations/organisations)
//
// Déploiement :
//   1) Les secrets BREVO_API_KEY / BREVO_SENDER_EMAIL / BREVO_SENDER_NOM (voir send-notification)
//   2) supabase functions deploy notification-poller
//   3) Programmer l'appel périodique — Supabase Dashboard > Edge Functions > notification-poller
//      > Cron (ex. toutes les 15 min), ou pg_cron + pg_net si tu préfères depuis la base.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!
const SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "notifications@pumpit.app"
const SENDER_NOM = Deno.env.get("BREVO_SENDER_NOM") ?? "PumpIT"
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS, GET" }
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } })

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m))
}

async function envoyer(ruleId: number, triggerKey: string, email: string, sujet: string, corps: string, vars: Record<string, string>) {
  const sujetRendu = render(sujet, vars)
  const corpsRendu = render(corps, vars)
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

// Résout la liste de destinataires d'une règle pour un événement donné.
function destinatairesDe(regle: any, evenementEmail: string | null): string[] {
  const d = regle.destinataires || {}
  if (d.type === "fixe") return Array.isArray(d.emails) ? d.emails : []
  if (d.type === "evenement") return evenementEmail ? [evenementEmail] : []
  return []
}

async function getCursor(trigger: string): Promise<string> {
  const { data } = await sb.from("notification_cursors").select("dernier_at").eq("trigger_key", trigger).maybeSingle()
  return data?.dernier_at || "2000-01-01T00:00:00Z"
}
async function setCursor(trigger: string, at: string) {
  await sb.from("notification_cursors").upsert({ trigger_key: trigger, dernier_at: at })
}

async function traiterSignups(regles: any[]) {
  const cursor = await getCursor("user_signup")
  const { data: profils } = await sb.from("profiles").select("id, full_name, created_at").gt("created_at", cursor).order("created_at")
  if (!profils?.length) return
  let dernier = cursor
  for (const p of profils) {
    const { data: u } = await sb.auth.admin.getUserById(p.id)
    const email = u?.user?.email
    const vars = { nom: p.full_name || "", email: email || "" }
    for (const r of regles) {
      for (const dest of destinatairesDe(r, email || null)) {
        await envoyer(r.id, "user_signup", dest, r.sujet, r.corps_html, vars)
      }
    }
    if (p.created_at > dernier) dernier = p.created_at
  }
  await setCursor("user_signup", dernier)
}

async function traiterAlertesHautes(regles: any[]) {
  const cursor = await getCursor("alerte_haute")
  const curDate = cursor.slice(0, 10)
  const { data: alertes } = await sb.from("v_alerts").select("*").eq("gravite", "haute").gt("report_date", curDate).order("report_date")
  if (!alertes?.length) return
  const stationIds = [...new Set(alertes.map((a: any) => a.station_id))]
  const { data: stations } = await sb.from("stations").select("id, nom").in("id", stationIds)
  const nomStation = new Map((stations || []).map((s: any) => [s.id, s.nom]))
  let dernier = cursor
  for (const a of alertes) {
    const vars = { station: nomStation.get(a.station_id) || `station #${a.station_id}`, type: a.type, detail: a.detail, date: a.report_date }
    for (const r of regles) {
      for (const dest of destinatairesDe(r, null)) {
        await envoyer(r.id, "alerte_haute", dest, r.sujet, r.corps_html, vars)
      }
    }
    if (a.report_date > dernier) dernier = a.report_date
  }
  await setCursor("alerte_haute", dernier)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const { data: regles } = await sb.from("notification_rules").select("*").eq("actif", true)
    const parTrigger = (key: string) => (regles || []).filter((r: any) => r.trigger_key === key)

    const resultats: Record<string, string> = {}
    for (const trigger of ["user_signup", "alerte_haute"]) {
      const r = parTrigger(trigger)
      if (!r.length) continue
      try {
        if (trigger === "user_signup") await traiterSignups(r)
        if (trigger === "alerte_haute") await traiterAlertesHautes(r)
        resultats[trigger] = "ok"
      } catch (e) { resultats[trigger] = "erreur: " + String(e) }
    }
    return json({ ok: true, resultats })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
