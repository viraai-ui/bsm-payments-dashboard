import crypto from 'node:crypto'
import type { MediaProofRecord, MediaUpload } from './media-proof'
import type { ShipmentRecord } from './ready-to-ship'
import { isSafeR2Key } from './r2'

export type PublicMediaCapability = {
  v: 1
  orderId: string
  kind: 'packing' | 'loading' | 'builty'
  source: 'r2' | 'github' | 'workdrive'
  value: string
  exp: number
}

const CAPABILITY_TTL_SECONDS = 10 * 60

function secret() {
  const value = process.env.PUBLIC_DATABASE_MEDIA_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.R2_SECRET_ACCESS_KEY || process.env.GITHUB_TOKEN
  if (!value) throw new Error('Public database media signing secret is not configured')
  return value
}

function signature(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function signPublicMediaCapability(input: Omit<PublicMediaCapability, 'v' | 'exp'>, now = Date.now()) {
  validateCapabilityInput(input.source, input.value)
  const payload = Buffer.from(JSON.stringify({ v: 1, ...input, exp: Math.floor(now / 1000) + CAPABILITY_TTL_SECONDS } satisfies PublicMediaCapability)).toString('base64url')
  return `${payload}.${signature(payload)}`
}

export function verifyPublicMediaCapability(token: string, now = Date.now()): PublicMediaCapability | null {
  const [payload, supplied, extra] = token.split('.')
  if (!payload || !supplied || extra) return null
  const expected = signature(payload)
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PublicMediaCapability
    if (value.v !== 1 || !value.orderId || !['packing', 'loading', 'builty'].includes(value.kind) || !['r2', 'github', 'workdrive'].includes(value.source) || value.exp < Math.floor(now / 1000)) return null
    validateCapabilityInput(value.source, value.value)
    return value
  } catch { return null }
}

export function publicMediaUrl(orderId: string, kind: PublicMediaCapability['kind'], file: Pick<MediaUpload, 'url' | 'workdriveUrl' | 'workdriveFileId' | 'r2Key' | 'storageProvider'>) {
  const source = mediaSource(file)
  if (!source) return ''
  const token = signPublicMediaCapability({ orderId, kind, ...source })
  return `/api/public/database/media?token=${encodeURIComponent(token)}`
}

export function transformPublicMediaRecords(records: Record<string, MediaProofRecord>, kind: 'packing' | 'loading') {
  return Object.fromEntries(Object.entries(records).map(([orderId, record]) => [orderId, {
    ...record,
    units: Object.fromEntries(Object.entries(record.units || {}).map(([unitId, unit]) => [unitId, {
      ...unit,
      videos: (unit.videos || []).map((file) => ({ ...file, url: publicMediaUrl(orderId, kind, file), workdriveUrl: null, r2Key: null, workdriveFileId: null })),
      photos: (unit.photos || []).map((file) => ({ ...file, url: publicMediaUrl(orderId, kind, file), workdriveUrl: null, r2Key: null, workdriveFileId: null })),
    }]))
  }])) as Record<string, MediaProofRecord>
}

export function transformPublicShipments(shipments: Record<string, ShipmentRecord>) {
  return Object.fromEntries(Object.entries(shipments).map(([orderId, shipment]) => {
    if (!shipment.lrCopy) return [orderId, shipment]
    const source = shipment.lrCopy.r2Key
      ? { r2Key: shipment.lrCopy.r2Key, url: shipment.lrCopy.url, storageProvider: 'r2' as const }
      : { url: shipment.lrCopy.url }
    return [orderId, { ...shipment, lrCopy: { ...shipment.lrCopy, url: publicMediaUrl(orderId, 'builty', source), r2Key: undefined } }]
  })) as Record<string, ShipmentRecord>
}

export function capabilityIsReferenced(cap: PublicMediaCapability, packing: Record<string, MediaProofRecord>, loading: Record<string, MediaProofRecord>, shipments: Record<string, ShipmentRecord>) {
  const files: Array<Pick<MediaUpload, 'url' | 'workdriveUrl' | 'workdriveFileId' | 'r2Key' | 'storageProvider'>> = []
  if (cap.kind === 'builty') {
    const lr = shipments[cap.orderId]?.lrCopy
    if (lr) files.push({ url: lr.url, r2Key: lr.r2Key, storageProvider: lr.r2Key ? 'r2' : undefined })
  } else {
    const record = (cap.kind === 'packing' ? packing : loading)[cap.orderId]
    for (const unit of Object.values(record?.units || {})) files.push(...(unit.videos || []), ...(unit.photos || []))
  }
  return files.some((file) => { const resolved = mediaSource(file); return resolved?.source === cap.source && resolved.value === cap.value })
}

function mediaSource(file: Pick<MediaUpload, 'url' | 'workdriveUrl' | 'workdriveFileId' | 'r2Key' | 'storageProvider'>) {
  const key = file.r2Key || r2KeyFromUrl(file.url)
  if (key && isSafeR2Key(key, ['media-proof/'])) return { source: 'r2' as const, value: key }
  if (file.workdriveFileId && !file.workdriveFileId.startsWith('github:')) return { source: 'workdrive' as const, value: file.workdriveFileId }
  const url = file.workdriveUrl || file.url || ''
  if (isAllowedGithubUrl(url)) return { source: 'github' as const, value: url }
  return null
}

function r2KeyFromUrl(url?: string | null) {
  if (!url?.startsWith('/api/r2/view?')) return ''
  try { return new URL(url, 'https://local.invalid').searchParams.get('key') || '' } catch { return '' }
}

export function isAllowedGithubUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'raw.githubusercontent.com' && !url.username && !url.password
  } catch { return false }
}

function validateCapabilityInput(source: PublicMediaCapability['source'], value: string) {
  if (!value || value.length > 1200 || /[\0-\x1f\x7f]/.test(value)) throw new Error('Invalid public media reference')
  if (source === 'r2' && !isSafeR2Key(value, ['media-proof/'])) throw new Error('Invalid public media key')
  if (source === 'github' && !isAllowedGithubUrl(value)) throw new Error('Invalid public media URL')
  if (source === 'workdrive' && (!/^[A-Za-z0-9_-]{4,200}$/.test(value) || value.startsWith('github:'))) throw new Error('Invalid WorkDrive file reference')
}
