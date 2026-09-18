export const SESSION_COOKIE_NAME = 'bsm_payments_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
export const AUTH_SECRET_FALLBACK = 'bsm-local-only-change-this-secret'

export function authSecret() {
  const configured = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (configured) return configured
  if (process.env.NODE_ENV !== 'production' || process.env.APP_LOCAL_ONLY === 'true') return AUTH_SECRET_FALLBACK
  throw new Error('AUTH_SECRET is required in production (or explicitly set APP_LOCAL_ONLY=true for a local-only preview)')
}

export function authKey() {
  return new TextEncoder().encode(authSecret())
}
