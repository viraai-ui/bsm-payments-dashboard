const assert = require('node:assert/strict')
const fs = require('node:fs')

const client = fs.readFileSync('src/components/PaymentsClient.tsx', 'utf8')
const css = fs.readFileSync('src/app/payments-cleanup.css', 'utf8')

assert.match(client, /new Map\(salespeople\.map\(\(person\) => \[person\.id, person\.name \|\| person\.username\]\)\)/, 'uses the authoritative salesperson directory')
assert.match(client, /payment\.ownerUserId \|\| payment\.claimedBy \|\| payment\.createdBy/, 'stable ownership IDs take precedence')
assert.match(client, /\(legacyOwner && salesperson\(legacyOwner\)\) \|\| "Unassigned"/, 'legacy label and unassigned fallbacks are explicit')
assert.match(client, /role === "Admin" && \([\s\S]*?className="pending-salesperson-chip"/, 'chip is admin-only')
assert.match(client, /aria-label=\{`Salesperson: \$\{s\.salespersonName\}`\}/, 'chip has an accessible full label')
assert.equal((client.match(/pending-salesperson-chip/g) || []).length, 1, 'salesperson chip is isolated to pending cards')
assert.match(css, /\.pending-customer-line\{[^}]*display:flex[^}]*\}/, 'chip stays on the existing customer-name row')
assert.match(css, /\.pending-salesperson-chip\{[^}]*max-height:18px[^}]*overflow:hidden[^}]*white-space:nowrap/, 'chip cannot increase the grid-card row height')
assert.match(css, /\.pending-list \.pending-card\{[^}]*grid-template-columns:minmax\(0,1\.2fr\) minmax\(0,1fr\) minmax\(0,2fr\) auto[^}]*min-width:0/, 'desktop list columns can shrink without overflow')
assert.match(css, /\.pending-list \.pending-card>\*\{min-width:0\}/, 'all list cells are shrinkable')
assert.match(css, /@media\(max-width:760px\)\{\.pending-list \.pending-card\{grid-template-columns:1fr/, 'mobile list collapses to one column')

console.log('Pending salesperson chip role, ownership, dimensions, and overflow contract verified')
