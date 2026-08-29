import crypto from 'node:crypto'

export type R2UploadTarget = {
  key: string
  uploadUrl: string
  publicUrl: string
  expiresAt: string
  storageProvider: 'r2'
}

const REGION = 'auto'
const SERVICE = 's3'
const CORS_ORIGIN = 'https://bsm-payments-dashboard.vercel.app'
const R2_REQUEST_TIMEOUT_MS = 10_000
let corsRepairInFlight: Promise<void> | null = null
let corsReadyUntil = 0
export const R2_VIDEO_MAX_BYTES = 250 * 1024 * 1024
export const R2_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024
export type R2ObjectMetadata = { exists: boolean; contentType: string; contentLength: number; etag: string | null }
const ALLOWED_PREFIXES = ['media-proof/', 'payments/'] as const

/** Allows persisted legacy spaces while rejecting traversal and unsafe bytes. */
export function isSafeR2Key(key: string, prefixes: readonly string[] = ALLOWED_PREFIXES) {
  if (!key || key.length > 900 || !prefixes.some((prefix) => key.startsWith(prefix))) return false
  if (key.includes('\\') || /[\0-\x1f\x7f]/.test(key)) return false
  const segments = key.split('/')
  return segments.length > 1 && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID || ''
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || ''
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || ''
  const bucket = process.env.R2_BUCKET || ''
  const endpoint = (process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).replace(/\/$/, '')
  const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || `${endpoint}/${bucket}`).replace(/\/$/, '')
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) throw new Error('Cloudflare R2 is not configured')
  return { accessKeyId, secretAccessKey, bucket, endpoint, publicBaseUrl }
}

export function r2Configured() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET)
}

export function buildR2Key(parts: { salesOrderNumber: string; machineName: string; machineId: string; originalName: string; mimeType: string; stage?: 'packing' | 'loading' | 'shipment' }) {
  const extension = parts.originalName.includes('.') ? parts.originalName.split('.').pop() : mimeExtension(parts.mimeType)
  const date = new Date().toISOString().slice(0, 10)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return ['media-proof', parts.stage || 'packing', date, safeSegment(parts.salesOrderNumber), safeSegment(parts.machineId), `${safeSegment(parts.machineName)}-${stamp}${extension ? `.${safeSegment(extension)}` : ''}`].join('/')
}

export function createR2UploadTarget(key: string, contentType: string, expiresInSeconds = 900, retentionDays = 30): R2UploadTarget {
  const { accessKeyId, secretAccessKey, bucket, endpoint } = r2Config()
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(endpoint).host
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const canonicalUri = `/${bucket}/${encodedKey}`
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'content-type;host',
  }
  const canonicalQuery = canonicalQueryString(query)
  const canonicalHeaders = `content-type:${contentType || 'application/octet-stream'}\nhost:${host}\n`
  const canonicalRequest = ['PUT', canonicalUri, canonicalQuery, canonicalHeaders, 'content-type;host', 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmacHex(signingKey(secretAccessKey, dateStamp), stringToSign)
  const uploadUrl = `${endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
  return { key, uploadUrl, publicUrl: `/api/r2/view?key=${encodeURIComponent(key)}`, expiresAt: mediaExpiresAt(now, retentionDays), storageProvider: 'r2' }
}

export async function uploadBufferToR2(key: string, contentType: string, buffer: Buffer) {
  const target = createR2UploadTarget(key, contentType)
  const response = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType || 'application/octet-stream' },
    body: new Uint8Array(buffer),
    cache: 'no-store',
    signal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Cloudflare R2 upload failed: HTTP ${response.status}`)
  return target
}

export async function ensureR2Cors() {
  if (corsRepairInFlight) return corsRepairInFlight
  corsRepairInFlight = putR2Cors().finally(() => { corsRepairInFlight = null })
  return corsRepairInFlight
}

async function putR2Cors() {
  const { accessKeyId, secretAccessKey, bucket, endpoint } = r2Config()
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(endpoint).host
  const canonicalUri = `/${bucket}`
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const body = `<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><CORSRule><AllowedOrigin>https://dispatch.bsmindia.com</AllowedOrigin><AllowedOrigin>https://bsm-dispatch-dashboard.vercel.app</AllowedOrigin><AllowedOrigin>https://bsm-payments-dashboard.vercel.app</AllowedOrigin><AllowedOrigin>http://localhost:3000</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`
  const payloadHash = sha256Hex(body)
  const canonicalQuery = 'cors='
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['PUT', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmacHex(signingKey(secretAccessKey, dateStamp), stringToSign)
  const response = await fetch(`${endpoint}${canonicalUri}?cors`, {
    method: 'PUT',
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'content-type': 'application/xml',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Cloudflare R2 CORS setup failed: HTTP ${response.status}`)
}

export async function checkR2BrowserCors(uploadUrl: string) {
  try {
    const response = await fetch(uploadUrl, {
      method: 'OPTIONS',
      headers: { Origin: CORS_ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
      cache: 'no-store',
      signal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS),
    })
    const allowedOrigin = response.headers.get('access-control-allow-origin')
    const allowedMethods = response.headers.get('access-control-allow-methods') || ''
    const corsReady = response.ok && (allowedOrigin === CORS_ORIGIN || allowedOrigin === '*') && allowedMethods.split(',').some((method) => method.trim().toUpperCase() === 'PUT')
    if (corsReady) return { corsReady: true as const }
    return { corsReady: false as const, corsError: `Cloudflare R2 browser upload preflight failed (HTTP ${response.status}; origin=${allowedOrigin || 'missing'}; methods=${allowedMethods || 'missing'}).` }
  } catch (error) {
    return { corsReady: false as const, corsError: `Cloudflare R2 browser upload preflight failed: ${error instanceof Error ? error.message : 'network error'}` }
  }
}

export async function ensureR2BrowserCors(uploadUrl: string) {
  if (corsReadyUntil > Date.now()) return { corsReady: true as const, cached: true as const }
  const initial = await checkR2BrowserCors(uploadUrl)
  if (initial.corsReady) { corsReadyUntil = Date.now() + 5 * 60_000; return initial }
  await ensureR2Cors()
  const repaired = await checkR2BrowserCors(uploadUrl)
  if (repaired.corsReady) corsReadyUntil = Date.now() + 5 * 60_000
  return repaired
}

export function createR2ViewUrl(key: string, expiresInSeconds = 3600) {
  return createR2SignedUrl(key, 'GET', expiresInSeconds)
}

/** HEAD signatures are method-bound by AWS SigV4 and cannot reuse a GET URL. */
export function createR2HeadUrl(key: string, expiresInSeconds = 3600) {
  return createR2SignedUrl(key, 'HEAD', expiresInSeconds)
}

function createR2SignedUrl(key: string, method: 'GET' | 'HEAD', expiresInSeconds: number) {
  const { accessKeyId, secretAccessKey, bucket, endpoint } = r2Config()
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(endpoint).host
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const canonicalUri = `/${bucket}/${encodedKey}`
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = canonicalQueryString(query)
  const canonicalHeaders = `host:${host}\n`
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmacHex(signingKey(secretAccessKey, dateStamp), stringToSign)
  return `${endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

export async function headR2Object(key: string): Promise<R2ObjectMetadata> {
  if (!isSafeR2Key(key)) throw new Error('Invalid R2 object key')
  const response = await fetch(createR2SignedUrl(key, 'HEAD', 60), { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS) })
  if (response.status === 404) return { exists: false, contentType: '', contentLength: 0, etag: null }
  if (!response.ok) throw new Error(`Cloudflare R2 HEAD failed: HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length'))
  return { exists: true, contentType: (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), contentLength: Number.isSafeInteger(length) && length >= 0 ? length : -1, etag: response.headers.get('etag') }
}

export async function verifyR2Object(key: string, options: { prefixes: readonly string[]; expectedTypes: readonly string[]; maxBytes: number; order?: string; machineId?: string; stage?: string }) {
  if (!isSafeR2Key(key, options.prefixes)) throw new Error('Invalid R2 object key')
  const segments = key.split('/')
  if (options.stage && segments[1] !== options.stage) throw new Error('Upload key does not match this workflow stage')
  if (options.order && !segments.includes(safeSegment(options.order))) throw new Error('Upload key does not match this sales order')
  if (options.machineId && !segments.includes(safeSegment(options.machineId))) throw new Error('Upload key does not match this machine')
  const metadata = await headR2Object(key)
  if (!metadata.exists) throw new Error('Uploaded object was not found')
  if (metadata.contentLength <= 0 || metadata.contentLength > options.maxBytes) throw new Error('Uploaded object exceeds the allowed size or is empty')
  if (!options.expectedTypes.some((type) => type.endsWith('/') ? metadata.contentType.startsWith(type) : metadata.contentType === type)) throw new Error('Uploaded object has an unsupported content type')
  return metadata
}

export async function deleteR2Object(key: string | null | undefined) {
  if (!key) return false
  if (!isSafeR2Key(key)) throw new Error('Invalid R2 object key')
  const { accessKeyId, secretAccessKey, bucket, endpoint } = r2Config()
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(endpoint).host
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const canonicalUri = `/${bucket}/${encodedKey}`
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`
  const canonicalRequest = ['DELETE', canonicalUri, '', canonicalHeaders, 'host;x-amz-content-sha256;x-amz-date', 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmacHex(signingKey(secretAccessKey, dateStamp), stringToSign)
  const response = await fetch(`${endpoint}${canonicalUri}`, {
    method: 'DELETE',
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amzDate,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS),
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Cloudflare R2 delete failed: HTTP ${response.status}`)
  return true
}

function mediaExpiresAt(now: Date, days = 30) { return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString() }
function safeSegment(value: string) { return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'video' }
function mimeExtension(type: string) { if (type.includes('mp4')) return 'mp4'; if (type.includes('quicktime')) return 'mov'; if (type.includes('webm')) return 'webm'; return '' }
function toAmzDate(date: Date) { return date.toISOString().replace(/[:-]|\.\d{3}/g, '') }
function sha256Hex(value: string) { return crypto.createHash('sha256').update(value).digest('hex') }
function hmac(key: crypto.BinaryLike, value: string) { return crypto.createHmac('sha256', key).update(value).digest() }
function hmacHex(key: crypto.BinaryLike, value: string) { return crypto.createHmac('sha256', key).update(value).digest('hex') }
function signingKey(secret: string, dateStamp: string) { return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), REGION), SERVICE), 'aws4_request') }
function canonicalQueryString(query: Record<string, string>) { return Object.keys(query).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`).join('&') }
