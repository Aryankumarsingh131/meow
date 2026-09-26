// Vercel entry: serves /api/auth/* and /api/supervisor/* with the same handler the Vite dev server uses.
// Plain JS so Node's native type stripping loads ../server/*.ts (included via vercel.json includeFiles).
import { createAuthHandler } from '../server/auth.ts'
import { readConfig } from '../server/config.ts'

let handler
export default function api(req, res) {
  const url = new URL(req.url, 'http://local'), path = url.searchParams.get('__path')
  // Drop the rewrite's params (Vercel may also echo the named :path param) and restore the original path.
  if (path !== null) { url.searchParams.delete('__path'); url.searchParams.delete('path'); req.url = `/api/${path}${url.search}` }
  try { handler ??= createAuthHandler(readConfig(process.env)) } catch (error) {
    res.statusCode = 500; res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ error: `Server is not configured: ${error.message}` }))
  }
  return handler(req, res, () => { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found.' })) })
}
