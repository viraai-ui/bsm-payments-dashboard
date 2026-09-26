'use client'

import { useEffect, useState } from 'react'
import type { SafeUser } from '@/lib/auth'
import { decidePushOnboarding, pushOnboardingKey, type PushOnboardingDecision } from '@/lib/push-onboarding'

type State = 'checking' | PushOnboardingDecision | 'working' | 'enabled' | 'error'
export const SETUP_TIMEOUT_MS = 10000
export function timed<T>(operation: Promise<T>, label: string): Promise<T> {
  return Promise.race([operation, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), SETUP_TIMEOUT_MS))])
}
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
async function currentSubscription() {
  const registration = await timed(navigator.serviceWorker.getRegistration('/'), 'Notification status check')
  return timed(registration?.pushManager.getSubscription() || Promise.resolve(null), 'Notification status check')
}
async function serverVerified(subscription: PushSubscription, id: string) {
  const query = new URLSearchParams({ endpoint: subscription.endpoint, deviceId: id })
  const response = await timed(fetch(`/api/payments/push-subscription?${query}`, { cache: 'no-store' }), 'Server registration check')
  const result = await response.json().catch(() => ({}))
  return response.ok && result.data?.registered === true
}

export function NotificationOnboarding({ user, autoPrompt = true }: { user: SafeUser; autoPrompt?: boolean }) {
  const [state, setState] = useState<State>('checking')
  const [detail, setDetail] = useState('')
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    if (!autoPrompt) { setState('hidden'); return }
    let cancelled = false
    void (async () => {
      const cap = capability()
      if (!cap.supported) { if (!cancelled) setState('hidden'); return }
      const id = deviceId()
      const dismissed = localStorage.getItem(pushOnboardingKey(user.id, id)) === 'dismissed'
      let subscription: PushSubscription | null = null
      let verified = false
      if (Notification.permission === 'granted') {
        try {
          subscription = await currentSubscription()
          if (subscription) verified = await serverVerified(subscription, id)
        } catch { /* A bounded status failure must remain recoverable through the prompt. */ }
      }
      const decision = decidePushOnboarding({ ...cap, permission: Notification.permission, dismissed, hasSubscription: Boolean(subscription), serverVerified: verified })
      if (!cancelled) { setReconnecting(decision === 'reconnect'); setState(decision) }
    })()
    return () => { cancelled = true }
  }, [autoPrompt, user.id, user.role])

  useEffect(() => {
    const openFromSettings = () => {
      const cap = capability()
      if (!cap.supported) return
      if (cap.ios && !cap.standalone) setState('ios-install')
      else if (Notification.permission === 'denied') setState('blocked')
      else { setReconnecting(Notification.permission === 'granted'); setState(Notification.permission === 'granted' ? 'reconnect' : 'prompt') }
    }
    window.addEventListener('payment-notifications:settings', openFromSettings)
    return () => window.removeEventListener('payment-notifications:settings', openFromSettings)
  }, [])

  function dismiss() {
    localStorage.setItem(pushOnboardingKey(user.id, deviceId()), 'dismissed')
    setState('hidden')
  }

  async function enable() {
    const cap = capability()
    if (!cap.supported) { setState('hidden'); return }
    if (cap.ios && !cap.standalone) { setState('ios-install'); return }
    if (Notification.permission === 'denied') { setState('blocked'); return }
    setState('working'); setDetail('')
    try {
      // requestPermission stays directly inside this click handler: browsers require a user gesture.
      const permission = Notification.permission === 'granted' ? 'granted' : await timed(Notification.requestPermission(), 'Notification permission')
      if (permission === 'denied') { setState('blocked'); return }
      if (permission !== 'granted') { setState('prompt'); return }
      const configResponse = await timed(fetch('/api/payments/push-subscription', { cache: 'no-store' }), 'Push configuration')
      const config = await configResponse.json().catch(() => ({}))
      if (!configResponse.ok || !config.data?.configured || !config.data.publicKey) throw new Error(config.error || 'Push is not configured on this server')
      const registration = await timed(navigator.serviceWorker.register('/payment-push-sw.js', { scope: '/' }), 'Service worker registration')
      await timed(navigator.serviceWorker.ready, 'Service worker activation')
      let existing = await timed(registration.pushManager.getSubscription(), 'Push subscription check')
      if (existing) {
        const query = new URLSearchParams({ endpoint: existing.endpoint, deviceId: deviceId() })
        const check = await timed(fetch(`/api/payments/push-subscription?${query}`, { cache: 'no-store' }), 'Push key check')
        const current = await check.json().catch(() => ({}))
        if (!check.ok || current.data?.registered !== true || current.data?.keyFingerprint !== config.data.keyFingerprint || current.data?.keyVersion !== config.data.keyVersion) {
          await timed(existing.unsubscribe(), 'Old push subscription removal')
          existing = null
        }
      }
      const subscription = existing || await timed(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.data.publicKey) }), 'Push subscription')
      const id = deviceId()
      const response = await timed(fetch('/api/payments/push-subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON(), deviceId: id }) }), 'Push registration')
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.data?.subscribed !== true) throw new Error(result.error || 'Could not register this device')
      if (!await serverVerified(subscription, id)) throw new Error('The server could not verify this device registration')
      localStorage.removeItem(pushOnboardingKey(user.id, id))
      setState('enabled')
    } catch (error) {
      setDetail(`${error instanceof Error ? error.message : 'Could not enable push notifications'}. In-app notifications remain active.`)
      setState('error')
    }
  }

  if (state === 'checking' || state === 'hidden') return null
  const prompt = state === 'prompt' || state === 'reconnect' || state === 'working' || state === 'error'
  const title = state === 'blocked' ? 'Notifications blocked' : state === 'ios-install' ? 'Install to enable notifications' : state === 'enabled' ? 'Notifications enabled' : reconnecting ? 'Reconnect notifications' : 'Enable notifications'
  const message = state === 'blocked'
    ? 'Allow notifications for this site in your browser or device Settings, then return and try again.'
    : state === 'ios-install'
      ? 'On iPhone or iPad, use Share → Add to Home Screen. Open the installed app, then enable notifications.'
      : state === 'enabled'
        ? 'This device is registered for payment updates.'
        : state === 'error'
          ? detail
          : reconnecting
            ? 'Your browser subscription exists, but this device needs to be reconnected to your account.'
            : 'Get payment updates on this device.'
  return <aside className="notification-onboarding" role="dialog" aria-live="polite" aria-label={title}>
    <div><strong>{title}</strong><p>{message}</p></div>
    {prompt && <div className="notification-onboarding-actions"><button type="button" onClick={dismiss} disabled={state === 'working'}>Not now</button><button type="button" onClick={() => void enable()} disabled={state === 'working'}>{state === 'working' ? 'Connecting…' : reconnecting ? 'Reconnect' : state === 'error' ? 'Try again' : 'Enable'}</button></div>}
    {!prompt && <button className="notification-onboarding-close" type="button" onClick={dismiss}>Close</button>}
  </aside>
}
