import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { Panel } from '../ds/pumpit/components/core/Panel.jsx'
import { Button } from '../ds/pumpit/components/core/Button.jsx'
import { Field } from '../ds/pumpit/components/forms/Field.jsx'
import { Input } from '../ds/pumpit/components/forms/Input.jsx'
import { Select } from '../ds/pumpit/components/forms/Select.jsx'
import { Checkbox } from '../ds/pumpit/components/forms/Checkbox.jsx'
import { AlertBanner } from '../ds/pumpit/components/feedback/AlertBanner.jsx'
import { Badge } from '../ds/pumpit/components/core/Badge.jsx'
import { DataTable } from '../ds/pumpit/components/data/DataTable.jsx'
import { Tabs } from '../ds/pumpit/components/navigation/Tabs.jsx'

// Rôles historiques : une seule station (profiles.station_id), non modifiables/supprimables
// (gelés par trigger côté base — voir migration_v65). Tout autre rôle (directeur/comptable,
// ou un rôle créé ici) est rattachable à plusieurs stations via profile_stations.
const SINGLE_STATION_ROLES = ['gerant', 'pompiste', 'vendeuse', 'admin']

const groupBy = (rows, key) => rows.reduce((m, r) => { (m[r[key] || '—'] = m[r[key] || '—'] || []).push(r); return m }, {})

export default function Stations() {
  const { isAdmin, can, session, isPlatformAdmin } = useAuth()
  const [stations, setStations] = useState([])
  const [users, setUsers] = useState([])
  const [settings, setSettings] = useState(null)
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [rolePerms, setRolePerms] = useState([])
  const [profileStations, setProfileStations] = useState({})   // {profileId: [stationId,...]}
  const [formules, setFormules] = useState([])   // offres — pour la limite max_utilisateurs_station
  const [expenseCats, setExpenseCats] = useState([])
  const [newExpCat, setNewExpCat] = useState({ key: '', label: '', non_cash: false })
  const [selectedRole, setSelectedRole] = useState(null)
  const [newRole, setNewRole] = useState({ key: '', label: '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [newName, setNewName] = useState('')
  // Onglets visibles selon les permissions du profil courant — Rôles/Paramètres restent
  // strictement admin, Stations/Équipe deviennent délégables via manage_stations_config/manage_team.
  const TABS = [
    (isAdmin || can('manage_stations_config')) && { value: 'stations', label: 'Stations' },
    (isAdmin || can('manage_team')) && { value: 'equipe', label: 'Équipe' },
    // Rôles et permissions sont communs à tous les clients : seul l'administrateur de la plateforme les modifie.
    isPlatformAdmin && { value: 'roles', label: 'Rôles' },
    isAdmin && { value: 'parametres', label: 'Paramètres' },
  ].filter(Boolean)
  const [tab, setTab] = useState(() => TABS[0]?.value || 'stations')

  async function load() {
    const [s, u, st, r, p, rp, ps, ec, fo] = await Promise.all([
      supabase.from('stations').select('*').order('id'),
      supabase.from('profiles').select('id, full_name, role, station_id, approved').order('full_name'),
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('roles').select('*').order('created_at'),
      supabase.from('permissions').select('*').order('category').order('label'),
      supabase.from('role_permissions').select('*'),
      supabase.from('profile_stations').select('*'),
      supabase.from('expense_categories').select('*').order('ordre'),
      supabase.from('formules').select('key, label, max_utilisateurs_station'),
    ])
    setStations(s.data || []); setUsers(u.data || []); setSettings(st.data || null)
    setRoles(r.data || []); setPermissions(p.data || []); setRolePerms(rp.data || [])
    const psm = {}; for (const x of (ps.data || [])) (psm[x.profile_id] = psm[x.profile_id] || []).push(x.station_id)
    setProfileStations(psm)
    setExpenseCats(ec.data || [])
    setFormules(fo.data || [])
    setSelectedRole(prev => prev || (r.data || [])[0]?.key || null)
  }
  useEffect(() => { load() }, [])

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500) }
  const fail = (e) => { setErr(e.message || String(e)) }

  async function saveStation(s) {
    const { error } = await supabase.from('stations').update({
      nom: s.nom, compte_bancaire: s.compte_bancaire,
      seuil_essence: num(s.seuil_essence), seuil_gasoil: num(s.seuil_gasoil),
      seuil_gaz: num(s.seuil_gaz), seuil_lubrifiant: num(s.seuil_lubrifiant),
      capacite_essence: num(s.capacite_essence) ?? 20000, capacite_gasoil: num(s.capacite_gasoil) ?? 20000,
      nombre_machines: Math.min(10, Math.max(1, num(s.nombre_machines) ?? 4)),
      suivi_lub_gaz: s.suivi_lub_gaz || 'les_deux',
    }).eq('id', s.id)
    error ? fail(error) : flash('Station enregistrée')
  }
  async function addStation(e) {
    e.preventDefault(); if (!newName) return
    const { error } = await supabase.from('stations').insert({ nom: newName })
    if (error) fail(error); else { setNewName(''); load(); flash('Station ajoutée') }
  }
  // Limite d'utilisateurs par station, réglée par l'admin de la plateforme offre par offre
  // (Back-office → Offres → "Nombre max. d'utilisateurs par station", voir migration_v104).
  // null = illimité.
  const stationUserLimit = (stationId) => {
    const st = stations.find(s => s.id === stationId)
    return formules.find(f => f.key === st?.formule)?.max_utilisateurs_station ?? null
  }
  const usersAtStation = (stationId, excludeId) => users.filter(u2 => u2.id !== excludeId && u2.approved && (
    SINGLE_STATION_ROLES.includes(u2.role) ? u2.station_id === stationId : (profileStations[u2.id] || []).includes(stationId)
  )).length
  async function saveUser(u, { approve } = {}) {
    const isMulti = !SINGLE_STATION_ROLES.includes(u.role)
    if (approve) {
      const hasStation = isMulti ? (profileStations[u.id] || []).length > 0 : !!u.station_id
      if (!hasStation) { setErr('Attribue une station avant de valider ce compte.'); return }
    }
    const targetStations = isMulti ? (profileStations[u.id] || []) : (u.station_id ? [Number(u.station_id)] : [])
    for (const sid of targetStations) {
      const limit = stationUserLimit(sid)
      if (limit != null && usersAtStation(sid, u.id) + 1 > limit) {
        const st = stations.find(s => s.id === sid)
        setErr(`« ${st?.nom || sid} » a déjà atteint son maximum de ${limit} utilisateur(s) pour son offre actuelle. Change l'offre de la station, ou retire un autre compte avant d'en ajouter un nouveau.`)
        return
      }
    }
    const patch = { role: u.role, station_id: isMulti ? null : (u.station_id ? Number(u.station_id) : null) }
    if (approve) patch.approved = true
    const { error } = await supabase.from('profiles').update(patch).eq('id', u.id)
    if (error) { fail(error); return }
    if (isMulti) {
      const selected = profileStations[u.id] || []
      await supabase.from('profile_stations').delete().eq('profile_id', u.id)
      if (selected.length) await supabase.from('profile_stations').insert(selected.map(sid => ({ profile_id: u.id, station_id: sid })))
    }
    flash(approve ? 'Compte validé' : 'Membre mis à jour'); load()
  }
  // Retire l'accès à l'application (supprime la ligne profil) — ne supprime PAS le compte
  // email/mot de passe côté Supabase Auth (nécessiterait une clé service_role). Si ce compte
  // a déjà des données liées (saisies, dépenses...), la suppression est bloquée par
  // l'intégrité référentielle (created_by) : on retire l'accès à la place, sans perdre
  // l'historique — plutôt qu'un échec sans solution pour l'admin.
  async function deleteUser(u) {
    const { error } = await supabase.from('profiles').delete().eq('id', u.id)
    if (error) {
      if (error.code === '23503') {
        const { error: e2 } = await supabase.from('profiles').update({ approved: false }).eq('id', u.id)
        if (e2) { fail(e2); return }
        flash('Ce compte a des données liées (saisies…) — suppression impossible, accès retiré à la place')
        load(); return
      }
      fail(error); return
    }
    flash('Compte supprimé — accès à l\'application retiré'); load()
  }
  // Désactivation : pour l'équipe déjà active, qui a presque toujours des données liées
  // (saisies, dépenses…) — une vraie suppression échouerait donc systématiquement. Retire
  // l'accès directement (repasse par "en attente de validation", réactivable via Valider),
  // sans même tenter une suppression qui échouerait.
  async function disableUser(u) {
    const { error } = await supabase.from('profiles').update({ approved: false }).eq('id', u.id)
    if (error) { fail(error); return }
    flash('Compte désactivé — accès à l\'application retiré'); load()
  }
  function toggleUserStation(userId, stationId, checked) {
    setProfileStations(p => {
      const cur = p[userId] || []
      return { ...p, [userId]: checked ? [...cur, stationId] : cur.filter(id => id !== stationId) }
    })
  }

  async function addRole(e) {
    e.preventDefault()
    const key = (newRole.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
    if (!key || !newRole.label.trim()) { setErr('Renseignez une clé et un libellé.'); return }
    const { error } = await supabase.from('roles').insert({ key, label: newRole.label.trim(), is_system: false })
    if (error) fail(error); else { setNewRole({ key: '', label: '' }); setSelectedRole(key); load(); flash('Rôle créé') }
  }
  async function deleteRole(r) {
    const { error } = await supabase.from('roles').delete().eq('key', r.key)
    if (error) fail(error); else { if (selectedRole === r.key) setSelectedRole(null); load(); flash('Rôle supprimé') }
  }
  const hasPerm = (roleKey, permKey) => rolePerms.some(rp => rp.role_key === roleKey && rp.permission_key === permKey)
  async function togglePerm(roleKey, permKey, checked) {
    const { error } = checked
      ? await supabase.from('role_permissions').insert({ role_key: roleKey, permission_key: permKey })
      : await supabase.from('role_permissions').delete().eq('role_key', roleKey).eq('permission_key', permKey)
    error ? fail(error) : load()
  }
  async function savePrices(e) {
    e.preventDefault()
    const { error } = await supabase.from('settings').update({
      essence_pv: num(settings.essence_pv), gasoil_pv: num(settings.gasoil_pv), marge_unitaire: num(settings.marge_unitaire),
      essence_pa: num(settings.essence_pa), gasoil_pa: num(settings.gasoil_pa),
      taux_gaz: num(settings.taux_gaz), taux_superette: num(settings.taux_superette),
      seuil_rupture: num(settings.seuil_rupture),
      bons_utilisables_commande: !!settings.bons_utilisables_commande,
      pompe_inactive_apres: num(settings.pompe_inactive_apres) ?? 5,
      jours_correction_gerant: Math.max(0, num(settings.jours_correction_gerant) ?? 2),
      deconnexion_auto_heures: Math.max(1, num(settings.deconnexion_auto_heures) ?? 24),
      photo_obligatoire: !!settings.photo_obligatoire,
    }).eq('id', 1)
    error ? fail(error) : flash('Prix enregistrés')
  }

  async function addExpCat(e) {
    e.preventDefault()
    const key = (newExpCat.key || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    if (!key || !newExpCat.label.trim()) { setErr('Renseignez une clé et un libellé.'); return }
    const { error } = await supabase.from('expense_categories').insert({ key, label: newExpCat.label.trim(), non_cash: !!newExpCat.non_cash, is_system: false })
    if (error) fail(error); else { setNewExpCat({ key: '', label: '', non_cash: false }); load(); flash('Catégorie de dépense créée') }
  }
  async function toggleExpCatActif(c, actif) {
    const { error } = await supabase.from('expense_categories').update({ actif }).eq('id', c.id)
    error ? fail(error) : load()
  }
  async function deleteExpCat(c) {
    const { error } = await supabase.from('expense_categories').delete().eq('id', c.id)
    error ? fail(error) : (load(), flash('Catégorie supprimée'))
  }

  const upS = (id, k, v) => setStations(p => p.map(s => s.id === id ? { ...s, [k]: v } : s))
  const upU = (id, k, v) => setUsers(p => p.map(u => u.id === id ? { ...u, [k]: v } : u))

  const stationOptions = [{ value: '', label: '— toutes / aucune —' }, ...stations.map(s => ({ value: s.id, label: s.nom }))]

  const stationCols = [
    { key: 'full_name', header: 'Nom' },
    { key: 'role', header: 'Rôle', render: u => <Select size="sm" value={u.role} onChange={e => upU(u.id, 'role', e.target.value)} options={roles.map(r => ({ value: r.key, label: r.label }))} style={{ width: '100%' }} /> },
    { key: 'station_id', header: 'Station(s)', render: u => SINGLE_STATION_ROLES.includes(u.role)
      ? <Select size="sm" value={u.station_id || ''} onChange={e => upU(u.id, 'station_id', e.target.value)} options={stationOptions} style={{ width: '100%' }} />
      : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
          {stations.map(s => (
            <Checkbox key={s.id} label={s.nom} checked={(profileStations[u.id] || []).includes(s.id)}
              onChange={v => toggleUserStation(u.id, s.id, v)} />
          ))}
        </div> },
  ]
  const pendingColumns = [
    ...stationCols,
    { key: 'actions', header: '', align: 'right', render: u => (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <Button size="sm" tone="dark" onClick={() => saveUser(u, { approve: true })}>Valider</Button>
        <Button size="sm" tone="danger" onClick={() => deleteUser(u)}>Supprimer</Button>
      </div>
    ) },
  ]
  const userColumns = [
    ...stationCols,
    { key: 'actions', header: '', align: 'right', render: u => (
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <Button size="sm" tone="dark" onClick={() => saveUser(u)}>OK</Button>
        <Button size="sm" tone="danger" disabled={u.id === session?.user?.id} title={u.id === session?.user?.id ? 'Vous ne pouvez pas désactiver votre propre compte' : undefined} onClick={() => disableUser(u)}>Désactiver</Button>
      </div>
    ) },
  ]
  const pendingUsers = users.filter(u => !u.approved)
  const activeUsers = users.filter(u => u.approved)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      {msg && <AlertBanner tone="ok" title="Succès">{msg}</AlertBanner>}
      {err && <AlertBanner tone="alarm" title="Erreur">{err}</AlertBanner>}

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'stations' && (
      <Panel title="Stations">
        <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
          Nom, compte bancaire et seuils d'alerte de stock bas (en litres).
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {stations.map(s => (
            <div key={s.id} style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Nom" style={{ flex: '1 1 160px' }}><Input value={s.nom || ''} onChange={e => upS(s.id, 'nom', e.target.value)} /></Field>
                <Field label="Compte bancaire" style={{ flex: '1 1 160px' }}><Input value={s.compte_bancaire || ''} onChange={e => upS(s.id, 'compte_bancaire', e.target.value)} /></Field>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Seuil essence (L)" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={s.seuil_essence ?? ''} onChange={e => upS(s.id, 'seuil_essence', e.target.value)} /></Field>
                <Field label="Seuil gasoil (L)" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={s.seuil_gasoil ?? ''} onChange={e => upS(s.id, 'seuil_gasoil', e.target.value)} /></Field>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Seuil gaz (bouteilles/type)" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={s.seuil_gaz ?? ''} onChange={e => upS(s.id, 'seuil_gaz', e.target.value)} /></Field>
                <Field label="Seuil lubrifiant (unités)" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={s.seuil_lubrifiant ?? ''} onChange={e => upS(s.id, 'seuil_lubrifiant', e.target.value)} /></Field>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Capacité cuve essence (L)" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={s.capacite_essence ?? 20000} onChange={e => upS(s.id, 'capacite_essence', e.target.value)} /></Field>
                <Field label="Capacité cuve gasoil (L)" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={s.capacite_gasoil ?? 20000} onChange={e => upS(s.id, 'capacite_gasoil', e.target.value)} /></Field>
                <Field label="Nombre de machines" hint="1 à 10 — chaque machine a une pompe essence + une gasoil" style={{ flex: '1 1 140px' }}>
                  <Input type="number" numeric min={1} max={10} value={s.nombre_machines ?? 4} onChange={e => upS(s.id, 'nombre_machines', e.target.value)} />
                </Field>
              </div>
              <Field label="Gaz &amp; lubrifiant — ce que le gérant déclare" hint="Stock (matin, anti-coulage) / Vendu (16h, commission réelle) / les deux (défaut)" style={{ maxWidth: 280 }}>
                <Select value={s.suivi_lub_gaz || 'les_deux'} onChange={e => upS(s.id, 'suivi_lub_gaz', e.target.value)} style={{ width: '100%' }}
                  options={[{ value: 'les_deux', label: 'Stock + Vendu (défaut)' }, { value: 'stock', label: 'Stock seul' }, { value: 'vendu', label: 'Vendu seul' }]} />
              </Field>
              <Button tone="primary" onClick={() => saveStation(s)} style={{ alignSelf: 'flex-start' }}>Enregistrer</Button>
            </div>
          ))}
        </div>
        <form onSubmit={addStation} style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nouvelle station…" style={{ flex: 1 }} />
          <Button type="submit" tone="primary">+ Ajouter</Button>
        </form>
      </Panel>
      )}

      {tab === 'equipe' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
        {pendingUsers.length > 0 && (
          <Panel title="Comptes en attente de validation" meta={`${pendingUsers.length}`} status="alarm" flush>
            <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
              Nouvelles inscriptions ou comptes désactivés — sans accès tant qu'ils ne sont pas
              validés. Choisissez le rôle et attribuez une station, puis cliquez sur « Valider » — ou
              « Supprimer » pour un compte de test (fonctionne seulement s'il n'a encore aucune
              donnée liée ; sinon son accès est simplement retiré, comme un compte désactivé).
            </p>
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <DataTable columns={pendingColumns} rows={pendingUsers} />
            </div>
          </Panel>
        )}
        <Panel title="Équipe" meta={`${activeUsers.length}`} flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            Gérant/pompiste/vendeuse/admin : rattachés à une seule station. Tout autre rôle
            (directeur, comptable, ou un rôle créé dans l'onglet Rôles) peut être rattaché à
            une ou plusieurs stations — coche celles concernées puis « OK ».
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <DataTable columns={userColumns} rows={activeUsers} />
          </div>
        </Panel>
      </div>
      )}

      {tab === 'roles' && (
      <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Panel title="Rôles" flush style={{ flex: '1 1 260px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {roles.map(r => (
              <div key={r.key} onClick={() => setSelectedRole(r.key)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-3) var(--gutter-panel)', cursor: 'pointer',
                  background: selectedRole === r.key ? 'var(--accent-quiet)' : 'transparent', borderBottom: '1px solid var(--border-hairline)' }}>
                <span style={{ font: '400 15px/1.3 var(--font-ui)', color: 'var(--text-body)' }}>
                  {r.label}
                  {r.is_system && <span style={{ marginLeft: 6, color: 'var(--text-muted)', font: '400 12px/1.25 var(--font-ui)' }}>(système)</span>}
                </span>
                {!r.is_system && (
                  <Button size="sm" tone="danger" onClick={(e) => { e.stopPropagation(); deleteRole(r) }}
                    disabled={users.some(u => u.role === r.key)}
                    title={users.some(u => u.role === r.key) ? 'Encore assigné à un compte' : undefined}>Suppr.</Button>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={addRole} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--gutter-panel)', borderTop: '1px solid var(--border-hairline)' }}>
            <Field label="Nouveau rôle — clé (unique, jamais modifiable ensuite)">
              <Input value={newRole.key} onChange={e => setNewRole({ ...newRole, key: e.target.value })} placeholder="ex : responsable_achats" />
            </Field>
            <Field label="Libellé">
              <Input value={newRole.label} onChange={e => setNewRole({ ...newRole, label: e.target.value })} placeholder="ex : Responsable achats" />
            </Field>
            <Button type="submit" tone="dark" size="sm">+ Créer le rôle</Button>
          </form>
        </Panel>

        <Panel title={selectedRole ? `Permissions — ${roles.find(r => r.key === selectedRole)?.label || selectedRole}` : 'Permissions'} flush style={{ flex: '2 1 360px' }}>
          {!selectedRole ? (
            <p style={{ padding: 'var(--gutter-panel)', font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Choisissez un rôle à gauche.</p>
          ) : selectedRole === 'admin' ? (
            <div style={{ padding: 'var(--gutter-panel)' }}>
              <AlertBanner tone="info" title="Administrateur">L'admin a toujours accès à tout, indépendamment de cette matrice — rien à cocher ici.</AlertBanner>
            </div>
          ) : (
            <div style={{ padding: 'var(--gutter-panel)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              {Object.entries(groupBy(permissions, 'category')).map(([cat, perms]) => (
                <div key={cat}>
                  <div style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>{cat}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                    {perms.map(p => (
                      <Checkbox key={p.key} label={p.label} checked={hasPerm(selectedRole, p.key)} onChange={v => togglePerm(selectedRole, p.key, v)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      )}

      {tab === 'parametres' && settings && (
        <Panel title="Prix & marge">
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
            Prix de vente (pré-remplis dans la saisie), prix d'achat (coût des commandes) et marge, en FCFA/L.
          </p>
          <form onSubmit={savePrices} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
            <FormSection title="Prix de vente">
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Essence" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.essence_pv} onChange={e => setSettings({ ...settings, essence_pv: e.target.value })} /></Field>
                <Field label="Gasoil" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.gasoil_pv} onChange={e => setSettings({ ...settings, gasoil_pv: e.target.value })} /></Field>
                <Field label="Marge (F/L)" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.marge_unitaire} onChange={e => setSettings({ ...settings, marge_unitaire: e.target.value })} /></Field>
              </div>
            </FormSection>
            <FormSection title="Prix d'achat">
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Field label="Essence" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.essence_pa ?? ''} onChange={e => setSettings({ ...settings, essence_pa: e.target.value })} /></Field>
                <Field label="Gasoil" style={{ flex: '1 1 140px' }}><Input type="number" numeric value={settings.gasoil_pa ?? ''} onChange={e => setSettings({ ...settings, gasoil_pa: e.target.value })} /></Field>
              </div>
            </FormSection>
            <FormSection title="Taux de commission supérette (%)">
              <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                Gaz et lubrifiant ne sont plus estimés à un taux fixe : leur commission se
                calcule désormais réellement à partir des prix de vente/d'achat renseignés
                dans Produits et prix et des quantités vendues déclarées chaque jour.
              </p>
              <Field label="Supérette" style={{ maxWidth: 160 }}><Input type="number" numeric value={settings.taux_superette ?? ''} onChange={e => setSettings({ ...settings, taux_superette: e.target.value })} /></Field>
            </FormSection>
            <FormSection title="Seuil de rupture cuve (L)">
              <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                Niveau physique en dessous duquel il n'y a plus de ventes normales (crépine de la pompe). Sert de base aux prédictions (jours d'autonomie, date de rupture, alerte « commander maintenant ») — le stock utile = stock en cuve − ce seuil.
              </p>
              <Field label="Essence + Gasoil" style={{ maxWidth: 160 }}><Input type="number" numeric value={settings.seuil_rupture ?? 250} onChange={e => setSettings({ ...settings, seuil_rupture: e.target.value })} /></Field>
            </FormSection>
            <FormSection title="Photos (compteurs, dépenses, versements)">
              <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                Par défaut, les photos sont recommandées mais n'empêchent jamais l'envoi d'une saisie (le gérant doit pouvoir envoyer ses chiffres même si la prise de photo échoue sur son téléphone). Active cette option pour les rendre obligatoires : la saisie sera bloquée tant que la photo manque.
              </p>
              <Checkbox label="Photo obligatoire (bloquante à l'envoi)" checked={!!settings.photo_obligatoire} onChange={v => setSettings({ ...settings, photo_obligatoire: v })} />
            </FormSection>
            <FormSection title="Financement des commandes">
              <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                Quand les bons seront virés directement en banque, désactive cette option : le formulaire de commande n'affichera plus que le chèque comme mode de paiement (carburant + gaz/lubrifiant).
              </p>
              <Checkbox label="Les bons peuvent financer une commande" checked={settings.bons_utilisables_commande !== false} onChange={v => setSettings({ ...settings, bons_utilisables_commande: v })} />
            </FormSection>
            <FormSection title="Correction des saisies par le gérant">
              <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                Nombre de jours en arrière pendant lesquels le gérant (et la vendeuse) peuvent créer ou corriger le point d'une journée — au-delà, la journée est verrouillée et seul l'admin peut intervenir.
              </p>
              <Field label="N — jours en arrière" style={{ maxWidth: 160 }}>
                <Input type="number" numeric value={settings.jours_correction_gerant ?? 2} onChange={e => setSettings({ ...settings, jours_correction_gerant: e.target.value })} />
              </Field>
            </FormSection>
            <FormSection title="Déconnexion automatique">
              <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                Tout utilisateur est déconnecté automatiquement N heures après sa connexion, même si l'onglet reste ouvert — utile sur les téléphones partagés en station.
              </p>
              <Field label="N — heures" hint="1 jour = 24" style={{ maxWidth: 160 }}>
                <Input type="number" numeric value={settings.deconnexion_auto_heures ?? 24} onChange={e => setSettings({ ...settings, deconnexion_auto_heures: e.target.value })} />
              </Field>
            </FormSection>
            <FormSection title="Détection pompes inactives">
              <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', marginTop: 0 }}>
                Une pompe (E1-E4, G1-G4) est signalée « hors service » dans le Journal de bord si son relevé 16h n'a pas bougé sur les N dernières saisies où elle a été renseignée.
              </p>
              <Field label="N — nombre de saisies" style={{ maxWidth: 160 }}>
                <Input type="number" numeric value={settings.pompe_inactive_apres ?? 5} onChange={e => setSettings({ ...settings, pompe_inactive_apres: e.target.value })} />
              </Field>
            </FormSection>
            <Button type="submit" tone="primary" style={{ alignSelf: 'flex-start' }}>Enregistrer les prix</Button>
          </form>
        </Panel>
      )}

      {tab === 'parametres' && (
        <Panel title="Catégories de dépense" flush>
          <p style={{ font: '400 14px/1.4 var(--font-ui)', color: 'var(--text-muted)', margin: 'var(--sp-4) var(--gutter-panel) 0' }}>
            Liste proposée au gérant dans Saisie du jour → « Dépenses en espèces ». Les catégories système (SBEE, SONEB, SUPERETTE, CARBURANT, AUTRE) ne peuvent pas être supprimées ; tu peux en créer d'autres ou désactiver celles dont tu n'as plus besoin.
          </p>
          <div style={{ margin: 'var(--sp-4) var(--gutter-panel) 0', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {expenseCats.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)' }}>
                <span style={{ flex: 1, font: '400 15px/1.3 var(--font-ui)', color: 'var(--text-body)' }}>
                  {c.label}
                  {c.is_system && <span style={{ marginLeft: 6, color: 'var(--text-muted)', font: '400 12px/1.25 var(--font-ui)' }}>(système)</span>}
                  {c.non_cash && <span style={{ marginLeft: 6, color: 'var(--text-muted)', font: '400 12px/1.25 var(--font-ui)' }}>— non-cash</span>}
                </span>
                <Checkbox label="Actif" checked={c.actif} onChange={v => toggleExpCatActif(c, v)} />
                {!c.is_system && <Button size="sm" tone="danger" onClick={() => deleteExpCat(c)}>Suppr.</Button>}
              </div>
            ))}
          </div>
          <form onSubmit={addExpCat} style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'end', padding: 'var(--gutter-panel)', marginTop: 'var(--sp-4)', borderTop: '1px solid var(--border-hairline)' }}>
            <Field label="Nouvelle catégorie — clé" style={{ flex: '1 1 160px' }}>
              <Input value={newExpCat.key} onChange={e => setNewExpCat({ ...newExpCat, key: e.target.value })} placeholder="ex : TELEPHONE" />
            </Field>
            <Field label="Libellé" style={{ flex: '1 1 200px' }}>
              <Input value={newExpCat.label} onChange={e => setNewExpCat({ ...newExpCat, label: e.target.value })} placeholder="ex : Téléphone / internet" />
            </Field>
            <Checkbox label="Non-cash (pas de justificatif requis)" checked={newExpCat.non_cash} onChange={v => setNewExpCat({ ...newExpCat, non_cash: v })} />
            <Button type="submit" tone="dark" size="sm">+ Créer</Button>
          </form>
        </Panel>
      )}
    </div>
  )
}

function FormSection({ title, children }) {
  return (
    <div style={{ padding: 'var(--sp-4)', background: 'var(--surface-raised)', borderRadius: 'var(--radius-1)', border: '1px solid var(--border-hairline)' }}>
      <div style={{ font: 'var(--fw-semibold) 13px/1.25 var(--font-ui)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>{title}</div>
      {children}
    </div>
  )
}

const num = (v) => (v === '' || v == null || isNaN(v) ? null : Number(v))
