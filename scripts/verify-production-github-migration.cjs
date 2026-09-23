#!/usr/bin/env node
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const migration = require('./migrate-production-github-payments.cjs')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'github-migration-test-'))
const envFile = path.join(temp, 'prod.env')
fs.writeFileSync(envFile, "GITHUB_OWNER=acme\nGITHUB_TOKEN='mock-secret'\nGITHUB_DATA_REPO=private-data\nGITHUB_DATA_BRANCH=production\nGITHUB_REPO=source-app\n", { mode: 0o600 })
// Reproduces the loadEnvFile pitfall: a pre-existing empty name remains empty. Our parser must override it.
process.env.GITHUB_OWNER = ''
assert.equal(migration.loadConfig(envFile).owner, 'acme')
assert.equal(migration.parseEnv('A="x\\ny"\nB=plain # note\n').A, 'x\ny')

const localPayments = fs.readFileSync(path.join(__dirname, '../data/payments.json'))
const files = new Map([
  ['data/payments.json', { bytes: Buffer.from('{"payments":[]}\n'), sha: 'sha-payments-reviewed' }],
  ['data/payment-tombstones.json', { bytes: Buffer.from(JSON.stringify({ tombstones: [{ id: 'qa-dummy-1' }, { id: 'real-1', reason: 'customer correction' }] })), sha: 'sha-tombstones-reviewed' }],
  ['data/payment-notifications.json', { bytes: Buffer.from(JSON.stringify({ notifications: [{ id: 'test-note-1' }, { id: 'note-real-1', type: 'payment' }] })), sha: 'sha-notifications-reviewed' }],
])
const requests = []
const sha = bytes => crypto.createHash('sha1').update(bytes).digest('hex')
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); requests.push({ url: u.href, method: init.method || 'GET', body: init.body })
  assert.equal(u.pathname.startsWith('/repos/acme/private-data/'), true, 'request escaped dedicated data repository')
  const marker = '/contents/'
  if (!u.pathname.includes(marker)) throw new Error(`Unexpected mock URL: ${u}`)
  const key = u.pathname.slice(u.pathname.indexOf(marker) + marker.length).split('/').map(decodeURIComponent).join('/')
  if ((init.method || 'GET') === 'PUT') {
    const body = JSON.parse(init.body), existing = files.get(key)
    assert.equal(body.branch, 'production')
    if ((existing && !body.sha) || (!existing && body.sha) || (existing && existing.sha !== body.sha)) return json({ message: 'conflict' }, 409)
    const bytes = Buffer.from(body.content, 'base64'), object = { bytes, sha: sha(bytes) }
    files.set(key, object); return json({ content: { sha: object.sha } }, 201)
  }
  assert.equal(u.searchParams.get('ref'), 'production')
  const object = files.get(key)
  return object ? json({ type: 'file', sha: object.sha, encoding: 'base64', content: object.bytes.toString('base64') }) : json({}, 404)
}

async function main() {
  const originalLog = console.log, reports = []
  console.log = text => reports.push(JSON.parse(text))
  try {
    await migration.run(['--env-file', envFile, '--dry-run'])
    assert.equal(requests.some(r => r.method === 'PUT'), false, 'dry run wrote data')
    const dry = reports.at(-1)
    assert.equal(dry.cleanup.tombstones.testRemoved, 1); assert.equal(dry.cleanup.tombstones.nonTestPreserved, 1)
    assert.equal(dry.cleanup.notifications.testRemoved, 1); assert.equal(dry.cleanup.notifications.nonTestPreserved, 1)
    await assert.rejects(migration.run(['--env-file', envFile, '--apply', '--expect-payments-sha', 'wrong', '--expect-tombstones-sha', dry.authoritative.tombstones.sha, '--expect-notifications-sha', dry.authoritative.notifications.sha]), /fresh dry-run/)
    assert.equal(requests.some(r => r.method === 'PUT'), false, 'bad expected SHA wrote data')
    await migration.run(['--env-file', envFile, '--apply', '--expect-payments-sha', dry.authoritative.payments.sha, '--expect-tombstones-sha', dry.authoritative.tombstones.sha, '--expect-notifications-sha', dry.authoritative.notifications.sha])
    const final = JSON.parse(files.get('data/payments.json').bytes)
    assert.equal(final.payments.length, 106); assert.equal(files.get('data/payments.json').bytes.equals(localPayments), true)
    assert.deepEqual(JSON.parse(files.get('data/payment-tombstones.json').bytes).tombstones.map(x => x.id), ['real-1'])
    assert.deepEqual(JSON.parse(files.get('data/payment-notifications.json').bytes).notifications.map(x => x.id), ['note-real-1'])
    const backupKeys = [...files.keys()].filter(k => k.startsWith(`${migration.BACKUP_ROOT}/`))
    assert.equal(backupKeys.length, 3); assert.equal(new Set(backupKeys.map(k => k.split('/').slice(0, -1).join('/'))).size, 1)
    const putKeys = requests.filter(r => r.method === 'PUT').map(r => decodeURIComponent(new URL(r.url).pathname.split('/contents/')[1]))
    assert.equal(putKeys.at(-1), 'data/payments.json', 'payments was not written last')
    assert.equal(requests.some(r => /users|proofs|push|order|source-app/i.test(new URL(r.url).pathname)), false, 'forbidden path/repo touched')
  } finally { console.log = originalLog; fs.rmSync(temp, { recursive: true, force: true }) }
  console.log('PASS GitHub migration: env override, dry-run, exact SHAs, create-only backups, preservation, payments-last, reconciliation, path isolation')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
