import { Pool, type PoolClient } from 'pg'
import type { Order } from '@/types/domain'

export type SerialAllocationStatus = 'allocated_pending' | 'generated' | 'processed' | 'dispatched' | 'voided'
export type SerialAllocation = { machineUnitId: string; serialNumber: string; qrToken: string; status: SerialAllocationStatus }
export type LedgerInsert = { serial: bigint; identity: string; orderId: string; salesOrderNumber: string; machineUnitId: string; idempotencyKey: string; qrToken: string; source: string; metadata: Record<string, unknown> }
export interface SerialTransaction {
  maximum(): Promise<bigint>
  find(identity: string, idempotencyKey: string): Promise<bigint | undefined>
  insert(row: LedgerInsert): Promise<void>
  setCounter(value: bigint): Promise<void>
}

export const SERIAL_FLOOR = BigInt(26270758)
const LOCK_KEY = 0x42534d
let pool: Pool | undefined
let schemaReady: Promise<void> | undefined

export function serialDatabaseConfigured() { return Boolean(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL) }
const LEGAL_TRANSITIONS: Record<SerialAllocationStatus, SerialAllocationStatus[]> = {
  allocated_pending: ['generated', 'processed', 'voided'], generated: ['processed', 'voided'],
  processed: ['dispatched', 'voided'], dispatched: [], voided: [],
}
export function isLegalSerialTransition(from: SerialAllocationStatus, to: SerialAllocationStatus) {
  return from === to || LEGAL_TRANSITIONS[from].includes(to)
}
function databaseUrl() { return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '' }
function db() {
  const url = databaseUrl()
  if (!url) throw new Error('Authoritative serial database is not configured')
  return pool ||= new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 })
}

export async function ensureSerialLedgerSchema() {
  schemaReady ||= (async () => {
    const client = await db().connect()
    try { await client.query(`
      create table if not exists serial_counters(namespace text primary key,last_serial bigint not null,updated_at timestamptz not null default now(),constraint serial_counters_nonnegative check(last_serial>=0));
      create table if not exists serial_allocations(serial_number bigint primary key,namespace text not null default 'dashboard',machine_identity text not null unique,order_id text not null,sales_order_number text not null default '',machine_unit_id text not null,idempotency_key text not null unique,qr_token text not null unique,status text not null,source text not null default 'dashboard',allocated_at timestamptz not null default now(),generated_at timestamptz,processed_at timestamptz,dispatched_at timestamptz,voided_at timestamptz,updated_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb,constraint serial_allocations_status_check check(status in ('allocated_pending','generated','processed','dispatched','voided')));
      create table if not exists serial_allocation_events(id bigserial primary key,serial_number bigint not null references serial_allocations(serial_number),event_type text not null,from_status text,to_status text,detail jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
      create table if not exists serial_workflow_mirrors(machine_identity text primary key,serial_number bigint not null references serial_allocations(serial_number),state text not null default 'pending',attempts integer not null default 0,last_error text,updated_at timestamptz not null default now(),constraint serial_workflow_mirrors_state_check check(state in ('pending','mirrored')));
      create index if not exists serial_allocations_order_idx on serial_allocations(order_id); create index if not exists serial_allocations_status_idx on serial_allocations(status); create index if not exists serial_workflow_mirrors_pending_idx on serial_workflow_mirrors(state) where state='pending';
      insert into serial_counters(namespace,last_serial) values('dashboard',${SERIAL_FLOOR}) on conflict do nothing;
    `) } finally { client.release() }
  })().catch(error => { schemaReady = undefined; throw error })
  return schemaReady
}

/** Database-independent allocation core. The caller supplies one exclusive, atomic transaction. */
export async function allocateInTransaction(tx: SerialTransaction, orderId: string, machineIds: string[], order?: Order) {
  let next = await tx.maximum()
  const allocated: Record<string, string> = {}
  for (const machineUnitId of Array.from(new Set(machineIds.filter(Boolean)))) {
    const identity = `${orderId}:${machineUnitId}`, idempotencyKey = `serial:${identity}`
    const existing = await tx.find(identity, idempotencyKey)
    if (existing !== undefined) { allocated[machineUnitId] = existing.toString(); continue }
    const source = order?.machines?.find(machine => machine.id === machineUnitId)
    const preserved = String(source?.serialNumber || '').trim()
    const serial = preserved && /^\d+$/.test(preserved) ? BigInt(preserved) : ++next
    const qrToken = String(source?.qrToken || serial)
    await tx.insert({ serial, identity, orderId, salesOrderNumber: order?.salesOrderNumber || '', machineUnitId, idempotencyKey, qrToken, source: preserved ? 'preserved' : 'dashboard', metadata: { lineItemId: source?.lineItemId || '' } })
    if (serial > next) next = serial
    allocated[machineUnitId] = serial.toString()
  }
  await tx.setCounter(next)
  return allocated
}

function pgTransaction(client: PoolClient): SerialTransaction {
  return {
    async maximum() {
      const result = await client.query<{ maximum: string }>(`select greatest($1::bigint,coalesce((select last_serial from serial_counters where namespace='dashboard'),$1::bigint),coalesce((select max(serial_number) from serial_allocations where namespace='dashboard'),$1::bigint),coalesce((select max(serial_number::bigint) from machines where serial_number ~ '^[0-9]+$' and serial_number::bigint >= $1),$1::bigint))::text maximum`, [SERIAL_FLOOR.toString()])
      return BigInt(result.rows[0].maximum)
    },
    async find(identity, key) { const r = await client.query<{ serial_number: string }>('select serial_number::text from serial_allocations where machine_identity=$1 or idempotency_key=$2', [identity, key]); return r.rowCount ? BigInt(r.rows[0].serial_number) : undefined },
    async insert(row) {
      await client.query(`insert into serial_allocations(serial_number,machine_identity,order_id,sales_order_number,machine_unit_id,idempotency_key,qr_token,status,source,metadata) values($1,$2,$3,$4,$5,$6,$7,'allocated_pending',$8,$9)`, [row.serial.toString(),row.identity,row.orderId,row.salesOrderNumber,row.machineUnitId,row.idempotencyKey,row.qrToken,row.source,JSON.stringify(row.metadata)])
      await client.query(`insert into serial_allocation_events(serial_number,event_type,to_status,detail) values($1,'allocated','allocated_pending',$2)`, [row.serial.toString(),JSON.stringify({ orderId: row.orderId, machineUnitId: row.machineUnitId })])
      await client.query(`insert into serial_workflow_mirrors(machine_identity,serial_number,state) values($1,$2,'pending') on conflict(machine_identity) do update set serial_number=excluded.serial_number,state='pending',updated_at=now()`, [row.identity,row.serial.toString()])
    },
    async setCounter(value) { await client.query(`update serial_counters set last_serial=greatest(last_serial,$1),updated_at=now() where namespace='dashboard'`, [value.toString()]) },
  }
}

/** Whole ordered batch commits atomically. DB errors propagate; no legacy fallback is attempted. */
export async function allocateSerialBatch(orderId: string, machineIds: string[], order?: Order): Promise<Record<string, string>> {
  const uniqueIds = Array.from(new Set(machineIds.filter(Boolean))); if (!uniqueIds.length) return {}
  await ensureSerialLedgerSchema()
  const client = await db().connect()
  try { await client.query('begin'); await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]); const result = await allocateInTransaction(pgTransaction(client), orderId, uniqueIds, order); await client.query('commit'); return result }
  catch (error) { await client.query('rollback').catch(() => undefined); throw error }
  finally { client.release() }
}

export async function markWorkflowMirrored(orderId: string, machineIds: string[]) {
  if (!serialDatabaseConfigured() || !machineIds.length) return
  await ensureSerialLedgerSchema()
  await db().query(`update serial_workflow_mirrors set state='mirrored',attempts=attempts+1,last_error=null,updated_at=now() where machine_identity=any($1::text[])`, [machineIds.map(id => `${orderId}:${id}`)])
}
export async function markWorkflowMirrorFailed(orderId: string, machineIds: string[], error: unknown) {
  if (!serialDatabaseConfigured() || !machineIds.length) return
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
  try {
    await db().query(`update serial_workflow_mirrors set state='pending',attempts=attempts+1,last_error=$2,updated_at=now() where machine_identity=any($1::text[])`, [machineIds.map(id => `${orderId}:${id}`), message])
  } catch (queueError) {
    console.error('Failed to persist workflow mirror failure', { orderId, machineIds, queueError })
  }
}

export async function markSerialStatus(machineIdentity: string, status: SerialAllocationStatus, detail: Record<string, unknown> = {}) {
  await ensureSerialLedgerSchema(); const timestampColumn = status === 'generated' ? 'generated_at' : status === 'processed' ? 'processed_at' : status === 'dispatched' ? 'dispatched_at' : status === 'voided' ? 'voided_at' : null; const client = await db().connect()
  try { await client.query('begin'); const current = await client.query<{serial_number:string;status:string}>('select serial_number::text,status from serial_allocations where machine_identity=$1 for update',[machineIdentity]); if(!current.rowCount) throw new Error(`Serial allocation not found for ${machineIdentity}`); const row=current.rows[0]; if(row.status===status){await client.query('commit');return} if(!isLegalSerialTransition(row.status as SerialAllocationStatus,status)) throw new Error(`Illegal serial transition: ${row.status} -> ${status}`); await client.query(`update serial_allocations set status=$2,updated_at=now()${timestampColumn ? `,${timestampColumn}=coalesce(${timestampColumn},now())` : ''} where machine_identity=$1`,[machineIdentity,status]); await client.query('insert into serial_allocation_events(serial_number,event_type,from_status,to_status,detail) values($1,$2,$3,$4,$5)',[row.serial_number,'status_changed',row.status,status,JSON.stringify(detail)]); await client.query('commit') } catch(error){await client.query('rollback').catch(()=>undefined);throw error} finally{client.release()}
}

export function findUnexplainedSerials(rows: Array<{ serial_number: string }>, floor = SERIAL_FLOOR) {
  const max = rows.length ? rows.reduce((value, row) => BigInt(row.serial_number) > value ? BigInt(row.serial_number) : value, floor) : floor
  const present = new Set(rows.map(row => BigInt(row.serial_number)))
  const unexplained: string[] = []
  for (let n = floor + BigInt(1); n <= max; n++) if (!present.has(n)) unexplained.push(n.toString())
  return { unexplained, max: max.toString() }
}

export async function detectSerialGaps() {
  await ensureSerialLedgerSchema(); const result=await db().query<{serial_number:string;status:string;machine_identity:string}>(`select serial_number::text,status,machine_identity from serial_allocations where namespace='dashboard' order by serial_number`); const rows=result.rows; return {...findUnexplainedSerials(rows),rows}
}

export async function serialLedgerHealth() {
  await ensureSerialLedgerSchema()
  const [counter, allocations, mirrors] = await Promise.all([
    db().query<{ last_serial: string }>(`select last_serial::text from serial_counters where namespace='dashboard'`),
    db().query<{ serial_number: string; status: SerialAllocationStatus }>(`select serial_number::text,status from serial_allocations where namespace='dashboard' order by serial_number`),
    db().query<{ state: string; count: string; oldest: string | null }>(`select state,count(*)::text,min(updated_at)::text oldest from serial_workflow_mirrors group by state`),
  ])
  const gap = findUnexplainedSerials(allocations.rows)
  const lastSerial = counter.rows[0]?.last_serial || SERIAL_FLOOR.toString()
  const byStatus = Object.fromEntries(['allocated_pending','generated','processed','dispatched','voided'].map(status => [status, allocations.rows.filter(row => row.status === status).length]))
  const pending = mirrors.rows.find(row => row.state === 'pending')
  return { configured: true, counter: lastSerial, maximum: gap.max, counterMatchesMaximum: lastSerial === gap.max, unexplainedGaps: gap.unexplained, allocationCount: allocations.rowCount || 0, byStatus, pendingMirrors: Number(pending?.count || 0), oldestPendingMirrorAt: pending?.oldest || null }
}
