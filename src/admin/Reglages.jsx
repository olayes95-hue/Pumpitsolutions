import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { oublierPlateforme } from '../lib/plateforme'
import { uploadEvidence, compressImage } from '../lib/image'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'

// Réglages de la plateforme : assistance, période d'essai, émetteur des factures, contenu du
// site vitrine (pumpits.fr). Les prix et le contenu des offres se règlent dans la rubrique Offres.
export default function Reglages() {
  const [p, setP] = useState(null)
  const [vc, setVc] = useState(null)   // vitrine_contenu — contenu public du site vitrine (migration_v133)
  const [vcPhotoBusy, setVcPhotoBusy] = useState(null)   // clé de colonne photo en cours d'upload
  const [formules, setFormules] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    const [r, f, v] = await Promise.all([
      supabase.from('plateforme_reglages').select('*').eq('id', 1).maybeSingle(),
      supabase.from('formules').select('*').order('ordre'),
      supabase.from('vitrine_contenu').select('*').eq('id', 1).maybeSingle(),
    ])
    setP(r.data || {}); setFormules(f.data || []); setVc(v.data || {})
  }
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setP({ ...p, [k]: e.target.value })
  const set2 = (k) => (e) => setVc({ ...vc, [k]: e.target.value })
  // Nombre saisi avec une virgule ou un point décimal. Renvoie null si ce n'est pas un nombre.
  const nombre = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return String(v ?? '').trim() === '' || isNaN(n) ? null : n }
  const vide = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim())

  async function enregistrer(champs, message) {
    setErr(''); setMsg('')
    const { error } = await supabase.from('plateforme_reglages').update(champs).eq('id', 1)
    if (error) { setErr(error.message); return }
    oublierPlateforme(); setMsg(message); load()
  }
  async function enregistrerVitrine(champs, message) {
    setErr(''); setMsg('')
    const { error } = await supabase.from('vitrine_contenu').update(champs).eq('id', 1)
    if (error) { setErr(error.message); return }
    setMsg(message); load()
  }
  // Une photo du site vitrine (hero, "saisie du jour", témoignages) : compressée puis envoyée
  // dans le bucket public "vitrine" (même helper que les justificatifs/bordereaux — voir
  // src/lib/image.js), le chemin renvoyé est enregistré dans la colonne correspondante.
  async function uploadVitrinePhoto(colonne, slot, file) {
    if (!file) return
    setErr(''); setMsg(''); setVcPhotoBusy(colonne)
    try {
      const compressed = await compressImage(file)
      const path = await uploadEvidence(supabase, 'vitrine', slot, compressed)
      const { error } = await supabase.from('vitrine_contenu').update({ [colonne]: path }).eq('id', 1)
      if (error) throw error
      setMsg('Photo mise à jour.'); load()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setVcPhotoBusy(null) }
  }
  const vitrinePhotoUrl = (path) => path ? supabase.storage.from('vitrine').getPublicUrl(path).data.publicUrl : null

  if (!p) return <div className="center" style={{ minHeight: '40dvh' }}>Chargement…</div>
  const grille = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--sp-4)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {err && <AlertBanner tone="alarm" title="Action impossible" onDismiss={() => setErr('')}>{err}</AlertBanner>}
      {msg && <AlertBanner tone="ok" title="Enregistré" onDismiss={() => setMsg('')}>{msg}</AlertBanner>}

      <Panel title="Assistance" meta="affichée à vos clients">
        <form onSubmit={e => { e.preventDefault(); enregistrer({ telephone_assistance: vide(p.telephone_assistance), whatsapp_assistance: vide(p.whatsapp_assistance), horaires_assistance: vide(p.horaires_assistance) }, 'Coordonnées d\'assistance enregistrées.') }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={grille}>
            <Field label="Téléphone" hint="Bouton « Appeler »."><Input type="tel" value={p.telephone_assistance || ''} onChange={set('telephone_assistance')} placeholder="+229 …" /></Field>
            <Field label="WhatsApp" hint="Avec l'indicatif du pays."><Input type="tel" value={p.whatsapp_assistance || ''} onChange={set('whatsapp_assistance')} placeholder="+229 …" /></Field>
            <Field label="Horaires" hint="Affichés à côté des boutons."><Input value={p.horaires_assistance || ''} onChange={set('horaires_assistance')} placeholder="ex : du lundi au samedi, 8 h à 18 h" /></Field>
          </div>
          <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
        </form>
      </Panel>

      <Panel title="Émetteur des factures">
        <form onSubmit={e => { e.preventDefault(); enregistrer({ raison_sociale: vide(p.raison_sociale) || 'PumpIT Solutions', adresse: vide(p.adresse), telephone: vide(p.telephone), email: vide(p.email), rccm: vide(p.rccm), ifu: vide(p.ifu), coordonnees_bancaires: vide(p.coordonnees_bancaires), taux_tva: nombre(p.taux_tva) ?? 0, prefixe_facture: vide(p.prefixe_facture) || 'PI' }, 'Émetteur enregistré.') }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={grille}>
            <Field label="Raison sociale"><Input value={p.raison_sociale || ''} onChange={set('raison_sociale')} /></Field>
            <Field label="Adresse"><Input value={p.adresse || ''} onChange={set('adresse')} /></Field>
            <Field label="Téléphone"><Input type="tel" value={p.telephone || ''} onChange={set('telephone')} /></Field>
            <Field label="E-mail"><Input type="email" value={p.email || ''} onChange={set('email')} /></Field>
            <Field label="RCCM"><Input value={p.rccm || ''} onChange={set('rccm')} /></Field>
            <Field label="IFU"><Input value={p.ifu || ''} onChange={set('ifu')} /></Field>
            <Field label="Coordonnées bancaires"><Input value={p.coordonnees_bancaires || ''} onChange={set('coordonnees_bancaires')} /></Field>
            <Field label="TVA (%)" hint="0 si vous n'êtes pas assujetti."><Input numeric inputMode="decimal" value={p.taux_tva ?? 0} onChange={set('taux_tva')} suffix="%" /></Field>
            <Field label="Préfixe des numéros" hint="ex : PI-2026-00001"><Input value={p.prefixe_facture || ''} onChange={set('prefixe_facture')} maxLength={6} /></Field>
          </div>
          <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
        </form>
      </Panel>

      <Panel title="Période d'essai gratuit">
        <form onSubmit={e => { e.preventDefault(); const j = nombre(p.essai_jours); if (j === null || j < 0 || j > 365) { setErr('Durée d\'essai invalide (0 à 365 jours).'); return } enregistrer({ essai_jours: Math.round(j), essai_formule: p.essai_formule || null, suspendre_fin_essai: p.suspendre_fin_essai !== false }, 'Réglages de l\'essai enregistrés.') }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={grille}>
            <Field label="Durée de l'essai" hint="0 pour ne pas proposer d'essai."><Input numeric inputMode="numeric" suffix="jours" value={p.essai_jours ?? 30} onChange={set('essai_jours')} /></Field>
            <Field label="Fonctions pendant l'essai" hint="Ce que le client peut utiliser avant de payer.">
              <Select value={p.essai_formule || ''} onChange={set('essai_formule')} style={{ width: '100%' }}
                options={[{ value: '', label: 'Celles de l\'offre choisie' }, ...formules.map(f => ({ value: f.key, label: `Celles de l'offre ${f.label}` }))]} />
            </Field>
          </div>
          <Checkbox checked={p.suspendre_fin_essai !== false} onChange={v => setP({ ...p, suspendre_fin_essai: v })} label="Bloquer l'accès automatiquement à la fin de l'essai" />
          <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
            Sans blocage automatique, le client garde son accès et apparaît « Essai terminé » dans la supervision. La durée s'applique aux prochains clients créés ; la date d'un essai en cours se modifie dans la fiche du client.
          </p>
          <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
        </form>
      </Panel>

      <Panel title="Site vitrine" meta="pumpits.fr">
        <form onSubmit={e => { e.preventDefault(); enregistrerVitrine({
          raison_sociale: vide(vc.raison_sociale), forme_juridique: vide(vc.forme_juridique), capital_social: vide(vc.capital_social),
          siege_social: vide(vc.siege_social), rccm_siret: vide(vc.rccm_siret), tva_intracom: vide(vc.tva_intracom),
          directeur_publication: vide(vc.directeur_publication), email_contact: vide(vc.email_contact),
          telephone_contact: vide(vc.telephone_contact), whatsapp_contact: vide(vc.whatsapp_contact),
          duree_conservation_demo: vide(vc.duree_conservation_demo),
        }, 'Informations légales enregistrées.') }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <p style={{ font: '400 13px/1.45 var(--font-ui)', color: 'var(--text-muted)', margin: 0 }}>
            Affiché sur les mentions légales, la politique de confidentialité et le pied de page du site vitrine — tant qu'un champ est vide, le site affiche « à compléter ».
          </p>
          <div style={grille}>
            <Field label="Raison sociale"><Input value={vc.raison_sociale || ''} onChange={set2('raison_sociale')} /></Field>
            <Field label="Forme juridique"><Input value={vc.forme_juridique || ''} onChange={set2('forme_juridique')} /></Field>
            <Field label="Capital social"><Input value={vc.capital_social || ''} onChange={set2('capital_social')} /></Field>
            <Field label="Siège social"><Input value={vc.siege_social || ''} onChange={set2('siege_social')} /></Field>
            <Field label="RCCM / SIRET"><Input value={vc.rccm_siret || ''} onChange={set2('rccm_siret')} /></Field>
            <Field label="TVA intracommunautaire" hint="Laisser vide si non applicable."><Input value={vc.tva_intracom || ''} onChange={set2('tva_intracom')} /></Field>
            <Field label="Directeur de la publication"><Input value={vc.directeur_publication || ''} onChange={set2('directeur_publication')} /></Field>
            <Field label="E-mail de contact (public)"><Input type="email" value={vc.email_contact || ''} onChange={set2('email_contact')} /></Field>
            <Field label="Téléphone de contact (public)"><Input type="tel" value={vc.telephone_contact || ''} onChange={set2('telephone_contact')} /></Field>
            <Field label="WhatsApp (public)"><Input type="tel" value={vc.whatsapp_contact || ''} onChange={set2('whatsapp_contact')} /></Field>
            <Field label="Durée de conservation (demandes de démo)" hint="ex : 12 mois"><Input value={vc.duree_conservation_demo || ''} onChange={set2('duree_conservation_demo')} /></Field>
          </div>
          <Button type="submit" tone="dark" style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
        </form>

        <div style={{ height: 1, background: 'var(--border-default)', margin: 'var(--sp-5) 0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <span style={{ font: 'var(--fw-semibold) 14px/1.3 var(--font-ui)' }}>Photos du site</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-5)' }}>
            <PhotoField label="Hero (page d'accueil)" busy={vcPhotoBusy === 'photo_hero'} url={vitrinePhotoUrl(vc.photo_hero)}
              onChange={f => uploadVitrinePhoto('photo_hero', 'hero', f)} />
            <PhotoField label="Saisie du jour / Démarrer" busy={vcPhotoBusy === 'photo_pompe'} url={vitrinePhotoUrl(vc.photo_pompe)}
              onChange={f => uploadVitrinePhoto('photo_pompe', 'pompe', f)} />
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border-default)', margin: 'var(--sp-5) 0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
          <span style={{ font: 'var(--fw-semibold) 14px/1.3 var(--font-ui)' }}>Témoignages (« Ils nous font confiance »)</span>
          {[1, 2].map(n => (
            <form key={n} onSubmit={e => { e.preventDefault(); enregistrerVitrine({
              [`avis${n}_citation`]: vide(vc[`avis${n}_citation`]), [`avis${n}_nom`]: vide(vc[`avis${n}_nom`]), [`avis${n}_role`]: vide(vc[`avis${n}_role`]),
            }, `Témoignage ${n} enregistré.`) }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)' }}>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <PhotoField label={`Photo témoignage ${n}`} round busy={vcPhotoBusy === `avis${n}_photo`} url={vitrinePhotoUrl(vc[`avis${n}_photo`])}
                  onChange={f => uploadVitrinePhoto(`avis${n}_photo`, `avis${n}`, f)} />
                <Field label="Nom affiché" style={{ flex: '1 1 160px' }}><Input value={vc[`avis${n}_nom`] || ''} onChange={set2(`avis${n}_nom`)} placeholder="Prénom Nom" /></Field>
                <Field label="Rôle affiché" style={{ flex: '1 1 160px' }}><Input value={vc[`avis${n}_role`] || ''} onChange={set2(`avis${n}_role`)} placeholder="ex : Propriétaire · Station 1" /></Field>
              </div>
              <Field label="Citation"><Input value={vc[`avis${n}_citation`] || ''} onChange={set2(`avis${n}_citation`)} placeholder="Ce que PumpIT a changé dans le suivi de sa station…" /></Field>
              <Button type="submit" size="sm" style={{ alignSelf: 'flex-start' }}>Enregistrer ce témoignage</Button>
            </form>
          ))}
        </div>
      </Panel>
    </div>
  )
}

// Aperçu + sélecteur de fichier pour une photo du site vitrine — upload immédiat (pas de
// brouillon à enregistrer séparément), même logique que les justificatifs/bordereaux ailleurs.
function PhotoField({ label, url, busy, round, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      <span style={{ font: '500 13px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        {url && <img src={url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: round ? 999 : 'var(--radius-1)', border: '1px solid var(--border-hairline)' }} />}
        <Input type="file" accept="image/*" disabled={busy}
          onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) onChange(f) }} />
      </div>
      {busy && <span style={{ font: '400 12px/1.3 var(--font-ui)', color: 'var(--text-muted)' }}>Envoi…</span>}
    </div>
  )
}
