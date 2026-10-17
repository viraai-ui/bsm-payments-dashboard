const assert = require('node:assert/strict')
const fs = require('node:fs')

const client = fs.readFileSync('src/components/PaymentsClient.tsx', 'utf8')
const css = fs.readFileSync('src/app/payments-cleanup.css', 'utf8')

assert.match(client, /className="ledger-action pending-adjustment-action"[\s\S]{0,160}>Adjustment<\/button>/, 'Adjustment has a contextual class')
assert.match(client, /className="ledger-action pending-add-payment-action"[\s\S]{0,160}>Add payment<\/button>/, 'Add payment has a contextual class')
assert.equal((client.match(/pending-add-payment-action/g) || []).length, 1, 'green treatment is isolated to the Pending card action')
assert.equal((client.match(/pending-adjustment-action/g) || []).length, 1, 'red treatment is isolated to the Pending card action')
assert.match(css, /\.pending-actions \.ledger-action\{[^}]*min-height:44px/, 'both contextual actions preserve the 44px touch target')
for (const action of ['pending-add-payment-action', 'pending-adjustment-action']) {
  assert.match(css, new RegExp(`\\.pending-actions \\.${action}\\{[^}]*border-color:[^}]*background:[^}]*color:`), `${action} defines restrained border, background, and text colors`)
  for (const state of ['hover', 'active', 'focus-visible']) {
    assert.match(css, new RegExp(`\\.pending-actions \\.${action}:${state}\\{`), `${action} defines ${state} feedback`)
  }
}

console.log('Pending action color, interaction, scope, and touch-target contract verified')