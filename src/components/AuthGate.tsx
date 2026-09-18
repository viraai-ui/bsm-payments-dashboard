'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { SafeUser } from '@/lib/auth'

type AuthContextValue = { user: SafeUser; logout: () => Promise<void> }
const AuthContext = createContext<AuthContextValue | null>(null)
const dispatchOnlyPath = '/packaging-tv'
const mediaOnlyPath = '/media-proof'
const databaseOnlyPath = '/database'
const accountsOnlyPath = '/payments'
const mediaAllowedPaths = ['/media-proof']
const adminOnlyPaths: string[] = ['/salesman-view']
function homeForRole(_role: string) { return '/payments' }

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthGate')
  return value
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null)
  const [ready, setReady] = useState(false)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    void refreshSession()
  }, [])

  useEffect(() => {
    if (!user) return
    if (pathname === '/settings' && user.role !== 'Admin') router.replace('/payments')
  }, [pathname, router, user])

  async function refreshSession() {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' })
      const json = await response.json().catch(() => ({}))
      setUser(response.ok && json.ok ? json.user : null)
    } finally {
      setReady(true)
    }
  }

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true); setError('')
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.ok) throw new Error(json.error || 'Invalid login')
      setUser(json.user)
      router.replace(homeForRole(json.user.role))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid login')
    } finally { setSubmitting(false) }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    router.replace('/')
  }

  if (!ready) return null
  if (!user) {
    return <main className="login-screen">
      <section className="login-card card">
        <div className="login-brand-box">
          <img className="login-brand-logo" src="/brand/bsm-logo.png" alt="BSM" />
          <span>PAYMENTS DASHBOARD</span>
        </div>
        <h1 className="h1">Login</h1>
        <form className="form-grid" onSubmit={submitLogin}>
          <label>Email or Username<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" /></label>
          <label>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn red" type="submit" disabled={submitting}>{submitting ? 'Logging in…' : 'Login'}</button>
        </form>
      </section>
    </main>
  }

  if (pathname === '/settings' && user.role !== 'Admin') return null
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>
}
