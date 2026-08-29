export interface StorageWriter {
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): StorageWriter | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

/** Best-effort cache write. Durable workflow code must never depend on this succeeding. */
export function safeLocalStorageSet(key: string, value: string, storage: StorageWriter | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Best-effort removal used for obsolete/oversized cache migrations. */
export function safeLocalStorageRemove(key: string, storage: StorageWriter | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
