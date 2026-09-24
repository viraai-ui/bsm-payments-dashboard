'use client'

import { useEffect, useState } from 'react'
import type { SafeUser } from '@/lib/auth'

type State = 'hidden' | 'prompt' | 'working' | 'disabling' | 'blocked' | 'ios-install' | 'unconfigured' | 'enabled' | 'unsupported'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_DISMISSALS = 3
export const SETUP_TIMEOUT_MS = 10000
export function timed<T>(operation: Promise<T>, label: string): Promise<T> {
  return Promise.race([operation, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out. In-app notifications remain active.`)), SETUP_TIMEOUT_MS))])
}
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
    const manual = async () => {
      const cap = capability()
      if (!cap.supported) { setState('unsupported'); return }
      if (Notification.permission === 'denied') { setState('blocked'); return }
      if (cap.ios && !cap.standalone) { setState('ios-install'); return }
      if (Notification.permission === 'granted') {
        try {
          const registration = await timed(navigator.serviceWorker.getRegistration('/'), 'Notification status check')
          const subscription = await timed(registration?.pushManager.getSubscription() || Promise.resolve(null), 'Notification status check')
          if (!subscription) { setState('prompt'); return }
          const response = await timed(fetch('/api/payments/push-subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON(), deviceId: deviceId() }) }), 'Push registration verification')
          const result = await response.json().catch(() => ({}))
          if (!response.ok || result.data?.subscribed !== true) throw new Error(result.error || 'This device was not registered on the server')
          setState('enabled')
        } catch (error) { setDetail(error instanceof Error ? error.message : 'Could not check notification status'); setState('unsupported') }
        return
      }
      setState('prompt')
    }
    window.addEventListener('payment-notifications:settings', manual)
    return () => window.removeEventListener('payment-notifications:settings', manual)
  }, [])
  // Push endpoints belong to a browser device, not a login. Rebind an existing
  // endpoint whenever the authenticated user changes to prevent cross-user delivery.
  useEffect(() => {
    if (!capability().supported || Notification.permission !== 'granted') return
    let cancelled = false
    void (async () => {
      try {
        const registration = await timed(navigator.serviceWorker.getRegistration('/'), 'Push session check')
        const subscription = await timed(registration?.pushManager.getSubscription() || Promise.resolve(null), 'Push session check')
        if (!subscription || cancelled) return
        const response = await timed(fetch('/api/payments/push-subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON(), deviceId: deviceId() }) }), 'Push session registration')
        const result = await response.json().catch(() => ({}))
        if (!response.ok || result.data?.subscribed !== true) throw new Error('Could not register this session')
        localStorage.setItem(key(user.id), JSON.stringify({ granted: true, subscribed: true }))
      } catch { /* In-app notifications remain active; Settings can retry. */ }
    })()
    return () => { cancelled = true }
  }, [user.id, user.role])

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
      const permission = await timed(Notification.requestPermission(), 'Notification permission')
      if (permission === 'denied') { localStorage.setItem(key(user.id), JSON.stringify({ denied: true })); setState('blocked'); return }
      if (permission !== 'granted') { notNow(); return }
      const configResponse = await timed(fetch('/api/payments/push-subscription', { cache: 'no-store' }), 'Push configuration')
      const config = await configResponse.json().catch(() => ({}))
      if (!configResponse.ok || !config.data?.configured || !config.data.publicKey) {
        localStorage.setItem(key(user.id), JSON.stringify({ granted: true, pushConfigured: false }))
        setState('unconfigured'); return
      }
      const registration = await timed(navigator.serviceWorker.register('/payment-push-sw.js', { scope: '/' }), 'Service worker registration')
      await timed(navigator.serviceWorker.ready, 'Service worker activation')
      const existing = await timed(registration.pushManager.getSubscription(), 'Push subscription check')
      const subscription = existing || await timed(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.data.publicKey) }), 'Push subscription')
      const response = await timed(fetch('/api/payments/push-subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON(), deviceId: deviceId() }) }), 'Push registration')
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.data?.subscribed !== true) throw new Error(result.error || 'Could not register this device')
      localStorage.setItem(key(user.id), JSON.stringify({ granted: true, subscribed: true }))
      setState('enabled')
    } catch (error) { setDetail(`${error instanceof Error ? error.message : 'Could not enable push notifications'} In-app notifications remain active.`); setState('unsupported') }
  }
  async function disable() {
    setState('disabling'); setDetail('')
    try {
      const registration = await timed(navigator.serviceWorker.getRegistration('/'), 'Notification status check')
      const subscription = await timed(registration?.pushManager.getSubscription() || Promise.resolve(null), 'Notification status check')
      if (subscription) {
        const response = await timed(fetch('/api/payments/push-subscription', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }), 'Push removal')
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not disable notifications')
        await timed(subscription.unsubscribe(), 'Browser unsubscribe')
      }
      localStorage.setItem(key(user.id), JSON.stringify({ granted: true, subscribed: false }))
      setState('prompt')
    } catch (error) { setDetail(`${error instanceof Error ? error.message : 'Could not disable push notifications'} Try again.`); setState('unsupported') }
  }
  if (state === 'hidden') return null
  const messages: Partial<Record<State, string>> = {
    blocked: 'Notifications blocked. Allow notifications for this site in your browser or device settings.',
    'ios-install': 'On iPhone and iPad, add this dashboard to your Home Screen, open it there, then enable notifications.',
    unconfigured: 'In-app notifications are active. Mobile push is not configured on this server.',
    enabled: 'Push is registered on this device. Desktop notifications also require browser and OS notifications to be allowed; iPhone/iPad push requires this app to be installed on the Home Screen.',
    disabling: 'Disabling notifications on this device…',
    unsupported: detail || 'Push notifications are not available in this browser.',
  }
  return <aside className="notification-onboarding" role="dialog" aria-live="polite" aria-label="Enable notifications">
    <div><strong>{state === 'prompt' || state === 'working' ? 'Enable notifications' : state === 'blocked' ? 'Notifications blocked' : state === 'enabled' || state === 'disabling' ? 'Notifications enabled' : 'Notifications'}</strong>
      <p>{messages[state] || 'Get payment updates on this device.'}</p></div>
    {(state === 'prompt' || state === 'working') && <div className="notification-onboarding-actions"><button type="button" onClick={notNow} disabled={state === 'working'}>Not now</button><button type="button" onClick={() => void enable()} disabled={state === 'working'}>{state === 'working' ? 'Enabling…' : 'Enable'}</button></div>}
    {(state === 'enabled' || state === 'disabling') && <div className="notification-onboarding-actions"><button type="button" onClick={() => setState('hidden')} disabled={state === 'disabling'}>Close</button><button type="button" onClick={() => void disable()} disabled={state === 'disabling'}>{state === 'disabling' ? 'Disabling…' : 'Disable'}</button></div>}
    {!['prompt', 'working', 'enabled', 'disabling'].includes(state) && <button className="notification-onboarding-close" type="button" onClick={() => setState('hidden')}>Close</button>}
  </aside>
}
