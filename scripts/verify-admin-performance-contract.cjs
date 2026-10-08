const fs = require('node:fs')
const assert = require('node:assert/strict')

const shell = fs.readFileSync('src/components/DashboardShell.tsx', 'utf8')
const overview = fs.readFileSync('src/components/AdminOverviewClient.tsx', 'utf8')
const payments = fs.readFileSync('src/components/PaymentsClient.tsx', 'utf8')

assert.match(shell, /<Link prefetch=\{false\}/, 'dashboard navigation must not speculatively execute authoritative routes')
assert.match(overview, /href="\/payments" prefetch=\{false\}/, 'overview must not prefetch the full payment ledger')
assert.match(payments, /userRole === "Admin" \? 30000 : 4000/, 'Admin full-ledger polling must be throttled')
assert.match(payments, /refreshController\.current\?\.abort\(\)/, 'in-flight ledger polling must be cancelled during navigation')
assert.doesNotMatch(payments, /useEffect\(\(\) => \{ void refresh\(\); \}, \[refresh\]\)/, 'hydration must not duplicate the authoritative server read')

console.log('Admin performance contract verified: no route prefetch fan-out, duplicate hydration read, or orphaned rapid Admin polling.')
