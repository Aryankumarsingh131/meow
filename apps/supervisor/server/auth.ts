import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { Connect } from 'vite'
import type { AuthConfig } from './config.ts'
import { supervisorProfile, supervisorApi, AccessError, DEMO_PROFILE } from './supervisor.ts'

type Session = { accessToken: string; expires: number; isDemo?: boolean; email?: string; userId?: string; teamName?: string }

// Sessions live in an AES-GCM sealed cookie so any serverless instance can read them; the browser cannot.
function seal(session: Session, key: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')
}
function unseal(token: string, key: Buffer): Session | undefined {
  try {
    const raw = Buffer.from(token, 'base64url'), decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const session = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString()) as Session
    return session.expires > Date.now() ? session : undefined
  } catch { return undefined }
}


const DEMO_EMAIL = 'demo.supervisor@jalsakshi.local'

export function createAuthHandler(config: AuthConfig, request = fetch): Connect.NextHandleFunction {
  const cookie = (token: string, maxAge: number) => `js_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${config.secureCookie ? '; Secure' : ''}`
  const demoSession = (res: import('node:http').ServerResponse, reply: (status: number, body: object) => void) => {
    const maxAge = 28800
    res.setHeader('Set-Cookie', cookie(seal({ accessToken: 'demo-token', expires: Date.now() + maxAge * 1000, isDemo: true }, config.sessionKey), maxAge))
    return reply(200, DEMO_PROFILE)
  }
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/auth/') && !req.url?.startsWith('/api/supervisor/')) return next()
    const pathname = req.url.split('?')[0]
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    const reply = (status: number, body: object) => { res.statusCode = status; res.end(JSON.stringify(body)) }
    const token = /(?:^|;\s*)js_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || ''
    if ((req.method === 'GET' && pathname === '/api/auth/session') || req.url.startsWith('/api/supervisor/')) {
      if(req.method !== 'GET') {
        try { if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'Invalid origin.' }) } catch { return reply(403, { error: 'Invalid origin.' }) }
      }
      const session = unseal(token, config.sessionKey)
      if (!session) return reply(401, { error: 'Sign in to continue.' })
      if (session.isDemo) {
        const profile = DEMO_PROFILE
        if (req.url.startsWith('/api/supervisor/')) return await supervisorApi(req, res, config, session.accessToken, profile, request)
        return reply(200, profile)
      }
      try {
        // The photo feed is polled every second. Its API routes check the account themselves
        // (active staff profile; complaint photos for supervisors only), so skip the extra /me round trip.
        if (/^\/api\/supervisor\/photos?(\/|$|\?)/.test(req.url) && req.method === 'GET') {
          return await supervisorApi(req, res, config, session.accessToken, { id: session.userId || '', email: session.email || '', role: 'supervisor', team_id: '', team_name: session.teamName || '', dataMode: config.dataMode }, request)
        }
        // Every request re-checks the account's supervisor role and team with the API.
        const profile = await supervisorProfile(config, session.accessToken, { id: session.userId || '', email: session.email || '' }, request, session.teamName)
        if(req.url.startsWith('/api/supervisor/')) return await supervisorApi(req,res,config,session.accessToken,profile,request)
        return reply(200, profile)
      } catch(error) {
        if(error instanceof AccessError) {
          if (error.status === 401) res.setHeader('Set-Cookie', cookie('', 0))
          return reply(error.status,{error:error.message})
        }
        return reply(503, { error: 'Unable to reach the JalSakshi API. Please try again.' })
      }
    }
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })
    try {
      if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'Invalid origin.' })
    } catch { return reply(403, { error: 'Invalid origin.' }) }
    if (pathname === '/api/auth/logout') {
      // The API's tokens are short-lived and held only in this sealed cookie; clearing it ends the session here.
      res.setHeader('Set-Cookie', cookie('', 0))
      return reply(200, { ok: true })
    }
    if (pathname !== '/api/auth/login') return reply(404, { error: 'Not found.' })
    let input: { email?: unknown; password?: unknown }
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (Buffer.byteLength(body) > 4096) return reply(413, { error: 'Request too large.' })
      }
      input = JSON.parse(body)
      if (!input || typeof input.email !== 'string' || !input.email.trim() || typeof input.password !== 'string' || !input.password) return reply(400, { error: 'Enter your email and password.' })
    } catch { return reply(400, { error: 'Invalid request.' }) }
    const email = (input.email as string).trim().toLowerCase()
    // The synthetic demo workspace is reachable only through its own demo email on a development server.
    if (config.environment === 'development' && email === DEMO_EMAIL) return demoSession(res, reply)
    try {
      const response = await request(`${config.apiUrl}/v1/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password: input.password }), signal: AbortSignal.timeout(20000), redirect: 'error',
      })
      if (response.status === 429) return reply(429, { error: 'Too many sign-in attempts. Please try again later.' })
      if (response.status === 401 || response.status === 422) return reply(401, { error: 'Check your email and password.' })
      if (!response.ok) return reply(503, { error: 'The JalSakshi API could not sign you in. Please try again.' })
      const result = await response.json() as { token?: unknown; role?: unknown; expires_at?: unknown } | null
      if (typeof result?.token !== 'string' || typeof result.expires_at !== 'number') return reply(503, { error: 'Unexpected response from the JalSakshi API.' })
      if (result.role !== 'supervisor') return reply(403, { error: 'This account does not have supervisor access. Ask your administrator to assign a team.' })
      const profile = await supervisorProfile(config, result.token, { id: '', email }, request)
      const maxAge = Math.max(60, Math.min(Math.floor(result.expires_at - Date.now() / 1000), 28800))
      res.setHeader('Set-Cookie', cookie(seal({ accessToken: result.token, expires: Date.now() + maxAge * 1000, email, userId: profile.id, teamName: profile.team_name }, config.sessionKey), maxAge))
      return reply(200, profile)
    } catch(error) {
      if(error instanceof AccessError) return reply(error.status,{error:error.message})
      return reply(503, { error: 'Unable to reach the JalSakshi API. Check that it is running, then try again.' })
    }
  }
}
