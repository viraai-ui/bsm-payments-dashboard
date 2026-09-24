import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
process.env.APP_LOCAL_ONLY = 'true'
const root = process.cwd()
const pushPath = path.join(root, 'data/payment-push-subscriptions.json')
const original = await readFile(pushPath, 'utf8').catch(() => '{"subscriptions":[]}')
const push = await import(path.join(root, 'src/lib/payment-push.ts'))
let assertions = 0
const ok = (value: unknown, message = 'expected value to be truthy') => { assert.ok(value, message); assertions++ }
const eq = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); assertions++ }
try {
  await writeFile(pushPath, JSON.stringify({ subscriptions: [] }))
  const subscription = { endpoint: 'https://push.example.test/device-one', keys: { p256dh: 'p'.repeat(65), auth: 'a'.repeat(16) } }
  await push.savePaymentPushSubscription('sales-user', 'Salesperson', 'stable-device', subscription)
  await push.savePaymentPushSubscription('accounts-user', 'Accounts', 'stable-device', subscription)
  let store = JSON.parse(await readFile(pushPath, 'utf8'))
  eq(store.subscriptions.length, 1)
  eq(store.subscriptions[0].userId, 'accounts-user')
  eq(store.subscriptions[0].role, 'Accounts')
  await push.removePaymentPushSubscription('sales-user', subscription.endpoint)
  store = JSON.parse(await readFile(pushPath, 'utf8'))
  eq(store.subscriptions.length, 1)
  await push.removePaymentPushSubscription('accounts-user', subscription.endpoint)
  store = JSON.parse(await readFile(pushPath, 'utf8'))
  eq(store.subscriptions.length, 0)

  const page = await readFile(path.join(root, 'src/app/settings/page.tsx'), 'utf8')
  const shell = await readFile(path.join(root, 'src/components/DashboardShell.tsx'), 'utf8')
  const authGate = await readFile(path.join(root, 'src/components/AuthGate.tsx'), 'utf8')
  const mobile = await readFile(path.join(root, 'src/components/MobileMenu.tsx'), 'utf8')
  const onboarding = await readFile(path.join(root, 'src/components/NotificationOnboarding.tsx'), 'utf8')
  const card = await readFile(path.join(root, 'src/components/NotificationSettingsCard.tsx'), 'utf8')
  const css = await readFile(path.join(root, 'src/app/settings.css'), 'utf8')
  for (const role of ['Admin', 'Accounts', 'Salesperson']) ok(page.includes(role) && shell.includes(role) && mobile.includes(role) && authGate.includes(role), `${role} Settings visibility`)
  ok(page.includes("!['Admin', 'Accounts', 'Salesperson'].includes(user.role)"), 'Viewer remains excluded')
  ok(card.includes('Enable notifications') && card.includes('payment-notifications:settings'), 'real enable action')
  ok(onboarding.includes("method: 'POST'") && onboarding.includes("cache: 'no-store'"), 'subscribe and server verification actions')
  ok(onboarding.includes("Notification.permission === 'denied'") && onboarding.includes("setState('blocked')"), 'denial recovery state')
  ok(onboarding.includes('SETUP_TIMEOUT_MS = 10000') && onboarding.includes('Promise.race'), 'bounded setup action')
  ok(onboarding.includes('[autoPrompt, user.id, user.role]') && onboarding.includes('serverVerified(subscription, id)'), 'session changes verify current device binding without silent reassignment')
  ok(css.includes('.notification-settings-button{min-height:44px}'), '44px mobile-safe action')
  console.log(`notification settings: ${assertions} assertions passed`)
} finally {
  await writeFile(pushPath, original)
}
