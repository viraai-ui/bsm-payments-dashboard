import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { authKey, SESSION_COOKIE_NAME } from './lib/auth-config'

const protectedRoutes = ['/', '/payments', '/settings']
const explicitlyPublicRoutes = ['/submit-payment']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (explicitlyPublicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return NextResponse.next()
  if (!protectedRoutes.some((route) => pathname === route || (route !== '/' && pathname.startsWith(`${route}/`)))) return NextResponse.next()
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return NextResponse.next()
  try {
    await jwtVerify(token, authKey())
  } catch {
    const response = NextResponse.next()
    response.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 })
    return response
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|vehicle-logos).*)'] }
