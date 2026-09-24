import assert from 'node:assert/strict'
import { normalizePaymentProofFiles, PAYMENT_PROOF_MAX_BYTES } from '../src/lib/payment-proof-files'

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
console.log('PASS proof intake normalization: image/PDF allowlist, size/count, duplicates, append and Choose-files replacement')
