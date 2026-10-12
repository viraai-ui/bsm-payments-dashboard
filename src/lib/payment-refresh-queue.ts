export type RefreshWork = () => Promise<void>

/** Coalesces polling/focus refreshes while guaranteeing that a refresh requested
 * during an in-flight request runs afterwards. The latest work closure wins. */
export function createPaymentRefreshQueue() {
  let queued: RefreshWork | null = null
  let running: Promise<void> | null = null

  const drain = async () => {
    let firstError: unknown
    while (queued) {
      const work = queued
      queued = null
      try { await work() } catch (error) { firstError ??= error }
    }
    if (firstError) throw firstError
  }

  const start = (): Promise<void> => {
    if (!running) {
      running = drain().finally(() => {
        running = null
        // A request can land after drain's final queue check but before this
        // promise settles. Start another drain so that request is never lost.
        if (queued) void start().catch(() => {})
      })
    }
    return running
  }

  return {
    request(work: RefreshWork): Promise<void> {
      queued = work
      return start()
    },
  }
}
