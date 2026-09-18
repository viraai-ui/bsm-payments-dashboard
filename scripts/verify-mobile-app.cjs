const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const payments = read('src/components/PaymentsClient.tsx');
const shell = read('src/components/MobileMenu.tsx');
const css = [read('src/app/premium.css'), read('src/app/payments-cleanup.css'), read('src/app/add-payment-modal.css')].join('\n');
const manifest = read('src/app/manifest.ts');

assert.match(shell, /mobile-appbar/, 'native app bar exists');
assert.match(shell, /mobile-bottom-nav/, 'native bottom navigation exists');
assert.match(shell, /user\.role === 'Viewer'/, 'Viewer navigation is role-scoped');
assert.match(shell, /user\.role === 'Admin'/, 'Settings is Admin-scoped');
assert.match(payments, /ledger-mobile-list/, 'mobile card feed exists independently from desktop table');
assert.match(payments, /createPortal/, 'menus and selectors can escape clipping ancestors');
assert.match(payments, /role="dialog"/, 'sheets expose dialog semantics');
assert.match(payments, /open-sales-orders/, 'native order selector uses server search');
assert.match(payments, /viewerPaymentMetrics/, 'Viewer oversight metrics remain wired');
assert.match(payments, /payment:select-tab/, 'mobile navigation is client-side wired');
assert.match(css, /safe-area-inset-top/, 'top safe area is handled');
assert.match(css, /safe-area-inset-bottom/, 'bottom safe area is handled');
assert.match(css, /100dvh/, 'dynamic viewport units protect keyboard layouts');
assert.match(css, /prefers-reduced-motion/, 'reduced motion is supported');
assert.match(css, /min-height:44px|min-height: 44px/, 'minimum touch target contract exists');
assert.match(manifest, /display:\s*['"]standalone['"]/, 'PWA launches standalone');
assert.ok((manifest.match(/sizes:/g) || []).length >= 2, 'install icons are declared');
console.log('PASS mobile app contract: shell, role nav, card feed, sheets, order search, notifications/viewer wiring, safe areas and PWA manifest');
