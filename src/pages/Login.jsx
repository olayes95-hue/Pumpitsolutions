import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { Viewport } from '../ds/pumpit/components/core/Viewport.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

export default function Login() {
  const { signIn, signUp, resetPasswordForEmail } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) setErr(traduire(error.message))
      } else if (mode === 'forgot') {
        const { error } = await resetPasswordForEmail(email)
        // Message volontairement identique en cas d'erreur « email inconnu » (Supabase ne la
        // distingue pas non plus par défaut) : ne jamais révéler si un email a un compte ou non.
        if (error && !/user not found/i.test(error.message)) setErr(error.message)
        else setMsg("Si un compte existe avec cet e-mail, un lien de réinitialisation vient d'être envoyé.")
      } else {
        const { error } = await signUp(email, password, name, code)
        if (error) setErr(traduire(error.message))
        else setMsg('Compte créé. Confirmez votre e-mail si un message vous est envoyé, puis connectez-vous.')
      }
    } finally { setBusy(false) }
  }

  const link = { cursor: 'pointer', background: 'none', border: 0, padding: 0, color: 'var(--text-link)', font: '600 14px/1.4 var(--font-ui)' }

  return (
    <Viewport>
      <div className="pi-auth">
        <div className="pi-auth-brand">
          <img src="/brand/pumpit-logo-inverse.png" alt="PumpIT" />
          <div>
            <p className="slogan">Pilotez votre station, où que vous soyez.</p>
            <p className="sub">Carburants, lubrifiants, gaz, supérette : chaque litre compté, chaque versement suivi.</p>
          </div>
        </div>

        <div className="pi-auth-form">
          <div style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
            <div>
              <h1 style={{ fontSize: 30 }}>{mode === 'login' ? 'Connexion' : mode === 'forgot' ? 'Mot de passe oublié' : 'Créer un compte'}</h1>
              <p style={{ font: '400 15px/1.5 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-2) 0 0' }}>
                {mode === 'login' ? 'Entrez vos identifiants pour accéder à votre station.'
                  : mode === 'forgot' ? 'Indiquez votre e-mail, vous recevrez un lien pour choisir un nouveau mot de passe.'
                  : 'Un administrateur validera votre compte avant le premier accès.'}
              </p>
            </div>

            {err && <AlertBanner tone="alarm" title={mode === 'forgot' ? 'Impossible' : 'Connexion impossible'}>{err}</AlertBanner>}
            {msg && <AlertBanner tone="ok" title={mode === 'forgot' ? 'E-mail envoyé' : 'Compte créé'}>{msg}</AlertBanner>}

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              {mode === 'signup' && (
                <Field label="Nom complet" required>
                  <Input size="lg" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required />
                </Field>
              )}
              {mode === 'signup' && (
                <Field label="Code entreprise" required hint="Code de 8 caractères remis par votre administrateur.">
                  <Input size="lg" autoComplete="off" autoCapitalize="characters" value={code} onChange={e => setCode(e.target.value.toUpperCase())} required minLength={4} maxLength={16} />
                </Field>
              )}
              <Field label="E-mail" required>
                <Input size="lg" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
              </Field>
              {mode !== 'forgot' && (
                <Field label="Mot de passe" required hint={mode === 'signup' ? '6 caractères minimum.' : undefined}>
                  <Input size="lg" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
                </Field>
              )}
              {mode === 'login' && (
                <button type="button" style={{ ...link, alignSelf: 'flex-end', font: '500 13px/1.4 var(--font-ui)' }} onClick={() => { setMode('forgot'); setErr(''); setMsg('') }}>
                  Mot de passe oublié ?
                </button>
              )}
              <Button type="submit" tone="primary" size="lg" block disabled={busy} style={{ marginTop: 'var(--sp-3)' }}>
                {busy ? 'Un instant…' : mode === 'login' ? 'Se connecter' : mode === 'forgot' ? 'Envoyer le lien' : 'Créer le compte'}
              </Button>
            </form>

            <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
              {mode === 'login'
                ? <>Pas encore de compte ? <button type="button" style={link} onClick={() => setMode('signup')}>Créer un compte</button></>
                : mode === 'forgot'
                ? <>Retour à la <button type="button" style={link} onClick={() => { setMode('login'); setErr(''); setMsg('') }}>connexion</button></>
                : <>Déjà un compte ? <button type="button" style={link} onClick={() => setMode('login')}>Se connecter</button></>}
            </p>
          </div>
        </div>
      </div>
    </Viewport>
  )
}

function traduire(m) {
  if (/Invalid login/i.test(m)) return 'E-mail ou mot de passe incorrect.'
  if (/already registered/i.test(m)) return 'Cet e-mail a déjà un compte.'
  if (/Email not confirmed/i.test(m)) return 'E-mail non confirmé. Ouvrez le message reçu pour le confirmer.'
  return m
}
