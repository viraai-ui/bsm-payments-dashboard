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

function PaymentTabIcon({ tab }: { tab: 'all' | 'unauthorised' | 'pending' }) {
  const common = { className: 'nav-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (tab === 'unauthorised') return <svg {...common}><path d="M12 3 4.5 6.2v5.2c0 4.7 3.2 8.1 7.5 9.6 4.3-1.5 7.5-4.9 7.5-9.6V6.2L12 3Z"/><path d="M12 8v4.2m0 3.3h.01" fill="none"/></svg>;
  if (tab === 'pending') return <svg {...common}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8" fill="none"/></svg>;
  return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 15h4" fill="none"/></svg>;
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
    ? ([['all', 'Regular Payments'], ['pending', 'Pending']] as const)
    : ([['all', 'Regular Payments'], ['unauthorised', 'Unauthorised'], ['pending', 'Pending']] as const)
  const paymentScreenLabels = {
    all: 'Regular Payments',
    unauthorised: 'Unauthorised Payments',
    pending: 'Pending Payments',
  } as const
  const screenLabel = active === 'Settings' ? 'Settings' : paymentScreenLabels[paymentTab]
  return <>
    <header className="mobile-appbar" data-mobile-app-header>
      <a className="mobile-brand" href="/payments" aria-label="BSM Payments home">
        <img className="mobile-logo bsm-brand-logo" src="/brand/bsm-logo.png" alt="BSM" />
        <strong>{screenLabel}</strong>
      </a>
      <div className="mobile-app-actions">
        <NotificationCenter />
        <button className="mobile-avatar" type="button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen(true)}>{(user.name || user.email || user.role).slice(0,2).toUpperCase()}</button>
      </div>
    </header>
    {accountOpen && <div className="mobile-sheet-layer" role="presentation" onClick={() => setAccountOpen(false)}>
      <section className="mobile-account-sheet" role="dialog" aria-modal="true" aria-label="Account" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle"/><button className="mobile-sheet-close" type="button" aria-label="Close account menu" onClick={() => setAccountOpen(false)}>×</button><header><div className="account-avatar">{(user.name || user.role).slice(0,2).toUpperCase()}</div><div><strong>{user.name || user.role}</strong><span>{user.email}</span></div></header><p>{user.role}</p>
        <div className="account-sheet-actions">
          {user.role === 'Admin' && <a href="/settings" className="account-settings-link"><NavIcon icon="settings"/><span>Settings</span><b aria-hidden="true">›</b></a>}
          <button className="account-logout" type="button" onClick={() => void onLogout()}>Log out</button>
        </div>
      </section>
    </div>}
    <nav className="mobile-bottom-nav" aria-label="Payment navigation">
      {destinations.map(([key,label]) => active === 'Payments'
        ? <button type="button" key={key} aria-label={label} className={paymentTab===key?'active':''} aria-current={paymentTab===key?'page':undefined} onClick={() => window.dispatchEvent(new CustomEvent('payment:select-tab',{detail:key}))}><span className="nav-icon-box"><PaymentTabIcon tab={key}/></span><span>{key === 'all' ? 'Regular' : label}</span></button>
        : <a key={key} href={`/payments${key === 'all' ? '' : `?view=${key}`}`} aria-label={label}><span className="nav-icon-box"><PaymentTabIcon tab={key}/></span><span>{key === 'all' ? 'Regular' : label}</span></a>)}
    </nav>
  </>
}
