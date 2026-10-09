// Supabase Edge Function : permet à un admin de changer l'adresse email d'un membre de son
// équipe. Nécessite l'API Admin de Supabase Auth (clé service_role) — impossible depuis le
// navigateur, donc impossible en direct depuis Stations.jsx (voir migration_v131).
//
// Déploiement :
//   supabase functions deploy admin-update-email
// (pas de secret supplémentaire à poser : SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/
// SUPABASE_ANON_KEY sont déjà fournis automatiquement à toute edge function Supabase)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } })

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const { profile_id, new_email } = await req.json()
    if (!profile_id || !new_email) return json({ error: "profile_id et new_email requis" }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) return json({ error: "Adresse email invalide." }, 400)

    // Contrôle d'accès : `sb` utilise service_role et contourne le RLS — on vérifie donc,
    // avec le jeton de l'APPELANT, qu'il est bien admin ET que le profil ciblé lui est
    // visible (RLS "tenant_isolation" = même organisation). Sinon n'importe quel compte
    // connecté pourrait changer l'email de n'importe qui (même pattern que ocr-bordereau).
    const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    })
    const { data: amIAdmin } = await asCaller.rpc("is_admin")
    if (!amIAdmin) return json({ error: "Réservé aux administrateurs." }, 403)
    const { data: cible } = await asCaller.from("profiles").select("id").eq("id", profile_id).maybeSingle()
    if (!cible) return json({ error: "Membre introuvable ou hors de votre organisation." }, 403)

    // email_confirm: true — l'admin agit pour le compte du membre (ex. ancienne adresse
    // injoignable, faute de frappe à la création) : pas de double opt-in sur la nouvelle
    // adresse, le changement est immédiat.
    const { error } = await sb.auth.admin.updateUserById(profile_id, { email: new_email, email_confirm: true })
    if (error) return json({ error: error.message }, 400)

    return json({ ok: true })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
