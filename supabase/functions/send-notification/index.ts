// Supabase Edge Function : envoi d'un e-mail via Brevo, et journalisation du résultat.
// Appelée par notification-poller (service à service), jamais directement par le navigateur
// avec la clé Brevo — celle-ci ne doit exister que côté serveur.
//
// Déploiement :
//   1) supabase secrets set BREVO_API_KEY=xkeysib-xxx
//   2) supabase secrets set BREVO_SENDER_EMAIL=notifications@pumpit.app
//   3) supabase secrets set BREVO_SENDER_NOM="PumpIT"
//   4) supabase functions deploy send-notification

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!
const SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "notifications@pumpit.app"
const SENDER_NOM = Deno.env.get("BREVO_SENDER_NOM") ?? "PumpIT"
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } })

// Remplace {{variable}} par sa valeur dans le sujet/corps — variables non reconnues laissées
// telles quelles (pour repérer une erreur de template plutôt que de la masquer).
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m))
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const { rule_id, trigger_key, destinataire_email, sujet, corps_html, variables } = await req.json()
    if (!destinataire_email || !sujet || !corps_html) return json({ error: "destinataire_email, sujet et corps_html requis" }, 400)

    const vars = variables || {}
    const sujetRendu = render(sujet, vars)
    const corpsRendu = render(corps_html, vars)

    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: SENDER_EMAIL, name: SENDER_NOM },
        to: [{ email: destinataire_email }],
        subject: sujetRendu,
        htmlContent: corpsRendu,
      }),
    })
    const ok = resp.ok
    const body = await resp.json().catch(() => ({}))

    await sb.from("notification_log").insert({
      rule_id: rule_id ?? null,
      trigger_key: trigger_key ?? "manuel",
      destinataire_email,
      sujet: sujetRendu,
      statut: ok ? "envoye" : "echec",
      erreur: ok ? null : JSON.stringify(body),
      payload: vars,
    })

    if (!ok) return json({ error: "Brevo: " + (body?.message ?? resp.status) }, 502)
    return json({ ok: true, messageId: body?.messageId })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
