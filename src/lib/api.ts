import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function apiOk<T>(data: T) { return NextResponse.json({ ok: true, data }) }
export function apiError(message: string, status = 400) { return NextResponse.json({ ok: false, error: message }, { status }) }

export function requireWebhookSecret(request: NextRequest) {
  const expected = process.env.ZOHO_WEBHOOK_SECRET
  if (!expected) return process.env.NODE_ENV !== 'production'
  return request.headers.get('x-bsm-webhook-secret') === expected
}
