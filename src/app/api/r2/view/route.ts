import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { createR2ViewUrl, isSafeR2Key } from '@/lib/r2'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireUser(['Admin', 'Operations', 'Media', 'Accounts', 'Database'])
  if (!auth.ok) return auth.response
  const key = request.nextUrl.searchParams.get('key') || ''
  const canViewMediaProof = ['Admin', 'Operations', 'Media', 'Database'].includes(auth.user.role)
  const canViewPayment = ['Admin', 'Accounts'].includes(auth.user.role)
  const allowed = (canViewMediaProof && isSafeR2Key(key, ['media-proof/'])) || (canViewPayment && isSafeR2Key(key, ['payments/']))
  if (!allowed) return new NextResponse('Invalid media key', { status: 400 })
  return NextResponse.redirect(createR2ViewUrl(key), 302)
}
