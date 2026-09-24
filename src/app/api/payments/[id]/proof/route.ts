import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { listPaymentsForUser, paymentAttachments, proofExpiresAt } from '@/lib/payments'
import { readProof } from '@/lib/local-payment-proofs'
import { createR2ViewUrl } from '@/lib/r2'
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(); if (!auth.ok) return auth.response
  const indexText = request.nextUrl.searchParams.get('index') || '0'; if (!/^\d+$/.test(indexText)) return new NextResponse('Invalid proof index', { status: 400 })
  const { id } = await context.params; const payment = (await listPaymentsForUser(auth.user)).find((item) => item.id === id); const proof = payment ? paymentAttachments(payment)[Number(indexText)] : undefined
  if(proof?.key.startsWith('payment-proofs/')||proof?.key.startsWith('payments/')){const ttl=Math.min(60,Math.floor((proofExpiresAt(payment!,proof)-Date.now())/1000));if(ttl<=0)return new NextResponse('Payment proof expired',{status:410,headers:{'Cache-Control':'private, no-store'}});const response=NextResponse.redirect(createR2ViewUrl(proof.key,ttl),302);response.headers.set('Cache-Control','private, no-store, max-age=0');return response}
  const bytes=proof?.key?await readProof(proof.key):null
  if (!proof || !bytes) return new NextResponse('Payment proof unavailable', { status: 404 })
  return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':proof.contentType,'Content-Length':String(bytes.byteLength),'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(proof.name)}`,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}})
}
