# Deploying the API to Render with Supabase Auth

This takes the API from nothing to a working hosted backend: real sign-in
(Supabase Auth), your Supabase Postgres, and the app pointed at it. About 30
minutes. Every step you do in a dashboard is marked **You**.

What you get is **staging with synthetic data**: sign-in and storage are
real, but everything captured is SYN-COLOR-001 test data. `production` is
kept for a real kit, and the API refuses to run production with synthetic
data.

## 1. Put the code on `main`

`render.yaml` deploys the `main` branch. **You:** merge `merge-into-meow` into
`main` and push.

## 2. Supabase: switch on asymmetric signing keys

The API only accepts tokens signed with a published public key (ES256 or
RS256). Older Supabase projects sign with a shared secret (HS256), which the
API refuses, deliberately.

**You:** Supabase dashboard → *Project Settings* → *JWT Keys*. If the current
key is "Legacy JWT secret", create a new **ECC (P-256)** signing key and
rotate to it.

Check it worked. This URL must list at least one key:

```
https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
```

## 3. Supabase: create the people who will sign in

**You:** *Authentication* → *Users* → *Add user* → email and password, tick
*Auto Confirm User*. Do this for each worker and supervisor. Copy each user's
**UID**; you need it in step 5.

## 4. Render: create the service

**You:** Render dashboard → *New* → *Blueprint* → pick the repository. Render
reads `render.yaml` and asks for three values:

| Variable | Value |
|---|---|
| `JALSAKSHI_OIDC_ISSUER` | `https://<project-ref>.supabase.co/auth/v1` (no trailing slash) |
| `JALSAKSHI_DATABASE_URL` | Supabase → *Connect* → *Session pooler* URI, with the real password, ending `?sslmode=require` |
| `JALSAKSHI_CORS_ALLOWED_ORIGINS` | Leave empty unless a web board will call the API |

The earlier database password was pasted into a chat and must be treated as
compromised. Reset it in Supabase (*Database* → *Settings*) before you use it
here.

The first deploy builds the image and, on startup, creates every table in the
`jalsakshi` schema and loads the synthetic water-source catalogue. When Render
shows **Live**, open `https://<service>.onrender.com/health/live`; it should
say `{"status":"ok"}`.

## 5. Give each user a tenant and a role

Signing in proves who someone is; the `memberships` table decides what they
may do. Without a row, a signed-in user gets `403`.

**You:** Supabase → *SQL Editor*, once per user:

```sql
insert into jalsakshi.memberships (tenant_id, user_id, role)
values ('7810e629-e415-5954-ac96-c798a68dcff3', '<user UID from step 3>', 'worker');
```

`7810e629-…dcff3` is the synthetic tenant that owns the seeded catalogue.
Roles: `worker`, `supervisor`, `lab_reviewer`, `admin`. To remove someone:
`update jalsakshi.memberships set active = false where user_id = '<UID>';`

## 6. Check it end to end

With the publishable key from Supabase → *Project Settings* → *API Keys*:

```bash
TOKEN=$(curl -s "https://<project-ref>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <publishable key>" -H "Content-Type: application/json" \
  -d '{"email":"<user email>","password":"<password>"}' | python -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
curl -s https://<service>.onrender.com/v1/me -H "Authorization: Bearer $TOKEN"
```

Expected: `{"user_id": "...", "tenant_id": "7810e629-...", "role": "worker"}`.
A `403` means step 5 is missing. A `401` usually means step 2 (the token is
still HS256) or a wrong issuer. A `503` means the API could not fetch the
signing keys; check the issuer URL.

## 7. Build the app against Render

The app reads three build-time settings. **You** create
`apps/mobile/.env.production.local` (it is gitignored):

```
EXPO_PUBLIC_API_BASE=https://<service>.onrender.com
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Then build the release APK (`cd apps/mobile/android && ./gradlew assembleRelease`).
The sign-in screen now asks for an email, and the synthetic-password hint is
gone. Only the publishable key goes in the app; the `service_role` key must
never be placed anywhere in the app or this repository.

## Things to know

- **Free plan sleeps** after 15 minutes idle; the first request then takes
  about a minute and the app may show "Cannot reach the server" once. The
  `starter` plan stays awake.
- **One worker process.** Export jobs are held in memory, so the service runs
  one process. Move jobs into the database before scaling out.
- **Photo upload is off** on hosted deployments (AC-018 default).
- **Sessions last one hour.** The app keeps the token in memory only and does
  not refresh it, so users sign in again after an hour.
