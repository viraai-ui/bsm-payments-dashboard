const fs = require('node:fs')
const assert = require('node:assert/strict')

const client = fs.readFileSync('src/components/PaymentsClient.tsx', 'utf8')
const css = fs.readFileSync('src/app/payments-cleanup.css', 'utf8')
const paymentsApi = fs.readFileSync('src/app/api/payments/route.ts', 'utf8')
const workerApi = fs.readFileSync('src/app/api/integrations/payouts/retry/route.ts', 'utf8')
const vercel = fs.readFileSync('vercel.json', 'utf8')

for (const forbidden of ['Sync Pending', 'Synced to Payouts', 'Sync Failed', 'Manual Review', 'Retry Payout Sync', 'PayoutSync', 'payout-sync']) {
  assert.equal(client.includes(forbidden), false, `client must not expose ${forbidden}`)
  assert.equal(css.includes(forbidden), false, `CSS must not retain ${forbidden}`)
}
assert.equal(client.includes('/api/integrations/payouts/retry'), false, 'browser must not call payout worker')
assert.equal(paymentsApi.includes('payoutSync'), false, 'payment reads must not expose operations state')
assert.equal(workerApi.includes('export async function POST'), false, 'manual dashboard retry API is removed')
assert.match(workerApi, /export async function GET/)
assert.match(workerApi, /cronAuthorized/)
assert.match(workerApi, /processDueOutbox/)
assert.match(vercel, /"schedule": "\* \* \* \* \*"/)
console.log('PASS payout sync UI absent for every role and bounded background cron worker retained')
