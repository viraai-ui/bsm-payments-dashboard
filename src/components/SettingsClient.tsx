'use client'

import { useEffect, useRef, useState } from 'react'
import type { AppRole, Permission, RolePermissions, SafeUser } from '@/lib/auth'

const ROLES: AppRole[] = ['Salesperson', 'Accounts', 'Admin', 'Viewer']
const LABELS: Record<Permission, string> = {
  'payments.view': 'View all, pending and unauthorised payments',
  'payments.createLinked': 'Add linked sales-order payments',
  'payments.createUnauthorised': 'Add unauthorised payments',
  'payments.approve': 'Mark receipts received or pending',
  'payments.claim': 'Claim unauthorised receipts',
  'payments.edit': 'Edit authorised payments',
  'payments.delete': 'Delete authorised payments',
  'users.manage': 'Manage users',
  'roles.manage': 'View role permission matrix',
}
const ROLE_COPY: Record<AppRole, string> = {
  Salesperson: 'Creates and tracks linked customer payments.',
  Accounts: 'Reviews receipts and manages payment status.',
  Admin: 'Full payment, user and administration access.',
  Viewer: 'Read-only access to the complete payments dashboard.',
}
type Draft = { id: string; name: string; email: string; username: string; role: AppRole; active: boolean; password: string }
type Tab = 'users' | 'roles'

export function SettingsClient() {
  const [users, setUsers] = useState<SafeUser[]>([])
  const [permissions, setPermissions] = useState<RolePermissions | null>(null)
  const [currentUserId, setCurrentUserId] = useState('')
  const [tab, setTab] = useState<Tab>('users')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const response = await fetch('/api/admin/users', { cache: 'no-store' })
    const json = await response.json().catch(() => ({}))
    if (response.ok) {
      setUsers(json.data.users)
      setPermissions(json.data.permissions)
      setCurrentUserId(json.data.currentUserId)
      setError('')
    } else setError(json.error || 'Could not load settings')
  }
  useEffect(() => { void load() }, [])

  async function request(url: string, options: RequestInit) {
    setError(''); setNotice(''); setBusy(true)
    try {
      const response = await fetch(url, options)
      const json = await response.json().catch(() => ({}))
      if (!response.ok) { setError(json.error || 'Request failed'); return false }
      setNotice('Changes saved successfully.')
      await load()
      return true
    } finally { setBusy(false) }
  }
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = Object.fromEntries(new FormData(event.currentTarget))
    if (await request('/api/admin/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) setAdding(false)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editing) return
    if (await request('/api/admin/users', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(editing) })) setEditing(null)
  }
  async function remove(user: Pick<SafeUser, 'id' | 'name'>) {
    if (!confirm(`Permanently delete ${user.name}? This cannot be undone.`)) return
    if (await request(`/api/admin/users?id=${encodeURIComponent(user.id)}`, { method: 'DELETE' })) setEditing(null)
  }

  const activeCount = users.filter(user => user.active).length
  return <section className="settings-page">
    <header className="settings-hero">
      <div><p className="eyebrow">Administration</p><h1>Settings</h1><p>Manage people and understand access across your workspace.</p></div>
    </header>

    <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
      <button id="settings-users-tab" role="tab" aria-selected={tab === 'users'} aria-controls="settings-users-panel" className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}><PeopleIcon />User Management</button>
      <button id="settings-roles-tab" role="tab" aria-selected={tab === 'roles'} aria-controls="settings-roles-panel" className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}><ShieldIcon />Role Management</button>
    </nav>

    {error && <div className="form-error settings-message" role="alert">{error}</div>}
    {notice && <div className="form-success settings-message" role="status">{notice}</div>}

    {tab === 'users' ? <div id="settings-users-panel" role="tabpanel" aria-labelledby="settings-users-tab" className="settings-panel">
      <div className="settings-section-head">
        <div><h2>User Management</h2><p>Invite and maintain access for your team.</p></div>
        <button className="btn red settings-primary" onClick={() => setAdding(true)}><PlusIcon />Add User</button>
      </div>
      <div className="settings-stats" aria-label="User summary">
        <div><strong>{users.length}</strong><span>Total users</span></div>
        <div><strong>{activeCount}</strong><span>Active</span></div>
        <div><strong>{users.length - activeCount}</strong><span>Inactive</span></div>
      </div>
      <div className="settings-list-card notification-settings-card"><div className="settings-list-head"><div><h3>Device notifications</h3><p>If notifications are blocked, allow this site in browser or device settings, then return here.</p></div><button className="btn" type="button" onClick={() => window.dispatchEvent(new Event('payment-notifications:settings'))}>Notification settings</button></div></div>
      <div className="settings-list-card">
        <div className="settings-list-head"><h3>Workspace users</h3><span>{users.length} {users.length === 1 ? 'person' : 'people'}</span></div>
        <div className="settings-user-table-wrap">
          <table className="settings-user-table"><thead><tr><th>User</th><th>Username</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{users.map(user => <tr key={user.id}>
              <td><div className="settings-identity"><span className="settings-avatar" aria-hidden="true">{initials(user.name)}</span><div><strong>{user.name}{user.id === currentUserId && <em>You</em>}</strong><span>{user.email}</span></div></div></td>
              <td data-label="Username"><span className="settings-username">@{user.username}</span></td>
              <td data-label="Role"><span className={`settings-role ${user.role.toLowerCase()}`}>{user.role}</span></td>
              <td data-label="Status"><span className={`settings-status ${user.active ? 'active' : 'inactive'}`}><i />{user.active ? 'Active' : 'Inactive'}</span></td>
              <td><button className="settings-edit" onClick={() => setEditing({ ...user, password: '' })} aria-label={`Edit ${user.name}`}>Edit</button></td>
            </tr>)}</tbody>
          </table>
          {!users.length && <div className="settings-empty">No users have been added yet.</div>}
        </div>
      </div>
    </div> : <div id="settings-roles-panel" role="tabpanel" aria-labelledby="settings-roles-tab" className="settings-panel">
      <div className="settings-section-head"><div><h2>Role Management</h2><p>Review the fixed access levels enforced by your workflow.</p></div><span className="settings-fixed"><LockIcon />Permissions are fixed</span></div>
      <div className="role-summary-grid">{ROLES.map(role => <article key={role} className="role-summary"><div className={`role-icon ${role.toLowerCase()}`}><ShieldIcon /></div><div><h3>{role}</h3><p>{ROLE_COPY[role]}</p><span>{permissions?.[role].length ?? 0} permissions</span></div></article>)}</div>
      {permissions && <div className="settings-list-card role-matrix-card"><div className="settings-list-head"><div><h3>Permission matrix</h3><p>Access is configured on the server and cannot be edited here.</p></div></div><div className="permission-matrix"><table><thead><tr><th>Permission</th>{ROLES.map(role => <th key={role}>{role}</th>)}</tr></thead><tbody>{Object.entries(LABELS).map(([permission, label]) => <tr key={permission}><td>{label}</td>{ROLES.map(role => { const allowed = permissions[role].includes(permission as Permission); return <td key={role} aria-label={`${role}: ${allowed ? 'allowed' : 'not allowed'}`}><span className={allowed ? 'permission-yes' : 'permission-no'} aria-hidden="true">{allowed ? '✓' : '—'}</span></td> })}</tr>)}</tbody></table></div></div>}
    </div>}

    {adding && <UserModal title="Add user" description="Create credentials and assign workspace access." close={() => setAdding(false)}>
      <form className="settings-form" onSubmit={add}><div className="settings-form-grid"><label>Name<input name="name" autoFocus required autoComplete="name" /></label><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Username<input name="username" required autoComplete="username" /></label><label>Initial password<input name="password" type="password" minLength={8} required autoComplete="new-password" /><small>At least 8 characters</small></label><label className="settings-form-wide">Role<select name="role">{ROLES.map(role => <option key={role}>{role}</option>)}</select></label></div><div className="settings-modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn red" disabled={busy}>{busy ? 'Adding…' : 'Add user'}</button></div></form>
    </UserModal>}

    {editing && <UserModal title="Edit user" description={`Update ${editing.name}'s account and access.`} close={() => setEditing(null)}>
      <form className="settings-form" onSubmit={save}><div className="settings-form-grid"><label>Name<input autoFocus required value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label><label>Email<input required type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} /></label><label>Username<input required value={editing.username} onChange={e => setEditing({ ...editing, username: e.target.value })} /></label><label>Role<select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as AppRole })}>{ROLES.map(role => <option key={role}>{role}</option>)}</select></label><label className="settings-form-wide">Reset password <span>(optional)</span><input type="password" minLength={8} placeholder="Leave blank to keep current password" autoComplete="new-password" value={editing.password} onChange={e => setEditing({ ...editing, password: e.target.value })} /></label></div>
        <label className={`settings-toggle-row ${editing.id === currentUserId ? 'locked' : ''}`}><span><strong>Active account</strong><small>Inactive users cannot sign in.</small></span><input type="checkbox" checked={editing.active} disabled={editing.id === currentUserId} onChange={e => setEditing({ ...editing, active: e.target.checked })} /><i aria-hidden="true" /></label>
        <div className="settings-danger"><div><strong>Delete user</strong><span>Permanently remove this account and its access.</span></div><button type="button" onClick={() => void remove(editing)} disabled={editing.id === currentUserId || busy}>Delete</button></div>
        <div className="settings-modal-actions"><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn red" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      </form>
    </UserModal>}
  </section>
}

function UserModal({ title, description, close, children }: { title: string; description: string; close: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [close])
  return <div className="settings-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><section ref={panel} className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title"><header><div><h2 id="settings-modal-title">{title}</h2><p>{description}</p></div><button type="button" onClick={close} aria-label="Close dialog">×</button></header>{children}</section></div>
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?' }
function PeopleIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg> }
function ShieldIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg> }
function PlusIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> }
function LockIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> }
