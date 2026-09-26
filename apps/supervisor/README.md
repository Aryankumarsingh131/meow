# JalSakshi supervisor workspace

## In this repository (apps/supervisor)

Imported from github.com/aditya531-a/supervisor and connected to the current
JalSakshi system. The UI is unchanged; only the server layer changed:

- Sign-in goes to the JalSakshi API (`POST /v1/auth/login`, Supabase Auth behind
  it). Only accounts whose role is `supervisor` get in (demo: `2@demo.org` / `1234`).
- Data comes from the API's `/v1/staff` routes with the supervisor's token, mapped
  into this board's shapes: cases = reports, screening records = test records,
  lab reports = lab referrals, actions = evidence photos, retests = lab re-reports,
  "IVR complaints" = resident complaints. Every action runs through the API's
  guarded routes (team scope, report versions, lab verification, closure evidence).
- Everything on the board is live data from the API: the source map (recorded GPS
  pins, no map tiles, works offline), the screening trend, team, leaderboards, case
  history and notes, resident message logs, retest (re-report) requests and source
  edits. "Verify history" checks that the recorded events match the case status (the
  API keeps an audit log, not a hash chain). The rewards catalogue was retired; points
  are the field workers' single ledger.
- **Complaints** screen: the newest photos (resident complaints, screenings, field-action photos) from
  `GET /v1/staff/photos/recent`, polled every second, so a phone upload shows within ~2 s. New photos are
  badged and trigger a background reload of the rest of the board; **Refresh** (there and in the top bar)
  reloads everything at once. Photos also show inline in each case's evidence and actions.
- When Supabase is unreachable the API serves the same routes from its internal
  database (services/api/app/local_store.py), so the board and the phone keep sharing
  data offline. Offline changes are not copied back to Supabase.
- The v1 migrations under `supabase/` and the `db:*`, `demo:seed`, `test:database`
  scripts are kept for reference but refuse to run against the JalSakshi v2 database.

Run it next to the API (`bash tools/dev_tunnel.sh` from the repo root starts the
API on :8000):

```sh
cp .env.example .env        # JALSAKSHI_API_URL defaults to http://127.0.0.1:8000
npm install
npm run dev -- --host 127.0.0.1 --port 5175
```

A unified, responsive Cases and Reports dashboard using React, TypeScript, Vite, Supabase Auth, and PostgreSQL. Sign-in requires a supervisor profile and assigned team. The configured environment uses persisted **synthetic** records.

## Run locally

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 5175
```

Open http://127.0.0.1:5175/. Environment and account details are documented in [AUTH_SETUP.md](./AUTH_SETUP.md). Demo credentials are saved only in the ignored `.demo-credentials.local` file.

To serve the built dashboard and API together from the standalone server (including through ngrok):

```sh
npm run build
node --env-file=.env server/index.ts
ngrok http 3000
```

Open the ngrok HTTPS URL at `/`. The standalone server serves the dashboard there and keeps API routes under `/api/`.

## Implemented workflows

- Team-scoped case queue, status/priority filters, source metadata and full screening history.
- Separate machine suggestions, human observations, and laboratory evidence.
- Private PDF/image attachments; laboratory upload and deliberate verification are separate actions.
- Corrective/referral action records, pending retest requests and distinct later sample linkage.
- Resident communication records with actual channel, delivery status, and timestamp. The app does not send messages.
- IVR complaint linkage and atomic create-and-link escalation.
- Database-guarded closure requiring a verified laboratory report **or** a completed linked retest, plus a recorded rationale.
- Append-only, per-case hash-linked audit history and integrity verification.
- **Reports → Download full data (CSV)**: every record on the board (sources, cases, screenings with readings, lab reports, actions, re-reports, resident messages and complaints, case history, team members) in one file with a `record_type` column; photos are counted, not embedded. The aggregate-only CSV (no identifiers or text) remains for sharing outside the team.

## Checks

```sh
npm test
npm run test:database
npm run test:workflow
npm run build
npm run lint
```

HTTP tests use mocked providers. Database tests roll back their fixtures. Workflow tests require the running localhost app and demo account; they retain explicitly synthetic demonstration records. Node 24 runs the TypeScript scripts directly.

The existing `jalsakshi` ingestion schema is preserved. Automatic import from that schema still requires an explicit tenant and worker identity mapping. Live mode is intentionally unavailable in this local demo. See setup notes before deployment.
