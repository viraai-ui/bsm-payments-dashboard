import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mergePaymentSnapshot } from '../src/lib/payment-live-sync.ts'

const payment=(id,status,updatedAt)=>({id,status,updatedAt,customerName:id,paymentAmount:1,paymentDate:'2026-01-01',createdBy:'u',createdAt:updatedAt})
const optimistic=payment('p1','Pending','new'),stale=payment('p1','Payment Received','old'),remote=payment('p2','Pending','remote')
assert.deepEqual(mergePaymentSnapshot([optimistic],[stale,remote],new Set(['p1'])),[optimistic,remote], 'poll cannot revert an in-flight optimistic mutation')
assert.deepEqual(mergePaymentSnapshot([optimistic],[stale,remote],new Set()),[stale,remote], 'authoritative snapshot wins after mutation completes')
assert.deepEqual(mergePaymentSnapshot([optimistic],[],new Set(['p1'])),[optimistic], 'in-flight mutation is not removed by a stale poll')
const client=await readFile(new URL('../src/components/PaymentsClient.tsx',import.meta.url),'utf8')
const route=await readFile(new URL('../src/app/api/payments/route.ts',import.meta.url),'utf8')
const onboarding=await readFile(new URL('../src/components/NotificationOnboarding.tsx',import.meta.url),'utf8')
assert.match(client,/}, 4000\);/);assert.match(client,/cache: "no-store"/);assert.match(client,/mutationVersion/);assert.match(client,/setSelected\(payments\.find/)
assert.match(route,/listPaymentsForUserFresh/);assert.match(route,/no-store, max-age=0/)
assert.match(onboarding,/SETUP_TIMEOUT_MS = 10000/);assert.match(onboarding,/Service worker activation/);assert.match(onboarding,/In-app notifications remain active/)
console.log('PASS live sync: optimistic race protection, 4s polling, fresh no-store API, dialog reconciliation, bounded push setup')
