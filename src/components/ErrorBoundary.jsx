import React from 'react'
import { Button } from '../ds/pumpit/components/core/Button.jsx'

// Sans ce garde-fou, une erreur dans une page laisse un écran blanc. Ici, la navigation
// reste utilisable et l'utilisateur sait quoi faire.
export default class ErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('Erreur d\'affichage :', error, info) }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ background: 'var(--state-alarm-bg)', borderRadius: 'var(--radius-card)', padding: 'var(--sp-7)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
        <h2 style={{ fontSize: 20, color: 'var(--state-alarm-text)' }}>Cette page ne s'affiche pas.</h2>
        <p style={{ margin: 0, color: 'var(--nuit)' }}>Vos données ne sont pas touchées. Rechargez la page. Si le problème revient, prévenez l'administrateur.</p>
        <Button tone="dark" icon="rotate-ccw" onClick={() => window.location.reload()}>Recharger</Button>
      </div>
    )
  }
}
