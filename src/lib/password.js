// Règles de robustesse du mot de passe — seule source de vérité, utilisée à l'inscription
// et au changement de mot de passe. Note : ceci ne vérifie que côté client (confort/retour
// immédiat) — la vraie barrière de sécurité doit AUSSI être réglée côté Supabase Auth
// (Dashboard > Authentication > Policies, sur CHAQUE projet : staging et production),
// sinon un appel direct à l'API contournerait ces règles.
export const PASSWORD_RULES = [
  { key: 'length', label: 'Au moins 8 caractères', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'Une majuscule', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'Une minuscule', test: (p) => /[a-z]/.test(p) },
  { key: 'digit', label: 'Un chiffre', test: (p) => /[0-9]/.test(p) },
]
export const passwordValid = (p) => PASSWORD_RULES.every((r) => r.test(p || ''))
