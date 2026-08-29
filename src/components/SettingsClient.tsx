'use client'

import { useEffect, useState } from 'react'
import { useAuth } from './AuthGate'
import type { AppRole, SafeUser } from '@/lib/auth'

const roles: AppRole[] = ['Admin', 'Operations', 'Dispatch', 'Media', 'Database', 'Accounts']
type Draft = { name: string; email: string; username: string; role: AppRole; password: string; active: boolean }
const emptyDraft: Draft = { name: '', email: '', username: '', role: 'Dispatch', password: '', active: true }

export function SettingsClient() {
  const { user, logout } = useAuth()
  const [users, setUsers] = useState<SafeUser[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const admin = user.role === 'Admin'

  useEffect(() => { if (admin) void loadUsers() }, [admin])

  async function loadUsers() {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/users', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load users')
      setUsers(json.users)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load users') }
    finally { setLoading(false) }
  }

  async function addUser() {
    setError(''); setMessage('')
    const response = await fetch('/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
    const json = await response.json()
    if (!response.ok || !json.ok) { setError(json.error || 'Could not create user'); return }
    setMessage('User created securely.'); setDraft(emptyDraft); await loadUsers()
  }

  async function patchUser(id: string, patch: Partial<SafeUser> & { password?: string }) {
    setError(''); setMessage('')
    const response = await fetch('/api/users', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...patch }) })
    const json = await response.json()
    if (!response.ok || !json.ok) { setError(json.error || 'Could not update user'); return }
    setMessage('User updated.'); setPasswords((prev) => ({ ...prev, [id]: '' })); await loadUsers()
  }

  async function deactivateUser(id: string) {
    if (!window.confirm('Deactivate this user? Historical records will be preserved.')) return
    setError(''); setMessage('')
    const response = await fetch(`/api/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const json = await response.json()
    if (!response.ok || !json.ok) { setError(json.error || 'Could not deactivate user'); return }
    setMessage('User deactivated.'); await loadUsers()
  }

  return <>
    <header className="top compact-top"><div><h1 className="h1">Settings</h1></div><button className="btn light" onClick={logout}>Logout</button></header>
    <section className="grid two">
      <div className="card"><h2>Profile</h2><div className="form-grid"><label>Name<input value={user.name} readOnly /></label><label>Email<input value={user.email} readOnly /></label><label>Role<input value={user.role} readOnly /></label></div></div>
      <div className="card"><h2>Zoho Sync</h2><div className="form-grid"><label>Webhook URL<input value="/api/webhooks/zoho/sales-order" readOnly /></label><label>Frequency<select defaultValue="15"><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option></select></label><label>Conflicts<select defaultValue="review"><option value="review">Admin review</option><option value="notify">Notify manager</option></select></label><button className="btn light">Save</button></div></div>
    </section>
    {admin && <section className="card user-management-card" style={{ marginTop: 16 }}>
      <div className="modal-section-title"><h2>User Management</h2><button className="btn light sync-icon-btn" aria-label="Refresh users" title="Refresh users" onClick={loadUsers} disabled={loading}>{loading ? '↻' : '⟳'}</button></div>
      {message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}
      <div className="form-grid user-add">
        <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        <input placeholder="Username" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
        <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as AppRole })}>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        <input placeholder="Password" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
        <button className="btn red" onClick={addUser}>Create User</button>
      </div>
      <div className="user-admin-list">{users.map((u) => <div className="user-admin-row" key={u.id}>
        <input value={u.name} onChange={(e) => setUsers((prev) => prev.map((item) => item.id === u.id ? { ...item, name: e.target.value } : item))} />
        <input value={u.email} onChange={(e) => setUsers((prev) => prev.map((item) => item.id === u.id ? { ...item, email: e.target.value } : item))} />
        <input value={u.username} onChange={(e) => setUsers((prev) => prev.map((item) => item.id === u.id ? { ...item, username: e.target.value } : item))} />
        <select value={u.role} onChange={(e) => patchUser(u.id, { role: e.target.value as AppRole })}>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        <select value={u.active ? 'active' : 'inactive'} onChange={(e) => patchUser(u.id, { active: e.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <input placeholder="New password" type="password" value={passwords[u.id] || ''} onChange={(e) => setPasswords((prev) => ({ ...prev, [u.id]: e.target.value }))} />
        <button className="btn light" onClick={() => patchUser(u.id, { name: u.name, email: u.email, username: u.username, role: u.role, active: u.active, password: passwords[u.id] || undefined })}>Save</button>
        <button className="btn light" onClick={() => deactivateUser(u.id)} disabled={u.id === user.id}>Deactivate</button>
      </div>)}</div>
    </section>}
  </>
}
