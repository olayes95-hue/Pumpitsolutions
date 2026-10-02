// Supabase Edge Function : OCR d'un bordereau de versement (vision IA Anthropic).
// Lit la photo du versement, extrait le montant/date/référence, compare au déclaré.
//
// Déploiement :
//   1) supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
//   2) supabase functions deploy ocr-bordereau
// (ou créer la fonction depuis le dashboard Supabase > Edge Functions et coller ce code)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } })

function toBase64(bytes: Uint8Array): string {
  let bin = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const { deposit_id } = await req.json()
    if (!deposit_id) return json({ error: "deposit_id requis" }, 400)

    const { data: dep } = await sb.from("deposits").select("*").eq("id", deposit_id).single()
    if (!dep?.photo_path) return json({ error: "Ce versement n'a pas de photo." }, 400)

    const { data: file, error: dlErr } = await sb.storage.from("bordereaux").download(dep.photo_path)
    if (dlErr || !file) return json({ error: "Photo introuvable : " + (dlErr?.message ?? "") }, 400)
    const b64 = toBase64(new Uint8Array(await file.arrayBuffer()))
    const media = dep.photo_path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: b64 } },
            {
              type: "text",
              text: "Ceci est un reçu bancaire de VERSEMENT ESPECES (Bank of Africa Bénin). " +
                "Réponds UNIQUEMENT par un JSON compact, sans texte autour : " +
                '{"montant": <entier FCFA = la somme reçue en espèces, valeur après "la somme de : XOF">, ' +
                '"date": "YYYY-MM-DD" ou null, "reference": "..." ou null}. ' +
                "Si l'image n'est pas un reçu bancaire lisible, renvoie {\"montant\": null}.",
            },
          ],
        }],
      }),
    })
    const j = await resp.json()
    if (!resp.ok) return json({ error: "Anthropic: " + (j?.error?.message ?? resp.status) }, 502)

    const text: string = j?.content?.[0]?.text ?? "{}"
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = match ? JSON.parse(match[0]) : {}
    const montant_ocr = parsed.montant != null ? Number(String(parsed.montant).replace(/[^0-9]/g, "")) : null
    const ecart = (montant_ocr != null && dep.montant != null) ? montant_ocr - Number(dep.montant) : null

    await sb.from("deposits").update({
      montant_ocr, date_ocr: parsed.date || null, ref_ocr: parsed.reference || null,
      ocr_ecart: ecart, ocr_at: new Date().toISOString(),
    }).eq("id", deposit_id)

    return json({ montant_ocr, date_ocr: parsed.date ?? null, reference: parsed.reference ?? null, ecart, declare: dep.montant })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
