import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { Viewport } from '../ds/pumpit/components/core/Viewport.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

// Affiché à la place de toute l'app quand une session "recovery" est détectée (lien reçu
// par email, voir lib/auth.jsx) — jamais un écran accessible autrement.
export default function ResetPassword() {
  const { updatePassword, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault(); setErr('')
    if (password.length < 6) { setErr('6 caractères minimum.'); return }
    if (password !== confirm) { setErr('Les deux mots de passe ne correspondent pas.'); return }
    setBusy(true)
    const { error } = await updatePassword(password)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setDone(true)
    // Repart sur une connexion normale avec le nouveau mot de passe, plutôt que de rester
    // dans cette session "recovery" temporaire dont l'état (profil, permissions...) n'a
    // jamais été chargé.
    setTimeout(() => signOut(), 1500)
  }

  return (
    <Viewport>
      <div className="pi-auth">
        <div className="pi-auth-brand">
          <img src="/brand/pumpit-logo-inverse.png" alt="PumpIT" />
          <div>
            <p className="slogan">Pilotez votre station, où que vous soyez.</p>
          </div>
        </div>
        <div className="pi-auth-form">
          <div style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
            <div>
              <h1 style={{ fontSize: 30 }}>Nouveau mot de passe</h1>
              <p style={{ font: '400 15px/1.5 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-2) 0 0' }}>
                Choisissez un nouveau mot de passe pour votre compte.
              </p>
            </div>
            {err && <AlertBanner tone="alarm" title="Impossible d'enregistrer">{err}</AlertBanner>}
            {done
              ? <AlertBanner tone="ok" title="Mot de passe mis à jour">Reconnectez-vous avec votre nouveau mot de passe.</AlertBanner>
              : <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                  <Field label="Nouveau mot de passe" required hint="6 caractères minimum.">
                    <Input size="lg" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
                  </Field>
                  <Field label="Confirmer le mot de passe" required>
                    <Input size="lg" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={6} />
                  </Field>
                  <Button type="submit" tone="primary" size="lg" block disabled={busy} style={{ marginTop: 'var(--sp-3)' }}>
                    {busy ? 'Un instant…' : 'Enregistrer le nouveau mot de passe'}
                  </Button>
                </form>}
          </div>
        </div>
      </div>
    </Viewport>
  )
}
