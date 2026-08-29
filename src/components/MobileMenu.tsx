'use client'

import { useState } from 'react'

export type NavItem = { label: string; href: string }

export function MobileMenu({ nav, utilityNav = [], active, onLogout, readyCount = null }: { nav: NavItem[]; utilityNav?: NavItem[]; active: string; onLogout: () => void | Promise<void>; readyCount?: number | null }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="mobile-appbar">
        <a className="mobile-brand" href="/" aria-label="BSM Dispatch home">
          <img className="mobile-logo bsm-brand-logo" src="/brand/bsm-logo.png" alt="BSM" />
          <span>
            <strong>Dispatch</strong>
            <small>Dashboard</small>
          </span>
        </a>
        <button className="dots-trigger" aria-label="Open module menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <span />
          <span />
          <span />
        </button>
      </div>

      {open && <button className="drawer-scrim" aria-label="Close module menu" onClick={() => setOpen(false)} />}

      <aside className={`mobile-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="drawer-glow" />
        <div className="drawer-head">
          <div>
            <h2>Modules</h2>
          </div>
          <button className="drawer-close" aria-label="Close menu" onClick={() => setOpen(false)}>×</button>
        </div>
        <nav className="drawer-nav" aria-label="Mobile module navigation">
          {nav.map((item, index) => (
            <a className={`${item.label === active ? 'active' : ''} ${item.href === '/ready-to-ship' ? 'ready-nav-link' : ''}`} href={item.href} key={item.label} onClick={() => setOpen(false)}>
              <span className="module-orb">{String(index + 1).padStart(2, '0')}</span>
              <span>{item.label}</span>
              {item.href === '/ready-to-ship' && readyCount !== null && <strong className="ready-nav-count">{readyCount}</strong>}
              <em>›</em>
            </a>
          ))}
        </nav>
        {utilityNav.length > 0 && <nav className="drawer-utility-nav" aria-label="Mobile utility navigation">
          {utilityNav.map((item) => <a className={`drawer-utility-link ${item.href === '/wooden-packing' ? 'wooden-utility-link' : ''} ${item.label === active ? 'active' : ''}`} href={item.href} key={item.label} onClick={() => setOpen(false)}>{item.label}</a>)}
        </nav>}
        <button className="drawer-logout" type="button" onClick={() => { setOpen(false); void onLogout() }}>
          <span className="module-orb drawer-logout-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
            </svg>
          </span>
          <span>Logout</span>
        </button>
      </aside>
    </>
  )
}
