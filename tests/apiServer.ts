/**
 * Start the REAL JalSakshi API (development + synthetic dev issuer) on a free
 * port, with its own SQLite in a fresh temp directory. Shared by the T15/T45
 * client suites. cwd = the temp dir: the dev app keeps .data/ (SQLite, issuer
 * key) relative to cwd and there is no .env there, so the repo's real
 * credentials are never used.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });
}

export async function startServer(): Promise<{ base: string; dir: string; child: ChildProcess }> {
  const dir = mkdtempSync(join(tmpdir(), 'jalsakshi-api-'));
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONPATH: ROOT };
  for (const key of Object.keys(env)) if (key.startsWith('JALSAKSHI_')) delete env[key];
  Object.assign(env, { JALSAKSHI_ENVIRONMENT: 'development', JALSAKSHI_TENANT_DATA_MODE: 'synthetic' });
  const child = spawn('python', ['-m', 'uvicorn', 'services.api.app.main:app', '--port', String(port)], { cwd: dir, env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health/live`)).ok) return { base, dir, child };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('API server did not start');
}
