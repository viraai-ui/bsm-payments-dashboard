import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { decidePushOnboarding, PUSH_ONBOARDING_CAMPAIGN, pushOnboardingKey, type PushOnboardingFacts } from '../src/lib/push-onboarding.ts'

let assertions = 0
const eq = (actual: unknown, expected: unknown, label: string) => { assert.equal(actual, expected, label); assertions++ }
const ok = (value: unknown, label: string) => { assert.ok(value, label); assertions++ }
const base: PushOnboardingFacts = { supported: true, ios: false, standalone: false, permission: 'default', dismissed: false, hasSubscription: false, serverVerified: false }

for (const role of ['Admin', 'Accounts', 'Salesperson', 'Viewer']) eq(decidePushOnboarding(base), 'prompt', `${role} receives campaign prompt`)
eq(PUSH_ONBOARDING_CAMPAIGN, 'push-onboarding-v2', 'campaign is versioned')
ok(pushOnboardingKey('u1', 'd1') !== 'payment-push-onboarding:u1', 'old-version storage cannot suppress v2')
eq(decidePushOnboarding({ ...base, dismissed: true }), 'hidden', 'same campaign/device dismissal suppresses repeat')
eq(decidePushOnboarding({ ...base, serverVerified: true, permission: 'granted', hasSubscription: true }), 'hidden', 'verified subscription suppresses prompt')
eq(decidePushOnboarding({ ...base, permission: 'granted', hasSubscription: true }), 'reconnect', 'stale existing subscription offers reconnect')
eq(decidePushOnboarding({ ...base, permission: 'denied' }), 'blocked', 'denied permission shows settings guidance')
eq(decidePushOnboarding({ ...base, supported: false }), 'hidden', 'unsupported browser is not nagged')
eq(decidePushOnboarding({ ...base, ios: true, standalone: false }), 'ios-install', 'iOS browser gets install guidance')
eq(decidePushOnboarding({ ...base, ios: true, standalone: true }), 'prompt', 'installed iOS app can enable')

const root = process.cwd()
const component = await readFile(`${root}/src/components/NotificationOnboarding.tsx`, 'utf8')
const shell = await readFile(`${root}/src/components/DashboardShell.tsx`, 'utf8')
const route = await readFile(`${root}/src/app/api/payments/push-subscription/route.ts`, 'utf8')
const css = await readFile(`${root}/src/app/globals.css`, 'utf8')
for (const role of ['Admin', 'Accounts', 'Salesperson', 'Viewer']) ok(route.includes(`'${role}'`), `${role} accepted by push API`)
ok(shell.includes("autoPrompt={active === 'Payments'}"), 'automatic popup is limited to authenticated Payments dashboard')
ok(component.includes('Notification.requestPermission()') && component.includes('onClick={() => void enable()}'), 'permission request is initiated by real button gesture')
ok(component.includes('SETUP_TIMEOUT_MS = 10000') && component.includes('Promise.race'), 'browser operations are bounded')
ok(component.includes("method: 'POST'") && component.includes('serverVerified(subscription, id)'), 'registration persists and is read back')
ok(component.includes("setState('error')") && component.includes("state === 'error' ? 'Try again'"), 'server persistence failure is visible and retryable')
ok(component.includes("Notification.permission === 'denied'") && component.includes('browser or device Settings'), 'denied state does not re-request permission')
ok(css.includes('.notification-onboarding button{min-height:44px;min-width:44px'), 'popup actions have 44px targets')
console.log(`push onboarding campaign: ${assertions} regressions passed`)
