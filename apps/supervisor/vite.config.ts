import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { createAuthHandler } from './server/auth.ts'
import { readConfig } from './server/config.ts'

const fsSecurityConfig = { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.local'] } }

export default defineConfig(({ mode, command }) => {
  // During `vite build` (e.g. on Vercel CI) the dev-server auth middleware is
  // not needed and JALSAKSHI_SUPABASE_* vars may not be present — skip it entirely.
  if (command === 'build') {
    return { plugins: [react()], server: fsSecurityConfig }
  }

  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const auth: Plugin = {
    name: 'jalsakshi-supabase-auth',
    // readConfig is only called when the dev/preview server actually starts,
    // never during a production build.
    configureServer(server) {
      server.middlewares.use(createAuthHandler(readConfig(env)))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createAuthHandler(readConfig(env)))
    },
  }
  // JALSAKSHI_* values remain server-only; never expose the database URL to the client.
  return { plugins: [react(), auth], server: fsSecurityConfig }
})

