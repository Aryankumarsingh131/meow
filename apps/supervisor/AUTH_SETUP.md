# Authentication and database setup

## Local environment

`.env`, `.env.local`, and `*.local` are Git-ignored and denied by Vite's file server. Use plain values, without Markdown wrappers. Process environment values take precedence over local files.

- `JALSAKSHI_ENVIRONMENT=development`: localhost runtime; production enables Secure cookies and requires HTTPS.
- `JALSAKSHI_TENANT_DATA_MODE=synthetic`: persisted synthetic team data, clearly labelled in the UI. Live mode is rejected at startup.
- `JALSAKSHI_SUPABASE_URL`: project HTTPS URL.
- `JALSAKSHI_SUPABASE_PUBLISHABLE_KEY`: publishable/anon key, never a service-role key.
- `JALSAKSHI_DATABASE_URL`: used only by administrative migrations and fixture scripts, never by the request-serving backend. Use the IPv4 session pooler, `postgres.PROJECT_REF` username, port 5432, and `sslmode=require`. URL-encode password characters. Scripts verify TLS using Supabase's published CA.

The database password supplied in chat needs rotation through Supabase's dashboard, followed by a local `.env` update. The application has not rotated it.

## Accounts and sessions

The provisioned demo supervisor belongs to **Riverside Demo District**, with synthetic records. Its credentials are stored in `.demo-credentials.local`, not tracked documentation. `npm run demo:seed` provisions a fresh demo only; it refuses to replace an existing account. It also creates a synthetic worker for sample provenance. No invitation or confirmation emails are sent.

For other users, an administrator must create a confirmed Supabase Auth user, a team, and a `public.profiles` row containing that user's ID, `role='supervisor'`, and the assigned `team_id`. Users cannot grant themselves a role. Workers cannot sign in to this dashboard.

The backend exchanges the password with Supabase and seals the access token (AES-256-GCM, keyed by `JALSAKSHI_SESSION_SECRET`) into an HttpOnly, SameSite=Strict cookie the browser cannot read. Sign-out revokes the token at Supabase. Every authenticated request revalidates the provider user and supervisor/team profile. Requests to PostgREST use that user's token and PostgreSQL RLS; no database owner or service-role credentials serve dashboard requests.

Access-token expiry (at most eight hours), revocation, or changing the session secret requires another sign-in. Refresh tokens are not retained.

## Vercel

`api/index.js` serves `/api/*` with the same handler as the dev server. In Project Settings > Environment Variables set `JALSAKSHI_ENVIRONMENT=production`, `JALSAKSHI_SUPABASE_URL`, `JALSAKSHI_SUPABASE_PUBLISHABLE_KEY`, and `JALSAKSHI_SESSION_SECRET`, then redeploy. The login-attempt limiter is per instance; Supabase's own rate limits still apply.

## Migrations

```sh
npm run db:migrate -- --check
npm run db:migrate
```

The runner applies ordered SQL migrations in one transaction under an advisory lock, records checksums in `supervisor_private.schema_migrations`, and refuses modified applied files. `--check` rolls back pending work. The six initial migrations have already been applied to the configured project and recorded in the ledger.

The public supervisor tables are separate from the pre-existing `jalsakshi` ingestion tables. Those tables were preserved. Automatic ingestion bridging is not enabled because a trustworthy tenant/worker mapping has not been supplied.

## Enforcement and limits

RLS confines reads and writes to the assigned team. SQL functions serialize case changes, compare versions, enforce closure evidence, and reject duplicate IVR escalation. Laboratory upload alone never satisfies closure. A requested retest remains pending until linked to a distinct, later, same-source screening record. Resident logs record attempts/delivery; the app does not send SMS, email, or calls.

Evidence downloads require an authenticated team member. Attachments accept PDF, PNG, or JPEG up to 2 MB, with signature checks; this is not antivirus scanning. Private bytes are omitted from workspace lists and all exports. The audit chain detects tampering against its stored hashes, but is not an externally anchored signature and does not protect against a database owner rewriting an entire chain.

The workspace refuses results exceeding 1,000 rows per table rather than showing incomplete aggregates; larger deployments need pagination and server-side aggregation. Current report metrics are actual counts of the synthetic team's records. No regulatory compliance certification or measured turnaround claims are made.

## Validation

`npm test` covers sessions, provider failures, role revocation, mutation restrictions, and export privacy. `npm run test:database` checks RLS, role escalation denial, guarded verification and closure, stale versions, audit integrity, retest identity, and required communication timestamps using rolled-back fixtures. `npm run test:workflow` exercises the real demo session, concurrent closure and IVR requests, and aggregate exports. Its synthetic records are intentionally retained for inspection.

