const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.TEST_PORT || 3222);
const base = `http://127.0.0.1:${port}`;
const password = 'QA-Ownership-123!';
const files = ['auth-users-store.json','payments.json','payment-notifications.json','payment-order-index.json'];
const saved = new Map();
let server;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function snapshot() {
  for (const name of files) {
    const file = path.join(root, 'data', name);
    try { saved.set(file, { exists: true, data: await fs.readFile(file) }); }
    catch (error) { if (error.code === 'ENOENT') saved.set(file, { exists: false }); else throw error; }
  }
}
async function restore() {
  for (const [file, state] of saved) state.exists ? await fs.writeFile(file, state.data) : await fs.rm(file, { force: true });
}
async function waitServer() {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/auth/me')).status) return; } catch {} await sleep(100); }
  throw new Error('test server did not become ready');
}
async function login(username) {
  const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: username, password }) });
  assert.equal(response.status, 200, `${username} login`);
  return response.headers.getSetCookie()[0].split(';')[0];
}

(async () => {
  await snapshot();
  try {
    const now = '2026-09-16T12:00:00.000Z';
    const passwordHash = await bcrypt.hash(password, 4);
    const users = [
      { id: 'self-sales', name: 'Authenticated Sales Name', email: 'self@local', username: 'self-sales-user', role: 'Salesperson', active: true, passwordHash, createdAt: now, updatedAt: now },
      { id: 'forged-sales', name: 'Forged Sales Name', email: 'forged@local', username: 'forged-sales-user', role: 'Salesperson', active: true, passwordHash, createdAt: now, updatedAt: now },
    ];
    const permissions = { Salesperson: ['payments.view','payments.createLinked'], Accounts: [], Admin: [], Viewer: [] };
    await fs.mkdir(path.join(root, 'data'), { recursive: true });
    await fs.writeFile(path.join(root, 'data/auth-users-store.json'), JSON.stringify({ users, permissions }, null, 2));
    await fs.writeFile(path.join(root, 'data/payment-order-index.json'), JSON.stringify({ version: 1, updatedAt: now, orders: [{ id: 'ownership-order', salesOrderNumber: 'OWN-SO-1', customerName: 'Ownership Customer', status: 'Open', orderDate: '2026-09-01', orderTotal: 1000 }] }, null, 2));
    await fs.writeFile(path.join(root, 'data/payments.json'), JSON.stringify({ payments: [] }, null, 2));
    await fs.writeFile(path.join(root, 'data/payment-notifications.json'), JSON.stringify({ notifications: [] }, null, 2));

    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], { cwd: root, stdio: ['ignore','pipe','pipe'], env: { ...process.env, APP_LOCAL_ONLY: 'true', AUTH_SECRET: 'qa-ownership-secret-at-least-32-bytes' } });
    await waitServer();
    const cookie = await login('self-sales-user');
    const body = new FormData();
    body.set('paymentType', 'regular');
    body.set('salesOrderId', 'ownership-order');
    body.set('salesOrderNumber', 'OWN-SO-1');
    body.set('customerName', 'client value is non-authoritative');
    body.set('paymentAmount', '125');
    body.set('paymentMode', 'Bank Transfer');
    body.set('remarks', 'forged-owner regression');
    body.set('ownerUserId', 'forged-sales');
    body.set('addedBy', 'Forged Sales Name');
    body.set('salespersonId', 'forged-sales');
    body.set('salespersonName', 'Forged Sales Name');
    const response = await fetch(base + '/api/payments', { method: 'POST', headers: { cookie }, body });
    const json = await response.json();
    assert.equal(response.status, 200, JSON.stringify(json));
    assert.equal(json.data.payment.ownerUserId, 'self-sales', 'authenticated salesperson ID wins');
    assert.equal(json.data.payment.addedBy, 'self-sales-user', 'authenticated salesperson username wins');
    assert.equal(json.data.payment.createdBy, 'self-sales', 'creator is authenticated salesperson');
    assert.notEqual(json.data.payment.ownerUserId, 'forged-sales');
    assert.notEqual(json.data.payment.addedBy, 'Forged Sales Name');
    const disk = JSON.parse(await fs.readFile(path.join(root, 'data/payments.json'), 'utf8')).payments.find(p => p.id === json.data.payment.id);
    assert.equal(disk.ownerUserId, 'self-sales');
    assert.equal(disk.addedBy, 'self-sales-user');
    console.log('PASS forged salesperson ID/name ignored; authenticated Salesperson self-ownership persisted');
  } finally {
    if (server) server.kill('SIGTERM');
    await sleep(250);
    await restore();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
