import type { ProjectionSnapshot } from './payment-status-projection'

export type ProjectionState = { snapshot?: ProjectionSnapshot; nextRefreshAt: number; lease?: string }
type Stored = { state: ProjectionState; etag: string } | null
export type ProjectionStorage = { read(): Promise<Stored>; write(state: ProjectionState, etag?: string): Promise<boolean> }
export const PROJECTION_REFRESH_MS = 15_000
export const PROJECTION_LEASE_MS = 30_000

/** One durable CAS lease across all serverless instances. No provider polling per
 * browser, no financial writes. The publication is fenced by the lease's ETag.
 * Failed or missing source reads keep the last successful snapshot indefinitely. */
export async function refreshProjection(storage: ProjectionStorage, generate: () => Promise<ProjectionSnapshot['bySalesOrder']>, now = Date.now()): Promise<ProjectionSnapshot> {
  const stored = await storage.read()
  const prior = stored?.state.snapshot
  if (stored && stored.state.nextRefreshAt > now) {
    if (prior) return prior
    throw new Error('Payment projection is warming up')
  }
  const lease = crypto.randomUUID()
  const held: ProjectionState = { snapshot: prior, lease, nextRefreshAt: now + PROJECTION_LEASE_MS }
  if (!await storage.write(held, stored?.etag)) {
    const current = await storage.read()
    if (current?.state.snapshot) return current.state.snapshot
    throw new Error('Payment projection refresh in progress')
  }
  const acquired = await storage.read()
  if (acquired?.state.lease !== lease) {
    if (acquired?.state.snapshot) return acquired.state.snapshot
    throw new Error('Payment projection lease changed')
  }
  try {
    const bySalesOrder = await generate()
    // Omitted upstream entries (deleted receipt, ambiguous identity) are not
    // evidence that a previously known order became unpaid. Void is explicit.
    const snapshot: ProjectionSnapshot = { version: (prior?.version || 0) + 1, generatedAt: new Date(now).toISOString(), bySalesOrder: { ...prior?.bySalesOrder, ...bySalesOrder } }
    if (!await storage.write({ snapshot, nextRefreshAt: now + PROJECTION_REFRESH_MS }, acquired.etag)) {
      const current = await storage.read()
      if (current?.state.snapshot) return current.state.snapshot
      throw new Error('Payment projection publication superseded')
    }
    return snapshot
  } catch {
    // Retain the lease deadline as a shared retry backoff after source failure.
    if (prior) return prior
    throw new Error('Payment projection source unavailable')
  }
}
