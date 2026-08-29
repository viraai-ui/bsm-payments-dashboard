'use client'

import { useEffect, useState } from 'react'
import { AuthGate, useAuth } from './AuthGate'
import { MobileMenu, type NavItem } from './MobileMenu'

const nav: NavItem[] = [
  { label: 'Payments', href: '/payments' },
]

const utilityNav: NavItem[] = []

function ShellBody({ children, active }: { children: React.ReactNode; active: string }) {
  const { user, logout } = useAuth()
  const [readyCount, setReadyCount] = useState<number | null>(null)
  const dispatchOnly = user.role === 'Dispatch'
  const mediaOnly = user.role === 'Media'
  const databaseOnly = user.role === 'Database'
  const accountsOnly = user.role === 'Accounts'
  const visibleNav = dispatchOnly ? nav.filter((item) => item.href === '/packaging-tv') : mediaOnly ? nav.filter((item) => item.href === '/media-proof') : databaseOnly ? nav.filter((item) => item.href === '/database') : accountsOnly ? nav.filter((item) => item.href === '/payments') : user.role === 'Operations' ? nav.filter((item) => !['/settings', '/media-proof', '/salesman-view', '/payments'].includes(item.href)) : nav
  const canUseUtilities = user.role === 'Admin' || user.role === 'Operations'
  const visibleUtilityNav = canUseUtilities ? utilityNav : []
  const mobileHidden = new Set(['/packaging-tv', '/settings'])
  const mobileNav = visibleNav.filter((item) => !mobileHidden.has(item.href))
  const singleModule = dispatchOnly
  useEffect(() => {
    if (!visibleNav.some((item) => item.href === '/ready-to-ship')) return
    let active = true
    fetch('/api/ready-to-ship', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((json) => { if (active && json?.ok) setReadyCount(json.data?.items?.length ?? 0) })
      .catch(() => {})
    return () => { active = false }
  }, [user.role])
  return <div className={singleModule ? 'shell dispatch-shell single-module-shell' : 'shell'}>
    {!singleModule && <MobileMenu nav={mobileNav} utilityNav={visibleUtilityNav} active={active} onLogout={logout} readyCount={readyCount} />}
    {!singleModule && <aside className="side">
      <div className="brand">
        <img className="logo bsm-brand-logo" src="/brand/bsm-logo.png" alt="BSM" />
        <div>
          <strong>Payments</strong>
          <div className="muted">Dashboard</div>
        </div>
      </div>
      <nav className="nav" aria-label="Dashboard navigation">
        {visibleNav.map((item) => <a className={`${item.label === active ? 'active' : ''} ${item.href === '/ready-to-ship' ? 'ready-nav-link' : ''}`} href={item.href} key={item.label}><span>{item.label}</span>{item.href === '/ready-to-ship' && readyCount !== null && <em className="ready-nav-count">{readyCount}</em>}</a>)}
      </nav>
      <div className="side-user">
        {visibleUtilityNav.map((item) => <a className={`side-utility-link ${item.href === '/wooden-packing' ? 'wooden-utility-link' : ''} ${item.label === active ? 'active' : ''}`} href={item.href} key={item.label}>{item.label}</a>)}
        <div className="side-user-card">
          <div className="side-user-copy"><strong>{user.name || user.role}</strong><span>{user.email}</span></div>
          <button className="side-logout-icon" type="button" aria-label="Logout" title="Logout" onClick={logout}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4.75A2.75 2.75 0 0 1 12.75 2h3.5A2.75 2.75 0 0 1 19 4.75v14.5A2.75 2.75 0 0 1 16.25 22h-3.5A2.75 2.75 0 0 1 10 19.25v-1a1 1 0 1 1 2 0v1c0 .414.336.75.75.75h3.5a.75.75 0 0 0 .75-.75V4.75a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0-.75.75v1a1 1 0 1 1-2 0v-1Z"/><path d="M4.293 11.293a1 1 0 0 0 0 1.414l3 3A1 1 0 0 0 8.707 14L7.414 12.707H13a1 1 0 1 0 0-2H7.414l1.293-1.293A1 1 0 0 0 7.293 8l-3 3Z"/></svg>
          </button>
        </div>
      </div>
    </aside>}
    {singleModule && <button className="dispatch-floating-logout" aria-label="Logout" title="Logout" onClick={logout}>⏻</button>}
    <main className="main">{children}</main>
  </div>
}

export function DashboardShell({ children, active = 'Orders' }: { children: React.ReactNode; active?: string }) {
  return <AuthGate><ShellBody active={active}>{children}</ShellBody></AuthGate>
}

export function Badge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'red' | 'green' | 'amber' | 'blue' | 'gray' | 'purple' }) {
  return <span className={`badge ${tone}`}>{children}</span>
}
