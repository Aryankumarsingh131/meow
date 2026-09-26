// Standalone app server (Render: `npm start`). Build the dashboard before starting it.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthHandler } from './auth.ts'
import { readConfig } from './config.ts'

const api = createAuthHandler(readConfig(process.env))
const port = Number(process.env.PORT) || 3000
const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function serveDashboard(url: string, method: string, res: import('node:http').ServerResponse) {
  if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; return res.end() }
  let pathname: string
  try {
    const rawPath = decodeURIComponent(url.split('?')[0])
    if (rawPath.includes('\\') || rawPath.split('/').some(segment => segment.startsWith('.'))) {
      res.statusCode = 404; return res.end()
    }
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  }
  catch { res.statusCode = 400; return res.end() }
  if (pathname === '/api' || pathname.startsWith('/api/')) { res.statusCode = 404; return res.end() }

  const file = pathname === '/' || (!extname(pathname) && !pathname.startsWith('/assets/'))
    ? 'index.html'
    : pathname.slice(1)
  const target = resolve(distDir, file)
  const fromDist = relative(distDir, target)
  if (fromDist === '..' || fromDist.startsWith(`..${sep}`) || isAbsolute(fromDist)) {
    res.statusCode = 404; return res.end()
  }
  try {
    const body = await readFile(target)
    res.setHeader('Content-Type', contentTypes[extname(target)] || 'application/octet-stream')
    res.setHeader('Cache-Control', file.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    res.setHeader('Content-Length', body.length)
    res.end(method === 'HEAD' ? undefined : body)
  } catch (error) {
    res.statusCode = ['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code || '') ? 404 : 500
    res.end()
  }
}

createServer((req, res) => {
  if (req.url === '/health') return res.end('ok')
  api(req, res, () => { void serveDashboard(req.url || '/', req.method || 'GET', res) })
}).listen(port, () => console.log(`JalSakshi supervisor API on :${port}`))
