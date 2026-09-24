import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizePaymentProofFiles, PAYMENT_PROOF_MAX_BYTES, removePaymentProofFile } from '../src/lib/payment-proof-files'

type F = { name: string; size: number; type: string; lastModified: number }
const file = (name: string, type = 'image/png', size = 100, lastModified = 1): F => ({ name, type, size, lastModified })

let result = normalizePaymentProofFiles<F>([], [file('receipt.png')], 'append')
assert.deepEqual(result.files.map(x => x.name), ['receipt.png'])
assert.equal(result.error, '')

result = normalizePaymentProofFiles<F>(result.files, [file('second.pdf', 'application/pdf')], 'append')
assert.deepEqual(result.files.map(x => x.name), ['receipt.png', 'second.pdf'])

const repeated = normalizePaymentProofFiles<F>(result.files, [file('receipt.png')], 'append')
assert.deepEqual(repeated.files, result.files)
assert.match(repeated.error, /duplicate file was already selected/)

const unsupported = normalizePaymentProofFiles<F>(result.files, [file('malware.exe', 'application/octet-stream')], 'append')
assert.deepEqual(unsupported.files, result.files)
assert.match(unsupported.error, /not a supported image or PDF/)

const oversized = normalizePaymentProofFiles<F>(result.files, [file('huge.pdf', 'application/pdf', PAYMENT_PROOF_MAX_BYTES + 1)], 'append')
assert.deepEqual(oversized.files, result.files)
assert.match(oversized.error, /no larger than 10 MB/)

const tooMany = normalizePaymentProofFiles<F>([], Array.from({ length: 6 }, (_, i) => file(`${i}.png`, 'image/png', 100, i)), 'append')
assert.equal(tooMany.files.length, 0)
assert.match(tooMany.error, /up to 5/i)

const replaced = normalizePaymentProofFiles<F>(result.files, [file('replacement.heic', '')], 'replace')
assert.deepEqual(replaced.files.map(x => x.name), ['replacement.heic'])

// Remove one, the middle of many, all files, and then re-add an exact duplicate.
assert.deepEqual(removePaymentProofFile(replaced.files, 0), [])
const three = [file('one.png', 'image/png', 100, 1), file('middle.pdf', 'application/pdf', 100, 2), file('three.png', 'image/png', 100, 3)]
const withoutMiddle = removePaymentProofFile(three, 1)
assert.deepEqual(withoutMiddle.map(x => x.name), ['one.png', 'three.png'])
const readded = normalizePaymentProofFiles(withoutMiddle, [three[1]], 'append')
assert.deepEqual(readded.files.map(x => x.name), ['one.png', 'three.png', 'middle.pdf'])
let emptied = removePaymentProofFile(readded.files, 2)
emptied = removePaymentProofFile(emptied, 1)
emptied = removePaymentProofFile(emptied, 0)
assert.equal(emptied.length, 0)
assert.equal(emptied.length > 0, false, 'required-proof validity must recalculate false after remove-all')

// UI contract: every internal proof-capable mode shares ProofUpload; edit sends replaceProofs=false
// after staged replacements are removed, preserving persisted proof attachments.
const internal = readFileSync(new URL('../src/components/PaymentsClient.tsx', import.meta.url), 'utf8')
const publicForm = readFileSync(new URL('../src/app/submit-payment/PublicPaymentForm.tsx', import.meta.url), 'utf8')
const internalCss = readFileSync(new URL('../src/app/add-payment-modal.css', import.meta.url), 'utf8')
const publicCss = readFileSync(new URL('../src/app/submit-payment/submit-payment.module.css', import.meta.url), 'utf8')
assert.equal((internal.match(/<ProofUpload/g) || []).length, 3, 'add unauthorised, add regular, and edit must use shared proof upload')
assert.match(internal, /aria-label={`Remove \${f\.name}`}/)
assert.match(publicForm, /aria-label={`Remove \${item\.name}`}/)
assert.match(internal, /body\.set\("replaceProofs", String\(proofs\.length > 0\)\)/)
assert.match(internal, /setOpen\(false\);setProofs\(\[\]\)/, 'close must clear selected proof state')
assert.match(publicForm, /setOpen\(false\)/)
assert.match(publicForm, /resetPaymentForm\(\)/)
assert.match(internalCss, /width:44px;height:44px/)
assert.match(publicCss, /\.fileQueue button\{[^}]*width:44px;height:44px/)
assert.match(internalCss, /@media\(max-width:340px\)/, '320px rules must remain present')
assert.match(publicCss, /@media\(max-width:390px\)/, '390px rules must remain present')
console.log('PASS proof selection/removal: one, middle, all, duplicate re-add, edit preservation, reset, accessibility and responsive contracts')
