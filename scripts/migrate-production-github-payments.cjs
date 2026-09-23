#!/usr/bin/env node
'use strict'

/** Fail-closed one-time migration of the dedicated GitHub production data repo.
 * Reads/writes ONLY the three data files and timestamped backups documented below.
 * The Vercel env file is parsed directly because process.loadEnvFile() does not
 * replace an already-present variable, even when its parent-environment value is ''.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const API = 'https://api.github.com'
const FILES = {
  payments: 'data/payments.json',
  tombstones: 'data/payment-tombstones.json',
  notifications: 'data/payment-notifications.json',
}
const BACKUP_ROOT = 'migration-backups/payments-legacy-final'
const REQUIRED_ENV = ['GITHUB_OWNER', 'GITHUB_TOKEN', 'GITHUB_DATA_REPO', 'GITHUB_DATA_BRANCH']
const EXPECTED = { count: 106, totalPaise: 1050612300, received: 100, pending: 6, attachments: 103, uniqueIds: 106, uniqueKeys: 106 }
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }

function parseArgs(argv = process.argv.slice(2)) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run' || arg === '--apply' || arg === '--clear-secondary') out[arg.slice(2)] = true
    else if (arg.startsWith('--')) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) fail(`Missing value for ${arg}`)
      out[arg.slice(2)] = argv[++i]
    } else fail(`Unknown argument: ${arg}`)
  }
  if (!out['env-file']) fail('--env-file is required')
  if (Boolean(out['dry-run']) === Boolean(out.apply)) fail('Choose exactly one of --dry-run or --apply')
  return out
}

function parseEnv(text) {
  const values = {}
  for (const original of text.split(/\r?\n/)) {
    let line = original.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7).trim()
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) fail('Malformed environment file line')
    let value = match[2]
    if (value.startsWith('"')) {
      if (!value.endsWith('"')) fail(`Unterminated quoted value for ${match[1]}`)
      value = JSON.parse(value)
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) fail(`Unterminated quoted value for ${match[1]}`)
      value = value.slice(1, -1)
    } else value = value.replace(/\s+#.*$/, '').trim()
    values[match[1]] = value
  }
  return values
}

function loadConfig(filename) {
  const absolute = path.resolve(filename), stat = fs.statSync(absolute)
  if (!stat.isFile()) fail('Environment path is not a regular file')
  if ((stat.mode & 0o077) !== 0) fail('Environment file must have mode 600 (run chmod 600)')
  const parsed = parseEnv(fs.readFileSync(absolute, 'utf8'))
  const config = Object.fromEntries(REQUIRED_ENV.map(name => [name, (parsed[name] || '').trim()]))
  for (const name of REQUIRED_ENV) if (!config[name]) fail(`${name} is missing or empty in the environment file`)
  if (parsed.GITHUB_REPO && parsed.GITHUB_REPO.trim() === config.GITHUB_DATA_REPO) fail('GITHUB_DATA_REPO must be a dedicated repository, not the application repository')
  if (!/^[A-Za-z0-9_.-]+$/.test(config.GITHUB_OWNER) || !/^[A-Za-z0-9_.-]+$/.test(config.GITHUB_DATA_REPO)) fail('Invalid GitHub owner or repository')
  return { owner: config.GITHUB_OWNER, token: config.GITHUB_TOKEN, repo: config.GITHUB_DATA_REPO, branch: config.GITHUB_DATA_BRANCH }
}

const safePath = value => value.split('/').map(encodeURIComponent).join('/')
const headers = cfg => ({ Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' })
async function responseJson(response, operation) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) fail(`GitHub ${operation} failed: HTTP ${response.status}${body.message ? ` (${body.message})` : ''}`)
  return body
}
async function get(cfg, objectPath) {
  const base = `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`
  const response = await fetch(`${base}/contents/${safePath(objectPath)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(cfg), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (response.status === 404) return null
  const body = await responseJson(response, `read of ${objectPath}`)
  if (body.type !== 'file' || !body.sha) fail(`GitHub returned an invalid file object for ${objectPath}`)
  if (body.encoding === 'base64' && typeof body.content === 'string') return { sha: body.sha, bytes: Buffer.from(body.content.replace(/\n/g, ''), 'base64') }
  const blobResponse = await fetch(`${base}/git/blobs/${encodeURIComponent(body.sha)}`, { headers: headers(cfg), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  const blob = await responseJson(blobResponse, `blob read of ${objectPath}`)
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') fail(`GitHub returned unreadable content for ${objectPath}`)
  return { sha: body.sha, bytes: Buffer.from(blob.content.replace(/\n/g, ''), 'base64') }
}
async function put(cfg, objectPath, bytes, sha) {
  const body = { message: `One-time payment migration: ${objectPath}`, content: bytes.toString('base64'), branch: cfg.branch }
  if (sha) body.sha = sha // no sha means create-only in the Contents API
  const response = await fetch(`${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${safePath(objectPath)}`, { method: 'PUT', headers: { ...headers(cfg), 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (response.status === 409 || response.status === 422) fail(`Version/create-only precondition failed for ${objectPath}`)
  await responseJson(response, `write of ${objectPath}`)
}
function parseStore(object, objectPath, property) {
  if (!object) fail(`Authoritative object is missing: ${objectPath}`)
  let value
  try { value = JSON.parse(object.bytes.toString('utf8')) } catch { fail(`Authoritative object is malformed: ${objectPath}`) }
  if (!value || !Array.isArray(value[property])) fail(`Authoritative ${property} store is malformed`)
  return value
}
function summarizePayments(store, { strict = false } = {}) {
  const ids = new Set(), keys = new Set(), otherStatuses = {}; let totalPaise = 0, received = 0, pending = 0, attachments = 0, missingIdempotencyKeys = 0
  for (const payment of store.payments) {
    if (!payment.id || ids.has(payment.id)) fail(`Missing/duplicate payment ID: ${payment.id}`)
    ids.add(payment.id)
    if (!payment.idempotencyKey) {
      missingIdempotencyKeys++
      if (strict) fail(`Missing idempotency key: ${payment.id}`)
    } else {
      if (keys.has(payment.idempotencyKey)) fail(`Duplicate idempotency key: ${payment.idempotencyKey}`)
      keys.add(payment.idempotencyKey)
    }
    if (!Number.isFinite(Number(payment.paymentAmount))) fail(`Invalid payment amount: ${payment.id}`)
    totalPaise += Math.round(Number(payment.paymentAmount) * 100)
    if (payment.status === 'Payment Received') received++
    else if (payment.status === 'Pending') pending++
    else if (strict) fail(`Unexpected migrated status: ${payment.status}`)
    else otherStatuses[payment.status || 'Missing'] = (otherStatuses[payment.status || 'Missing'] || 0) + 1
    attachments += Array.isArray(payment.attachments) ? payment.attachments.length : 0
  }
  return { count: store.payments.length, totalPaise, received, pending, attachments, uniqueIds: ids.size, uniqueKeys: keys.size, missingIdempotencyKeys, otherStatuses }
}
function validateSource() {
  const bytes = fs.readFileSync(path.join(ROOT, 'data/payments.json')), store = parseStore({ bytes }, 'local data/payments.json', 'payments')
  const summary = summarizePayments(store, { strict: true })
  for (const [key, expected] of Object.entries(EXPECTED)) if (summary[key] !== expected) fail(`Local invariant failed: ${key}=${summary[key]}, expected ${expected}`)
  return { bytes, sha256: hash(bytes), summary }
}
function isExplicitTestDummy(item) {
  const candidates = ['id', 'type', 'kind', 'tag', 'reason', 'source', 'createdBy', 'userId', 'email'].flatMap(key => typeof item?.[key] === 'string' ? [item[key]] : [])
  return candidates.some(value => /(?:^|[-_:/@.])(qa|test|dummy|demo|fixture|seed)(?:$|[-_:/@.])/i.test(value) || /@test\.local$/i.test(value))
}
function cleanup(store, property) {
  const removed = store[property].filter(isExplicitTestDummy), preserved = store[property].filter(item => !isExplicitTestDummy(item))
  return { value: { ...store, [property]: preserved }, removed: removed.length, preserved: preserved.length }
}
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv), cfg = loadConfig(options['env-file']), source = validateSource(), current = {}
  for (const [name, file] of Object.entries(FILES)) current[name] = await get(cfg, file)
  const authoritativePayments = parseStore(current.payments, FILES.payments, 'payments')
  let tombstones = cleanup(parseStore(current.tombstones, FILES.tombstones, 'tombstones'), 'tombstones')
  let notifications = cleanup(parseStore(current.notifications, FILES.notifications, 'notifications'), 'notifications')
  if (options['clear-secondary']) {
    tombstones = { value: { tombstones: [] }, removed: parseStore(current.tombstones, FILES.tombstones, 'tombstones').tombstones.length, preserved: 0 }
    notifications = { value: { notifications: [] }, removed: parseStore(current.notifications, FILES.notifications, 'notifications').notifications.length, preserved: 0 }
  }
  const report = { mode: options['dry-run'] ? 'dry-run' : 'apply', repository: `${cfg.owner}/${cfg.repo}`, branch: cfg.branch, source: { sha256: source.sha256, ...source.summary }, authoritative: Object.fromEntries(Object.entries(current).map(([name, object]) => [name, { sha: object.sha, sha256: hash(object.bytes), bytes: object.bytes.length }])), currentPayments: summarizePayments(authoritativePayments), cleanup: { tombstones: { testRemoved: tombstones.removed, nonTestPreserved: tombstones.preserved }, notifications: { testRemoved: notifications.removed, nonTestPreserved: notifications.preserved } } }
  if (options['dry-run']) { console.log(JSON.stringify(report, null, 2)); return report }
  for (const name of Object.keys(FILES)) if (!options[`expect-${name}-sha`] || options[`expect-${name}-sha`] !== current[name].sha) fail(`Exact --expect-${name}-sha from a fresh dry-run is required and must match`)
  // Re-read every authoritative blob before the first write; compare both blob SHA and bytes.
  for (const [name, file] of Object.entries(FILES)) { const fresh = await get(cfg, file); if (!fresh || fresh.sha !== current[name].sha || hash(fresh.bytes) !== hash(current[name].bytes)) fail(`Version changed before migration: ${file}`) }
  const stamp = new Date().toISOString().replace(/[-:.]/g, '')
  for (const [name, object] of Object.entries(current)) {
    const backup = `${BACKUP_ROOT}/${stamp}/${path.basename(FILES[name])}`
    if (await get(cfg, backup)) fail(`Backup already exists; refusing overwrite: ${backup}`)
    await put(cfg, backup, object.bytes)
    const readback = await get(cfg, backup)
    if (!readback || hash(readback.bytes) !== hash(object.bytes)) fail(`Backup read-back SHA-256 verification failed: ${backup}`)
  }
  // Preserve non-test records. Conditional active-file updates use reviewed blob SHAs. Payments goes last.
  const writes = [['tombstones', jsonBytes(tombstones.value)], ['notifications', jsonBytes(notifications.value)], ['payments', source.bytes]]
  for (const [name, bytes] of writes) await put(cfg, FILES[name], bytes, current[name].sha)
  const final = await get(cfg, FILES.payments)
  if (!final || hash(final.bytes) !== source.sha256) fail('Final payments read-back SHA-256 mismatch')
  const finalSummary = summarizePayments(parseStore(final, FILES.payments, 'payments'), { strict: true })
  for (const [key, expected] of Object.entries(EXPECTED)) if (finalSummary[key] !== expected) fail(`Final reconciliation failed: ${key}`)
  console.log(JSON.stringify({ ...report, backupPrefix: `${BACKUP_ROOT}/${stamp}/`, final: finalSummary, result: 'migration applied and reconciled' }, null, 2))
  return report
}

if (require.main === module) run().catch(error => { console.error(`MIGRATION ABORTED: ${error.message}`); process.exitCode = 1 })
module.exports = { run, parseEnv, loadConfig, isExplicitTestDummy, summarizePayments, FILES, BACKUP_ROOT }
