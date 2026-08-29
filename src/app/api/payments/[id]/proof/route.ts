import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { listPayments, paymentAttachments } from '@/lib/payments'
import { createR2ViewUrl, isSafeR2Key } from '@/lib/r2'
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(['Admin', 'Accounts']); if (!auth.ok) return auth.response
  const indexText = request.nextUrl.searchParams.get('index') || '0'; if (!/^\d+$/.test(indexText)) return new NextResponse('Invalid proof index', { status: 400 })
  const { id } = await context.params; const payment = (await listPayments()).find((item) => item.id === id); const proof = payment ? paymentAttachments(payment)[Number(indexText)] : undefined
  if (!proof?.key || !isSafeR2Key(proof.key, ['payments/'])) return new NextResponse('Payment proof unavailable', { status: 404 })
  const response = NextResponse.redirect(createR2ViewUrl(proof.key), 302); response.headers.set('Cache-Control', 'private, no-store, max-age=0'); response.headers.set('Referrer-Policy', 'no-referrer'); return response
}
