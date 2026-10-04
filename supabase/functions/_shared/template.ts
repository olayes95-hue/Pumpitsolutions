// Gabarit e-mail partagé (logo + "Bonjour," + corps + pied de page) — appliqué à toute
// notification envoyée par PumpIT. La règle ne configure que le corps spécifique
// ({{variables}} remplacées avant l'appel) ; cette fonction ajoute l'enveloppe.

const LOGO_URL = "https://pumpit-app.vercel.app/brand/pumpit-logo-principal.png"

export function enveloppeEmail(corpsHtml: string): string {
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

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}
