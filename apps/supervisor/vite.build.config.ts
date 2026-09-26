// Minimal build-only config — no server/auth imports, no env-var requirements.
// Used by `npm run build` so Vercel CI succeeds without JALSAKSHI_SUPABASE_* vars.
// The dev server (npm run dev) still uses vite.config.ts which wires up the auth middleware.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.local'] },
  },
})
