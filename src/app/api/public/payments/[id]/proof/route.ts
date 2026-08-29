import { NextRequest, NextResponse } from 'next/server'
import { listPayments, paymentAttachments } from '@/lib/payments'
import { createR2ViewUrl } from '@/lib/r2'
import { checkRateLimit, publicApiHeaders } from '@/lib/public-payment-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function safePublicPaymentKey(key: string) {
  if (!key.startsWith('payments/') || key.includes('\\') || key.includes('\0')) return false
  const parts = key.split('/')
  return parts.length > 2 && parts.every((part) => part && part !== '.' && part !== '..' && /^[a-zA-Z0-9._-]+$/.test(part))
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rate = checkRateLimit(request, 'public-payment-proof', 60)
  if (!rate.allowed) return publicApiHeaders(new NextResponse('Too many requests', { status: 429 }))
  const { id } = await context.params
  const payment = (await listPayments()).find((item) => item.id === id)
  const indexText = request.nextUrl.searchParams.get('index') || '0'
  if (!/^\d+$/.test(indexText)) return publicApiHeaders(new NextResponse('Invalid proof index', { status: 400 }))
  const proof = payment ? paymentAttachments(payment)[Number(indexText)] : undefined
  // Membership is checked against the persisted payment record; callers can never supply a key.
  if (!proof?.key || !safePublicPaymentKey(proof.key)) {
    return publicApiHeaders(new NextResponse('Payment proof unavailable', { status: 404 }))
  }
  const response = NextResponse.redirect(createR2ViewUrl(proof.key), 302)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return publicApiHeaders(response)
}