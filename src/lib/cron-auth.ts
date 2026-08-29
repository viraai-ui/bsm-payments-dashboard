import crypto from 'node:crypto'

/** Fail-closed cron authentication. Vercel sends CRON_SECRET as a Bearer token.
 * Never trust x-vercel-cron: it is a client-controlled header outside Vercel's edge. */
export function isAuthorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET || ''
  const supplied = request.headers.get('authorization') || ''
  if (!secret || secret.length < 16) return false
  const expected = `Bearer ${secret}`
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}
