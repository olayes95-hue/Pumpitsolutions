import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { useOffre } from '../lib/offre.jsx'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Icon } from '../ds/pumpit/components/core/Icon.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'

function StepNum({ n }) {
  return <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-quiet)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', font: 'var(--fw-semibold) 14px/1.25 var(--font-data)' }}>{n}</span>
}

function StepPanel({ n, title, action, children }) {
  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <StepNum n={n} />
        <h2 style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)', margin: 0, flex: 1 }}>{title}</h2>
        {action}
      </div>
      <ul style={{ lineHeight: 1.9, fontSize: 15, margin: 0, paddingLeft: 18, color: 'var(--text-body)' }}>{children}</ul>
    </Panel>
  )
}

function Faq({ q, children }) {
  return (
    <details style={{ marginBottom: 'var(--sp-3)' }}>
      <summary style={{ font: 'var(--fw-semibold) 15px/1.3 var(--font-ui)', color: 'var(--text-primary)', cursor: 'pointer' }}>{q}</summary>
      <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>{children}</p>
    </details>
  )
}

// Sections accessibles selon les permissions réelles du profil connecté — pour les rôles
// sans saisie quotidienne (directeur, comptable, ou tout rôle créé depuis l'écran Rôles),
// dont le contenu varie d'un compte à l'autre, contrairement au script fixe du gérant.
function useSectionsAccessibles() {
  const { can, isAdmin } = useAuth()
  const { has } = useOffre()
  const ok = (permission) => isAdmin || can(permission)
  return [
    ok('view_dashboard') && { to: '/tableau', label: 'Tableau de bord', desc: "Chiffres clés et alertes de la station, en direct." },
    ok('validate_orders') && { to: '/commandes', label: 'Commandes', desc: 'Valider ou refuser les commandes de carburant, gaz et lubrifiant proposées par le gérant.' },
    (ok('view_finance') && has('finance')) && { to: '/finance', label: 'Point financier', desc: 'Produits, charges, résultat et bilan simplifié de la station.' },
    (ok('view_finance') && has('finance')) && { to: '/rapport-mensuel', label: 'Rapport mensuel', desc: "Synthèse du mois (résultat, manque à verser, recommandations), exportable en PDF." },
    (ok('view_bank_recon') && has('finance')) && { to: '/rapprochement', label: 'Rapprochement bancaire', desc: 'Catégoriser les lignes du relevé bancaire importé et suivre le compte.' },
    (ok('view_ocr_check') && has('bordereaux')) && { to: '/verif-photos', label: 'Bordereaux', desc: 'Vérifier les photos de versement par lecture automatique.' },
    ok('view_alerts') && { to: '/alertes', label: 'Alertes', desc: 'Écarts de caisse, versements manquants, stocks bas.' },
    ok('view_history') && { to: '/historique', label: 'Historique', desc: 'Toutes les journées saisies, station par station.' },
    (ok('view_prevision') && has('prevision')) && { to: '/prevision', label: 'Prévision de commande', desc: 'Quand et combien commander, selon le rythme de consommation.' },
    (ok('manage_stations_config') || ok('manage_team')) && { to: '/stations', label: 'Stations et équipe', desc: 'Comptes, rôles et paramètres des stations.' },
    (ok('view_audit_log') && has('audit')) && { to: '/audit', label: "Journal d'audit", desc: 'Historique de toutes les modifications effectuées dans l’application.' },
    ok('view_price_history') && { to: '/produits', label: 'Historique des prix', desc: "Suivi des changements de prix d'achat et de vente." },
  ].filter(Boolean)
}

export default function Aide() {
  const nav = useNavigate()
  const { isPompiste, isVendeuse, isAdmin, profile, can } = useAuth()
  const [jours, setJours] = useState(2)
  useEffect(() => {
    supabase.from('settings').select('jours_correction_gerant').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data?.jours_correction_gerant) setJours(data.jours_correction_gerant) })
  }, [])
  const joursTxt = jours === 1 ? "aujourd'hui" : `les ${jours} derniers jours`

  const isGerant = profile?.role === 'gerant'
  const opMetier = isAdmin || isGerant || isPompiste || can('manage_orders')
  const op = opMetier || isVendeuse
  const sections = useSectionsAccessibles()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      <Panel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
          <Icon name="circle-question-mark" size={18} color="var(--accent)" />
          <h2 style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)', margin: 0 }}>Comment utiliser l'application</h2>
        </div>
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
          {isVendeuse ? 'La vente en supérette, par produit.'
            : isPompiste ? 'Vos deux moments dans la journée : stock le matin, compteurs à 16 h.'
            : opMetier ? '3 moments dans la journée. Seuls les champs à remplir s\'affichent. Envoyez à chaque fois.'
            : "Ce que vous pouvez consulter et faire avec votre profil."}
        </p>
      </Panel>

      <Panel title="Première connexion — nouveau compte">
        <ul style={{ lineHeight: 1.9, fontSize: 15, margin: 0, paddingLeft: 18, color: 'var(--text-body)' }}>
          <li>Créez votre compte sur l'écran de connexion (« Créer un compte » — nom, email, mot de passe).</li>
          <li>Votre compte reste <b>en attente de validation</b> tant que la direction ne l'a pas approuvé et rattaché à votre station : vous verrez un message « Compte en attente de validation », pas encore l'application.</li>
          <li>Prévenez la direction dès votre inscription : elle valide votre compte et vous attribue votre station (ex. Vedoko) dans Stations et équipe.</li>
          <li>Une fois validé, reconnectez-vous (ou rechargez la page) : l'application s'ouvre normalement.</li>
        </ul>
      </Panel>

      {/* ---------- Vendeuse : supérette uniquement ---------- */}
      {isVendeuse && (<>
        <StepPanel n={1} title="Vente du jour, produit par produit" action={<Button size="sm" onClick={() => nav('/saisie')}>Aller à Saisie supérette</Button>}>
          <li>Recherchez le produit dans la liste (ou ajoutez-le s'il n'existe pas encore — il sera validé par la direction).</li>
          <li>Pour chaque article vendu aujourd'hui, saisissez la <b>quantité vendue</b>.</li>
          <li>Si une livraison est arrivée, saisissez la <b>quantité reçue</b> pour ce produit.</li>
          <li>Un article abîmé ou expiré : saisissez-le en <b>périmé</b>.</li>
          <li>Envoyez — recommencez à tout moment dans la journée, la dernière saisie remplace la précédente.</li>
        </StepPanel>
        <Panel title="Questions fréquentes">
          <Faq q="J'ai ajouté un produit qui n'existe pas encore ?">Il apparaît immédiatement dans votre liste, mais reste « en attente » jusqu'à ce qu'un administrateur le valide depuis Produits & prix.</Faq>
          <Faq q="Je me suis trompée sur une quantité ?">Resaisissez le bon chiffre pour ce produit et renvoyez — tant que vous êtes dans {joursTxt}.</Faq>
          <Faq q="Mot de passe oublié ?">Cliquez « Mot de passe oublié ? » sur l'écran de connexion : un lien de réinitialisation vous est envoyé par e-mail.</Faq>
          <Faq q="« Compte en attente de validation » ?">Votre compte est créé. La direction doit encore le valider et vous attribuer une station : prévenez-la.</Faq>
        </Panel>
      </>)}

      {/* ---------- Pompiste : stock + compteurs, pas de ventes/versements ---------- */}
      {isPompiste && (<>
        <StepPanel n={1} title="Matin (8h) — le stock" action={<Button size="sm" onClick={() => nav('/saisie?moment=matin')}>Aller à Saisie du jour</Button>}>
          <li><b>Stock en cuve</b> : litres d'essence et de gasoil restants.</li>
          <li><b>Relevés compteurs à l'ouverture</b> : l'index de chaque pompe <b>+ la photo</b>.</li>
          <li><b>Bouteilles de gaz</b> (boutons − / +) et <b>lubrifiants</b>.</li>
          <li>Appuyez sur <b>Envoyer (Matin)</b>.</li>
        </StepPanel>
        <StepPanel n={2} title="16 h — relevés compteurs" action={<Button size="sm" onClick={() => nav('/saisie?moment=apres-midi')}>Aller à Saisie du jour</Button>}>
          <li><b>Relevés 16 h</b> : index de chaque pompe <b>+ photo</b>. <b>Obligatoire</b> pour envoyer.</li>
          <li>Les ventes (litres, bon/espèces) et les versements sont saisis par le gérant — vous n'avez rien d'autre à remplir ici.</li>
        </StepPanel>
        <Panel status="warn">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
            <Icon name="triangle-alert" size={16} color="var(--state-warn)" />
            <h2 style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)', margin: 0 }}>À retenir</h2>
          </div>
          <ul style={{ lineHeight: 1.9, fontSize: 15, margin: 0, paddingLeft: 18, color: 'var(--text-body)' }}>
            <li><b>Photo obligatoire</b> à chaque relevé de compteur (matin et 16 h) — l'envoi est bloqué sans elle.</li>
            <li>Vous créez ou corrigez une journée dans <b>{joursTxt}</b> ; au-delà, c'est la direction.</li>
          </ul>
        </Panel>
        <Panel title="Questions fréquentes">
          <Faq q="Je me suis trompé sur un relevé ?">Rouvrez la même date, corrigez et renvoyez (possible dans {joursTxt}).</Faq>
          <Faq q="« Relevés 16 h obligatoires »">Remplissez l'index de chaque pompe avant d'envoyer le point de 16 h.</Faq>
          <Faq q="Mot de passe oublié ?">Cliquez « Mot de passe oublié ? » sur l'écran de connexion : un lien de réinitialisation vous est envoyé par e-mail.</Faq>
          <Faq q="« Compte en attente de validation » ?">Votre compte est créé. La direction doit encore le valider et vous attribuer une station : prévenez-la.</Faq>
        </Panel>
      </>)}

      {/* ---------- Gérant / admin opérationnel : le script complet ---------- */}
      {opMetier && !isPompiste && (<>
        <StepPanel n={1} title="Matin (8h) — le stock" action={<Button size="sm" onClick={() => nav('/saisie?moment=matin')}>Aller à Saisie du jour</Button>}>
          <li><b>Stock en cuve</b> : litres d'essence et de gasoil restants.</li>
          <li><b>Relevés compteurs à l'ouverture</b> : l'index de chaque pompe <b>+ la photo</b>.</li>
          <li><b>Bouteilles de gaz</b> (boutons − / +) et <b>lubrifiants</b>.</li>
          <li>Appuyez sur <b>Envoyer (Matin)</b>.</li>
        </StepPanel>

        <StepPanel n={2} title="16 h — ventes & compteurs" action={<Button size="sm" onClick={() => nav('/saisie?moment=apres-midi')}>Aller à Saisie du jour</Button>}>
          <li><b>Ventes carburant de la veille</b> : litres, puis séparez <b>Bon</b> / <b>Espèces</b>.</li>
          <li><b>Relevés 16 h</b> : index de chaque pompe <b>+ photo</b>. <b>Obligatoire</b> pour envoyer.</li>
          <li><b>Gaz vendu</b> (bouteilles, dont la part avec consigne) <b>et Lubrifiants vendus</b> (quantité par référence) — sert à calculer la vraie commission, pas juste une estimation.</li>
          <li>Recettes espèces des autres pôles (gaz, lubrifiant, supérette).</li>
        </StepPanel>

        <StepPanel n={3} title="Soir — clôture" action={<Button size="sm" onClick={() => nav('/saisie?moment=soir')}>Aller à Saisie du jour</Button>}>
          <li><b>Achats hors carburant</b> (gaz, lubrifiant, supérette) + fournisseur.</li>
          <li><b>Dépenses</b> : montant + motif + <b>cochez « J'ai le justificatif »</b> (obligatoire).</li>
          <li><b>Versement banque</b> : montant + <b>photo du bordereau</b> (obligatoire).</li>
          <li>Vérifiez <b>À verser / Versé / Écart</b> puis <b>Envoyer (Soir)</b>.</li>
        </StepPanel>

        <Panel title="Réception d'une commande" actions={<Button size="sm" onClick={() => nav('/commandes')}>Aller aux Commandes</Button>}>
          <p style={{ font: '400 15px/1.5 var(--font-ui)', color: 'var(--text-body)', margin: 0 }}>
            Une commande peut arriver <b>à n'importe quel moment de la journée</b>, pas seulement le soir. Sur Saisie du jour, appuyez sur <b>« J'ai reçu une commande »</b> en haut de la page : la liste des commandes en attente apparaît, choisissez <b>Réceptionner</b> → cuve avant puis après. Le stock se met à jour seul.
          </p>
        </Panel>

        <Panel status="warn">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
            <Icon name="triangle-alert" size={16} color="var(--state-warn)" />
            <h2 style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)', margin: 0 }}>À retenir</h2>
          </div>
          <ul style={{ lineHeight: 1.9, fontSize: 15, margin: 0, paddingLeft: 18, color: 'var(--text-body)' }}>
            <li><b>Photos obligatoires</b> (l'envoi est bloqué sans elles) :
              <ul style={{ marginTop: 4 }}>
                <li><b>Chaque compteur</b> (matin + 16 h)</li>
                <li><b>Chaque dépense</b> (le justificatif)</li>
                <li><b>Chaque versement</b> (le bordereau)</li>
                <li><b>Chaque réception</b> carburant (bon / jauge)</li>
              </ul></li>
            <li>Relevés <b>16 h</b> : l'index de chaque pompe est obligatoire.</li>
            <li>Vous créez ou corrigez une journée dans <b>{joursTxt}</b> ; au-delà, c'est la direction.</li>
            <li>Rien envoyé à <b>8 h</b> ou <b>17 h</b> ? Une alerte vous est envoyée, ainsi qu'à la direction.</li>
          </ul>
        </Panel>

        <Panel title="Questions fréquentes">
          <Faq q="Je me suis trompé sur un chiffre ?">Rouvrez la même date, corrigez et renvoyez (possible dans {joursTxt}).</Faq>
          <Faq q="« Journée verrouillée »">La journée est en dehors de la fenêtre autorisée ({joursTxt}) : demandez à la direction de la corriger.</Faq>
          <Faq q="« Relevés 16 h obligatoires »">Remplissez l'index de chaque pompe avant d'envoyer le point de 16 h.</Faq>
          <Faq q="Réceptionner une livraison de carburant ?">À tout moment : sur Saisie du jour, bouton « J'ai reçu une commande » en haut de page → Réceptionner → cuve avant puis après. Le stock se met à jour seul.</Faq>
          <Faq q="Mot de passe oublié ?">Cliquez « Mot de passe oublié ? » sur l'écran de connexion : un lien de réinitialisation vous est envoyé par e-mail.</Faq>
          <Faq q="« Compte en attente de validation » ?">Votre compte est créé. La direction doit encore le valider et vous attribuer une station : prévenez-la.</Faq>
        </Panel>
      </>)}

      {/* ---------- Sans saisie quotidienne : directeur, comptable, rôle sur mesure ---------- */}
      {!op && (<>
        <Panel title="Ce que votre profil peut faire">
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
            Vous ne saisissez pas le point quotidien (c'est le rôle du gérant/pompiste) — ce qui suit dépend des droits attribués à votre compte, et peut varier d'une personne à l'autre.
          </p>
          {sections.length
            ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--sp-4)' }}>
                {sections.map(s => (
                  <div key={s.to} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)' }}>
                    <span style={{ font: 'var(--fw-semibold) 15px/1.2 var(--font-ui)', color: 'var(--text-primary)' }}>{s.label}</span>
                    <span style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-muted)', flex: 1 }}>{s.desc}</span>
                    <Button size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => nav(s.to)}>Ouvrir</Button>
                  </div>
                ))}
              </div>
            : <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>Aucun droit particulier n'est encore attribué à votre compte — demandez à un administrateur de vous donner accès depuis Stations et équipe → Rôles.</p>}
        </Panel>
        <Panel title="Questions fréquentes">
          <Faq q="Mot de passe oublié ?">Cliquez « Mot de passe oublié ? » sur l'écran de connexion : un lien de réinitialisation vous est envoyé par e-mail.</Faq>
          <Faq q="« Compte en attente de validation » ?">Votre compte est créé. La direction doit encore le valider et vous attribuer une station : prévenez-la.</Faq>
          <Faq q="Je ne vois pas une section dont j'ai besoin ?">Les sections affichées dépendent des droits de votre compte — demandez à un administrateur de les ajuster depuis Stations et équipe → Rôles.</Faq>
        </Panel>
      </>)}

      <Panel status="accent">
        <p style={{ font: 'var(--fw-semibold) 15px/1.5 var(--font-ui)', color: 'var(--text-primary)', textAlign: 'center', margin: 0 }}>
          {isVendeuse ? 'Une vente par produit, à tout moment de la journée. Envoyez à chaque fois.'
            : isPompiste ? 'Matin : stock + compteurs. 16 h : compteurs (obligatoire).'
            : opMetier ? 'Matin : stock + compteurs. 16 h : ventes + compteurs (obligatoire). Soir : dépenses + versement. Envoyez à chaque fois.'
            : 'Ce menu Aide s\'adapte aux droits de votre compte.'}
        </p>
      </Panel>
    </div>
  )
}
