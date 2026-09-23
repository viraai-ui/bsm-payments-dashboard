const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourceRoots = ['src', 'scripts']
const extensions = /\.(?:[cm]?[jt]sx?)$/
const files = []

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(target)
    else if (extensions.test(entry.name)) files.push(target)
  }
}

for (const sourceRoot of sourceRoots) walk(path.join(root, sourceRoot))

let currencyFormatters = 0
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const formatters = source.matchAll(/new\s+Intl\.NumberFormat\s*\([^,]+,\s*\{([\s\S]*?)\}\s*\)/g)
  for (const match of formatters) {
    if (!/style\s*:\s*['"]currency['"]/.test(match[1])) continue
    currencyFormatters++
    assert.match(match[1], /minimumFractionDigits\s*:\s*0\b/, `${path.relative(root, file)} currency formatter must set minimumFractionDigits to 0`)
    assert.match(match[1], /maximumFractionDigits\s*:\s*0\b/, `${path.relative(root, file)} currency formatter must set maximumFractionDigits to 0`)
  }
}

assert.ok(currencyFormatters > 0, 'Expected to audit at least one currency formatter')
const sample = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(52545.67)
assert.doesNotMatch(sample, /[.,]67\b/, 'Whole-rupee display must not retain decimal digits')
console.log(`PASS audited ${currencyFormatters} currency formatters; all display whole rupees`)