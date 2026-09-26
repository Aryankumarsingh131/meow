import { createHash, randomBytes } from 'node:crypto'

// The dashboard talks only to the JalSakshi FastAPI (services/api): sign-in via
// /v1/auth/login, data via the supervisor routes under /v1/staff. It never
// holds Supabase keys or a database URL; the API enforces role, team and every
// workflow rule.
export function readConfig(env: Record<string, string | undefined>) {
  const environment = env.JALSAKSHI_ENVIRONMENT || 'development'
  if (!['development', 'test', 'production'].includes(environment)) throw new Error('JALSAKSHI_ENVIRONMENT must be development, test, or production.')
  const dataMode = env.JALSAKSHI_TENANT_DATA_MODE || 'synthetic'
  if (!['synthetic', 'live'].includes(dataMode)) throw new Error('JALSAKSHI_TENANT_DATA_MODE must be synthetic or live.')
  // Default: the API on this machine (tools/dev_tunnel.sh runs it on :8000).
  const rawApiUrl = env.JALSAKSHI_API_URL || 'http://127.0.0.1:8000'
  let apiUrl: URL
  try { apiUrl = new URL(rawApiUrl) } catch { throw new Error('JALSAKSHI_API_URL must be a plain URL, e.g. http://127.0.0.1:8000') }
  if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) throw new Error('JALSAKSHI_API_URL must be an http(s) origin.')
  if (apiUrl.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(apiUrl.hostname)) throw new Error('JALSAKSHI_API_URL must use HTTPS unless it is on this machine.')
  const sessionSecret = env.JALSAKSHI_SESSION_SECRET
  if (environment === 'production' && (!sessionSecret || sessionSecret.length < 32)) throw new Error('Set JALSAKSHI_SESSION_SECRET to 32+ random characters in production.')
  // Without a secret, a per-process key is used: fine for one dev server, breaks across serverless instances.
  const sessionKey = sessionSecret ? createHash('sha256').update(sessionSecret).digest() : randomBytes(32)
  return { environment, dataMode, apiUrl: apiUrl.origin + apiUrl.pathname.replace(/\/$/, ''), sessionKey, secureCookie: environment === 'production' || env.AUTH_SECURE_COOKIE === 'true' }
}

export type AuthConfig = ReturnType<typeof readConfig>
