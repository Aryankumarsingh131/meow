# Handoff — T15 foreground reconnect and queue UX

- Task: T15 / REQ-008 / AC-008. Also closes the M1 end-to-end flow (T07 → T08 → T09 → T11 → T12 → T15).
- Owner: agent acting as role A (project-owner authorised all M1 roles). Branch `merge-into-meow`.
- Status: **`[~]` built; emulator scenario run.** Outstanding: the same scenario on a **physical phone**, and **independent review** of sync ordering and state (AGENTS.md).
- Data: synthetic only (ADR-M1-001). Device = Android emulator `jalsakshi_pixel` (API 35, x86_64), **not a phone**.

## What was built

| File | Purpose |
|---|---|
| `apps/mobile/src/sync.ts` | Foreground sync engine: push outbox → settle receipts, then pull/bootstrap; queue view; all status wording |
| `apps/mobile/src/queue.tsx` | Saved-records screen with Sync now |
| `apps/mobile/src/sample.ts` | T08 verdict + T11 observation → server `CanonicalSampleV1` (contract-validated) |
| `apps/mobile/src/m1Protocol.ts` | SYN-COLOR-001 imported from `protocols/` (not copied); synthetic lot honestly `unverified` |
| `apps/mobile/src/workerApp.tsx` | Full worker flow: source → protocol/timer → capture/manual → review → durable save → queue; sync on mount and on every return to foreground |
| `apps/mobile/src/api.ts` | Typed push/pull/bootstrap transport |
| `apps/mobile/src/storage.ts` | T12 DDL shared by both paths; `owner` scoping; optional photo; `bundleStatements`/`RECEIPT_SQL` used by device and tests; save uses the app's single connection |
| `tests/sync-client.test.ts` | 15 checks against the **real** API server, the real T12 SQL and the real engine |

## Acceptance mapping

- **Lost acknowledgement safe.** The receipt insert and outbox delete commit in one transaction. With the push committed on the server but the response dropped, the row stays pending; the replay returns `duplicate`. The server's own database then holds **1** sample and **1** feed row.
- **Auth failures pause.** A 401 or 403 stops the pass, touches no record and does not count as an attempt. The UI returns to sign-in, and the records stay on the phone, scoped to their account.
- **No closed-app immediacy claim.** Wording says "Records are sent only while this app is open". A test enforces it together with T10's `BANNED_WORDS`, and both a banned word and a "background" claim were shown to fail it.
- **Retry.** Only transport failures and 408/429/5xx back off: 1, 2, 4, 8, 16, 30, 60 s with jitter in [0.5, 1), persisted on the row. At most 8 automatic attempts per foreground session; "Sync Now" always tries. Backoff never deletes a record.

## Found and fixed

- **Shared-phone identity leak (real).** T12's outbox had no account. Another account's "Sync Now" would have pushed the first account's records under its own identity. Records are now owner-scoped end to end (test: another account sends nothing; reusing a sample ID across accounts is refused).
- **Queue jam (real).** The server rejects a whole batch with 422 if one event is invalid. The engine now isolates the bad event, marks it "Not accepted" and keeps it on the phone; the rest go through.
- **Manual-without-photo could not be saved (real).** T12 required an asset, but the protocol allows manual reading without capture and T11's camera-denied path relies on it. The photo is now optional (all three fields or none).
- **Two SQLite connections to one file.** The save and sync/catalogue used different handles; they now share one.
- **`CaptureScreen` never returned the photo URI**; added as a callback argument.
- **Vacuous test caught.** A template-literal `\b` (backspace) made the banned-word check unable to fail; fixed and shown to fail.
- **Corrected an overclaim in handoff-T14** about `payload_hash`.

## Verification actually run (2026-09-24)

**Automated.** `node tests/sync-client.test.ts` — 15/15. It starts the real FastAPI app on a temp SQLite (`JALSAKSHI_ENVIRONMENT=development`, synthetic, no `.env`) and covers:
- bootstrap
- contract validation of the phone-built sample, including indeterminate timing
- offline save, restart and backoff
- lost acknowledgement
- a crash between receipt and outbox delete
- auth pause
- 422 isolation
- account scoping
- partial-page rollback
- refused-cursor reset
- no-photo save
- retryable rejection
- a 200 that omits an event, and a foreign receipt
- the session cap
- wording

**Mutation.** 13/14 mutants caught. The survivor moves the cursor write *within* the same transaction, which behaves identically; the non-equivalent version (cursor written *outside* the transaction) is caught.

**Regression.** `python -m pytest -q` 204 passed; 12/12 Node suites; root and mobile `tsc --noEmit` clean.

**Emulator scenario** (procedure below; the build is a debug APK from `npx expo run:android`, `BUILD SUCCESSFUL`, installed at 2026-09-24 16:22 IST):

1. Host API: `python -m uvicorn services.api.app.main:app --host 0.0.0.0 --port 8000`, run from a temp directory (development/synthetic, own SQLite). Metro on 8081 via `adb reverse`.
2. Sign in as the synthetic `worker`. The catalogue arrived from the server.
3. `adb shell cmd connectivity airplane-mode enable`. Verified with `airplane_mode_on=1`, `Active default network: none`, and `nc 10.0.2.2 8000` → *Network is unreachable*.
4. Handpump 1 → timer → **in window** → photo → region → manual SYN-B with a reason → **"Saved on this phone"**. Record `47a7e7c0-7494-4e76-a167-e60311d50ae3`.
5. Phone DB: 1 sample, 1 asset (SHA-256 `a9f6f46f…f343f2`, 23,924 B), 1 outbox row at attempt 1 with backoff. **Server: 0 samples.**
6. `run-as … kill -9 <pid>` (process confirmed gone), relaunch **still offline**. Sign-in shows "Cannot reach the server. First sign-in needs a connection." The record stays on disk.
7. Airplane mode off → sign in → foreground sync → queue shows **the same record** as "Accepted by server … appears in the server's record list".
8. Server DB: **1** sample with the same ID and event; `method=manual`, `machine_bin=null`, `manual_bin=selected_bin=bin_1`, reason kept; timing `in_window` 34,588 ms; `evidence_ids=[]`; `data_mode=synthetic`; receipt `accepted`; changefeed seq 1. Phone: outbox 0, receipt `accepted`, `server_samples` seq 1, asset unchanged.

Screenshots: `docs/evidence/screenshots/t15-03…t15-10-*.png`.

## Not done / limits

- **Physical phone:** none is available. Emulator ≠ phone.
- **On-device lost-ack and mid-sync kill:** not timed on the device. They are covered by the real-server Node tests on real SQLite, not on the device.
- **Offline re-entry after restart:** impossible without a server. That is **T45** (offline grant), and the emulator run demonstrates the gap.
- **Photo upload:** never happens (T16). The queue says so.
- **Unwired pieces:** T10 quality and native features are not wired to capture (quality is recorded as `QUALITY_NOT_ASSESSED`; every reading is manual). The monotonic clock is `performance.now()` with a null boot ID (T08/role B).
- **Dev-build caveat:** the offline relaunch loaded JS through `adb reverse` (bundle host set to `localhost:8081` in the app's preferences). A release build embeds the bundle; that was not built.
- **Needs independent review:** sync ordering and state (AGENTS.md).
