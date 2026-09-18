'use client'

import { useEffect, useState } from 'react'
import type { SafeUser } from '@/lib/auth'
import { NotificationCenter } from './NotificationCenter'

export type NavItem = { label: string; href: string; icon?: 'payments' | 'settings' }

export function NavIcon({ icon }: { icon?: NavItem['icon'] }) {
  if (icon === 'payments') return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 15h4"/></svg>
  if (icon === 'settings') return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 14.5a2 2 0 0 0 .4 2.2l.1.1-2.7 2.7-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V21H9.5v-.2A2 2 0 0 0 8.3 19a2 2 0 0 0-2.2.4l-.1.1-2.7-2.7.1-.1a2 2 0 0 0 .4-2.2A2 2 0 0 0 2 13.3H2V9.5h.2A2 2 0 0 0 4 8.3a2 2 0 0 0-.4-2.2L3.5 6l2.7-2.7.1.1A2 2 0 0 0 8.5 4 2 2 0 0 0 9.7 2.2V2h3.8v.2A2 2 0 0 0 14.7 4a2 2 0 0 0 2.2-.4l.1-.1L19.7 6l-.1.1a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.8 1.2h.2v3.8H21a2 2 0 0 0-2 1.2Z"/></svg>
  return null
}

export function MobileMenu({ active, onLogout, user }: { nav: NavItem[]; utilityNav?: NavItem[]; active: string; onLogout: () => void | Promise<void>; readyCount?: number | null; user: SafeUser }) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [paymentTab, setPaymentTab] = useState<'all' | 'unauthorised' | 'pending'>('all')
  useEffect(() => {
    const changed = (event: Event) => setPaymentTab((event as CustomEvent<'all' | 'unauthorised' | 'pending'>).detail)
    window.addEventListener('payment:tab-changed', changed)
    return () => window.removeEventListener('payment:tab-changed', changed)
  }, [])
  useEffect(() => {
    if (!accountOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [accountOpen])
  const destinations = user.role === 'Viewer'
    ? ([['all', 'All Payments'], ['pending', 'Pending']] as const)
    : ([['all', 'All Payments'], ['unauthorised', 'Unauthorised'], ['pending', 'Pending']] as const)
  const screenLabel = active === 'Settings' ? 'Settings' : destinations.find(([key]) => key === paymentTab)?.[1] || 'All Payments'
  return <>
    <header className="mobile-appbar" data-mobile-app-header>
      <a className="mobile-brand" href="/payments" aria-label="BSM Payments home">
        <img className="mobile-logo bsm-brand-logo" src="/brand/bsm-logo.png" alt="BSM" />
        <strong>{screenLabel}</strong>
      </a>
      <div className="mobile-app-actions">
        {active === 'Payments' && user.role !== 'Viewer' && <button className="mobile-add-action" type="button" aria-label="Add payment" onClick={() => window.dispatchEvent(new Event('payment:add'))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>}
        <NotificationCenter />
        <button className="mobile-avatar" type="button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen(true)}>{(user.name || user.email || user.role).slice(0,2).toUpperCase()}</button>
      </div>
    </header>
    {accountOpen && <div className="mobile-sheet-layer" role="presentation" onClick={() => setAccountOpen(false)}>
      <section className="mobile-account-sheet" role="dialog" aria-modal="true" aria-label="Account" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle"/><button className="mobile-sheet-close" type="button" aria-label="Close account menu" onClick={() => setAccountOpen(false)}>×</button><header><div className="account-avatar">{(user.name || user.role).slice(0,2).toUpperCase()}</div><div><strong>{user.name || user.role}</strong><span>{user.email}</span></div></header><p>{user.role} account</p>
        <button type="button" onClick={() => void onLogout()}>Sign out</button>
      </section>
    </div>}
    <nav className="mobile-bottom-nav" aria-label="Payment navigation">
      {active === 'Payments' ? destinations.map(([key,label]) => <button type="button" key={key} aria-label={label} className={paymentTab===key?'active':''} aria-current={paymentTab===key?'page':undefined} onClick={() => window.dispatchEvent(new CustomEvent('payment:select-tab',{detail:key}))}><span className="nav-icon-box"><NavIcon icon="payments"/></span><span>{label}</span></button>) : <a href="/payments" aria-label="All Payments"><span className="nav-icon-box"><NavIcon icon="payments"/></span><span>Payments</span></a>}
      {user.role === 'Admin' && <a href="/settings" aria-label="Settings" className={active==='Settings'?'active':''} aria-current={active==='Settings'?'page':undefined}><span className="nav-icon-box"><NavIcon icon="settings"/></span><span>Settings</span></a>}
    </nav>
  </>
}
