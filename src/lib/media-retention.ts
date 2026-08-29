import type { MediaProofStore, MediaUpload } from './media-proof'
import { deleteGithubMediaFile } from './github-media'
import { deleteR2Object } from './r2'
import { deleteWorkDriveFile } from './workdrive'

export const MEDIA_RETENTION_DAYS = 30
const RETENTION_MS = MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000

export type MediaRetentionCleanupResult = {
  removedFiles: number
  touchedOrders: number
  errors: string[]
}

export function mediaExpiresAt(uploadedAt: string) {
  const uploaded = new Date(uploadedAt).getTime()
  if (!Number.isFinite(uploaded)) return new Date(Date.now() + RETENTION_MS).toISOString()
  return new Date(uploaded + RETENTION_MS).toISOString()
}

export function normalizeMediaUploadRetention(file: MediaUpload): MediaUpload {
  return { ...file, expiresAt: file.expiresAt || mediaExpiresAt(file.uploadedAt) }
}

export function isMediaExpired(file: MediaUpload, now = Date.now()) {
  const expiresAt = file.expiresAt || mediaExpiresAt(file.uploadedAt)
  return new Date(expiresAt).getTime() <= now
}

export async function cleanupExpiredMediaProofStore(store: MediaProofStore, now = Date.now()): Promise<{ store: MediaProofStore; changed: boolean; result: MediaRetentionCleanupResult }> {
  let changed = false
  const result: MediaRetentionCleanupResult = { removedFiles: 0, touchedOrders: 0, errors: [] }
  const next: MediaProofStore = { records: {} }

  for (const [orderId, record] of Object.entries(store.records || {})) {
    let orderTouched = false
    const units: typeof record.units = {}
    for (const [machineId, unit] of Object.entries(record.units || {})) {
      const photos = [] as MediaUpload[]
      const videos = [] as MediaUpload[]
      for (const file of [...(unit.photos || []), ...(unit.videos || [])]) {
        const normalized = normalizeMediaUploadRetention(file)
        const expired = isMediaExpired(normalized, now)
        if (!file.expiresAt) changed = true
        if (expired) {
          const deletionError = await deleteStoredMedia(normalized)
          if (!deletionError) {
            orderTouched = true
            changed = true
            result.removedFiles += 1
            continue
          }
          result.errors.push(`${normalized.r2Key || normalized.id}: ${deletionError}`)
        }
        if (normalized.kind === 'photo') photos.push(normalized)
        else videos.push(normalized)
      }
      if (photos.length || videos.length) units[machineId] = { photos, videos }
      else if ((unit.photos || []).length || (unit.videos || []).length) changed = true
    }
    if (orderTouched) result.touchedOrders += 1
    next.records[orderId] = { ...record, units }
  }

  return { store: next, changed, result }
}

async function deleteStoredMedia(file: MediaUpload) {
  try {
    if (file.storageProvider === 'r2' || file.r2Key) await deleteR2Object(file.r2Key)
    else if (file.workdriveFileId) await deleteWorkDriveFile(file.workdriveFileId)
    else if (file.url || file.workdriveFileId) await deleteGithubMediaFile(file.workdriveFileId || file.url)
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not delete expired media file'
  }
  return null
}
