import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const cookieName = 'bsm_payments_session'
const accountsOnly = '/payments'
const protectedRoutes = ['/', '/payments']
const explicitlyPublicRoutes = ['/submit-payment']

function secretKey() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'bsm-payments-dashboard-local-secret-change-me'
  return new TextEncoder().encode(secret)
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (explicitlyPublicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return NextResponse.next()
  if (!protectedRoutes.some((route) => pathname === route || (route !== '/' && pathname.startsWith(`${route}/`)))) return NextResponse.next()
  const token = request.cookies.get(cookieName)?.value
  if (!token) return NextResponse.next()
  try {
    const { payload } = await jwtVerify(token, secretKey())

    if (payload.role === 'Accounts' && pathname !== accountsOnly) {
      return NextResponse.redirect(new URL(accountsOnly, request.url))
    }

  } catch {
    const response = NextResponse.next()
    response.cookies.set(cookieName, '', { path: '/', maxAge: 0 })
    return response
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|vehicle-logos).*)'] }
