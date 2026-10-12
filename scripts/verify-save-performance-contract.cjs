const assert = require('node:assert/strict')
const fs = require('node:fs')

const route = fs.readFileSync('src/app/api/payments/route.ts', 'utf8')
const client = fs.readFileSync('src/components/PaymentsClient.tsx', 'utf8')

assert.match(route, /import \{ after \} from 'next\/server'/, 'post-response work must use the serverless lifecycle API')
assert.match(route, /afterSave\('notification',[\s\S]*createPaymentNotifications/, 'Add Payment notifications must be off the response path')
assert.match(route, /afterSave\('claim notification',[\s\S]*createClaimNotification/, 'Claim Payment notifications must be off the response path')
assert.doesNotMatch(route, /await timing\.measure\('notification'/, 'notification persistence still blocks Save')
assert.match(route, /const saved=files\.length\?await timing\.measure\('finalize'/, 'proof metadata must remain authoritative before success')
assert.match(route, /:payment;if\(!saved\)/, 'proofless saves must not perform a redundant second ledger write')
assert.match(route, /timing\.measure\('ledger',[\s\S]*claimPayment/, 'claim persistence must remain measured and authoritative')
assert.match(client, /void refresh\(\)\.catch/, 'post-claim refetch must not block the Save UI')
assert.doesNotMatch(client, /claimSubmissionKey\.current = "";\s*await refresh\(\)/, 'post-claim refetch still blocks Save')

console.log('save performance contract: 9 assertions passed')