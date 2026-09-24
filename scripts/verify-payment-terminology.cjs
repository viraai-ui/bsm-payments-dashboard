const assert = require('node:assert/strict')
const fs = require('node:fs')

for (const file of [
  'src/components/PaymentsClient.tsx',
  'src/components/SettingsClient.tsx',
  'src/lib/management-payment-metrics.ts',
]) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const literals = [...source.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
    .map(match => match[2])
    .filter(value => !['claim-receipt-context', 'pending-receipts'].includes(value))
    .join('\n')
  const jsxText = [...source.matchAll(/>([^<{]+)</g)].map(match => match[1]).join('\n')
  assert.doesNotMatch(`${literals}\n${jsxText}`, /\breceipts?\b/i, `${file} contains standalone rendered receipt terminology`)
}

const source = fs.readFileSync('src/lib/viewer-payment-metrics.ts', 'utf8')
const match = source.match(/paymentCountLabel\s*=\s*\(count: number\) => `\$\{count\} \$\{count === 1 \? 'payment' : 'payments'\}`/)
assert.ok(match, '0/1/many count helper uses payment/payments')
const label = count => `${count} ${count === 1 ? 'payment' : 'payments'}`
assert.deepEqual([0, 1, 7].map(label), ['0 payments', '1 payment', '7 payments'])
console.log('PASS payment terminology: rendered sources and 0/1/many counts')