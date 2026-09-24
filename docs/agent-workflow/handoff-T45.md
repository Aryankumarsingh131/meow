# Handoff — T45 offline grant and revocation handling

- Task: T45 / REQ-017 / AC-017. Roles C (server) and A (device), both carried by the agent under the project owner's M1 authorisation.
- Status: **`[~]` built and verified on the emulator.** Outstanding: independent **auth review** (AGENTS.md), a physical phone, and a real identity provider (T06 blocker).
- Data: synthetic only. The lease length is **provisional** (assumption A08, 72 h), not operator- or domain-approved.

## What was built

| File | Purpose |
|---|---|
| `services/api/app/offline_grants.py` | Server-issued lease: scope from membership, 72 h, policy version, `capture_offline` only for worker/supervisor, disclosed revocation limit |
| `services/api/app/routes_v1.py` | `POST /v1/session/offline-grant` through T06 `authenticate()` |
| `apps/mobile/src/offlineAccess.ts` | Store and check the lease; clock high-water rollback detection; revoke without touching records |
| `apps/mobile/src/login.tsx` | Provision a grant after every online sign-in (a 403 drops any held grant). When offline, offer "Continue offline as …" only for valid grants |
| `apps/mobile/src/workerApp.tsx` | Lock screen (with pending count) on expiry or rollback, checked on mount, on foreground and before save. `forbidden` from sync drops the lease |
| `apps/mobile/App.tsx`, `session.ts` | Offline banner (lease end plus limitation); sign-out ends offline access and warns about unsent records |
| `tests/offline_grants_test.py`, `tests/offline-auth.test.ts`, `tests/apiServer.ts` | 4 server tests; 10 device tests on the real server with pending samples; shared server launcher |

## Acceptance mapping

- **First provisioning online.** No grant, no offline entry. The grant needs an authenticated active member; an unauthenticated request gets 401. Client-sent tenant, role or expiry are ignored.
- **Expired grant locks without losing the queue.** At 72 h − 1 ms access is granted; at 72 h it locks. Pending samples and the outbox stay unchanged.
- **Clock rollback handled.** Setting the clock behind the latest time the app has seen (beyond 2 min of NTP slack), or before the grant was issued, locks and **deletes** the grant, so moving the clock forward again doesn't restore it. The lease runs on the phone's clock from issue, so a phone clock skewed by −24 h still gets exactly 72 h.
- **Revocation.** Server: a revoked member gets 403 on the grant and on push, and 0 rows are written. Once reinstated, the same record is accepted once. Device: `forbidden` → the lease is dropped, records are quarantined (kept, attempt count unchanged).
- **Re-login.** After expiry, signing in online issues a fresh lease and the queued records sync (`accepted` ×2).

## Verification actually run (2026-09-24)

**Automated.**
- `python -m unittest tests.offline_grants_test -v`: 4/4.
- `node tests/offline-auth.test.ts`: 10/10, using the real API server.
- Mutation on `offlineAccess.ts`: 10/10 caught. The first run had one survivor (zero tolerance). It exposed a test whose offset was derived from the constant under test; I rewrote it with a literal 60 s correction, and that mutant is now caught.

**Regression.** `python -m pytest -q` 208 passed; 13/13 Node suites; both `tsc` clean; frozen contract byte-identical.

**Emulator** (`jalsakshi_pixel`; screenshots `docs/evidence/screenshots/t45-0[1-4]-*.png`):
1. Online sign-in → `POST /v1/session/offline-grant` 200. The phone stores a grant with `leaseMs=259200000` (72 h).
2. Airplane mode (device can't reach the API) → `kill -9` → relaunch → sign-in fails as offline → **"Continue offline as worker (until 27/9/2026 16:46)"**.
3. Worked offline under the banner; recorded a **no-photo** manual test (`15485e9b-…`) → "Saved on this phone — 1 waiting".
4. `kill -9`, `adb root`, auto time off, **device clock set back 5 h** → relaunch → **no offline option**. Grant rows: **0**; `local_samples` 2, `outbox` 1 (nothing lost).
5. Clock restored, airplane off, sign in → sync → both records "Accepted by server … in the server's record list". Server: 2 samples, each once.

**Stale-environment problems found during the run.** Metro's watcher had missed the edits, so the app first ran old JS; and the host API predated the new route (404). Both were restarted, and I verified the served bundle and route before accepting the result.

## Not done / limits

- **Reboot ambiguity cannot be detected.** There is no native boot-time clock. Binding `SystemClock.elapsedRealtime()` is role B's (T08). The high-water mark catches rollback below the latest time seen, not a clock held just above it while the app stays closed (`ponytail:` note in the code).
- **The grant is unsigned.** Hermes has no RSA verification, and a key stored beside the grant adds nothing against local tampering. The server never treats the grant as authority; it's recorded for T32.
- **Offline entry is gated by the OS screen lock (A08), not a password.** Screen-lock enforcement itself is not implemented (T32).
- **The login screen doesn't say *why* offline access is unavailable** (rollback vs expiry). The reason text exists in `LOCK_TEXT` but isn't shown there yet.
- **On-device revocation was not exercised.** There is no HTTP way to revoke a membership in M1. It's covered by the Python (server) and Node (device) tests.
- **The dev issuer's `/dev/v1/token`** issues tokens to deactivated members; every `/v1` route then refuses them (403). A real provider must be checked for the same behaviour (T06).
- **Needs independent review:** auth and offline access (AGENTS.md).
