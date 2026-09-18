'use client'

import { useEffect, useState } from 'react'
import type { SafeUser } from '@/lib/auth'

type State = 'hidden' | 'prompt' | 'working' | 'blocked' | 'ios-install' | 'unconfigured' | 'enabled' | 'unsupported'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_DISMISSALS = 3
function key(userId: string) { return `payment-push-onboarding:${userId}` }
function deviceId() {
  const storageKey = 'payment-push-device-id'
  let value = localStorage.getItem(storageKey)
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(storageKey, value) }
  return value
}
function decodeKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)))
}
function capability() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return { supported, ios, standalone }
}

export function NotificationOnboarding({ user }: { user: SafeUser }) {
  const [state, setState] = useState<State>('hidden')
  const [detail, setDetail] = useState('')
  useEffect(() => {
    if (user.role === 'Viewer') return
    const cap = capability()
    if (!cap.supported) return
    const stored = JSON.parse(localStorage.getItem(key(user.id)) || '{}') as { granted?: boolean; denied?: boolean; nextPromptAt?: number; dismissals?: number }
    if (Notification.permission === 'granted' || stored.granted) return
    if (Notification.permission === 'denied' || stored.denied) return
    if (sessionStorage.getItem(`${key(user.id)}:shown`) || (stored.nextPromptAt || 0) > Date.now() || (stored.dismissals || 0) >= MAX_DISMISSALS) return
    sessionStorage.setItem(`${key(user.id)}:shown`, '1')
    setState('prompt')
  }, [user.id, user.role])
  useEffect(() => {
    const manual = () => setState(Notification.permission === 'denied' ? 'blocked' : capability().ios && !capability().standalone ? 'ios-install' : 'prompt')
    window.addEventListener('payment-notifications:settings', manual)
    return () => window.removeEventListener('payment-notifications:settings', manual)
  }, [])

  function notNow() {
    const old = JSON.parse(localStorage.getItem(key(user.id)) || '{}')
    localStorage.setItem(key(user.id), JSON.stringify({ ...old, dismissals: (old.dismissals || 0) + 1, nextPromptAt: Date.now() + SNOOZE_MS }))
    setState('hidden')
  }
  async function enable() {
    const cap = capability()
    if (!cap.supported) { setState('unsupported'); return }
    if (cap.ios && !cap.standalone) { setState('ios-install'); return }
    setState('working'); setDetail('')
    try {
      // This is deliberately the first permission request and only runs from the Enable click.
      const permission = await Notification.requestPermission()
      if (permission === 'denied') { localStorage.setItem(key(user.id), JSON.stringify({ denied: true })); setState('blocked'); return }
      if (permission !== 'granted') { notNow(); return }
      const configResponse = await fetch('/api/payments/push-subscription', { cache: 'no-store' })
      const config = await configResponse.json().catch(() => ({}))
      if (!configResponse.ok || !config.data?.configured || !config.data.publicKey) {
        localStorage.setItem(key(user.id), JSON.stringify({ granted: true, pushConfigured: false }))
        setState('unconfigured'); return
      }
      const registration = await navigator.serviceWorker.register('/payment-push-sw.js', { scope: '/' })
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.data.publicKey) })
      const response = await fetch('/api/payments/push-subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON(), deviceId: deviceId() }) })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not register this device')
      localStorage.setItem(key(user.id), JSON.stringify({ granted: true, subscribed: true }))
      setState('enabled'); setTimeout(() => setState('hidden'), 1800)
    } catch (error) { setDetail(error instanceof Error ? error.message : 'Could not enable notifications'); setState('unsupported') }
  }
  if (state === 'hidden') return null
  const messages: Partial<Record<State, string>> = {
    blocked: 'Notifications blocked. Allow notifications for this site in your browser or device settings.',
    'ios-install': 'On iPhone and iPad, add this dashboard to your Home Screen, open it there, then enable notifications.',
    unconfigured: 'In-app notifications are active. Mobile push is not configured on this server.',
    enabled: 'Notifications enabled.',
    unsupported: detail || 'Push notifications are not available in this browser.',
  }
  return <aside className="notification-onboarding" role="dialog" aria-live="polite" aria-label="Enable notifications">
    <div><strong>{state === 'prompt' || state === 'working' ? 'Enable notifications' : state === 'blocked' ? 'Notifications blocked' : 'Notifications'}</strong>
      <p>{messages[state] || 'Get payment updates on this device.'}</p></div>
    {(state === 'prompt' || state === 'working') && <div className="notification-onboarding-actions"><button type="button" onClick={notNow} disabled={state === 'working'}>Not now</button><button type="button" onClick={() => void enable()} disabled={state === 'working'}>{state === 'working' ? 'Enabling…' : 'Enable'}</button></div>}
    {!['prompt', 'working', 'enabled'].includes(state) && <button className="notification-onboarding-close" type="button" onClick={() => setState('hidden')}>Close</button>}
  </aside>
}
