# Handoff — T12 crash-safe local save

- Task ID: T12
- Owner / reviewer: Codex, role A/storage; correctness, security and simplification self-review completed 24 September 2026 IST
- Status: complete as an engineering slice; native process-death boundaries are fault-injected, not yet exercised by killing a physical phone process
- Requirement and acceptance IDs: REQ-007 / AC-007
- Branch and implementation commit: `feature/t12-local-save` / `06e58a3`
- Base commit: `0f65615`
- Files changed: `apps/mobile/src/storage.ts`, `apps/mobile/src/outbox.ts`, `apps/mobile/tsconfig.json`, `tests/local-save.test.ts`, `docs/local-recovery.md`
- Inputs: confirmed sample JSON, client-generated sample/event/asset UUIDs and a JPEG/PNG source URI
- Outputs: content-hashed private asset, one atomic sample/asset/outbox transaction and a queryable durable receipt

## Acceptance evidence

- The source is copied to an owned UUID `.tmp`, read back for byte count and SHA-256, then moved to the final UUID `.asset` before any database row is written.
- The sample, asset reference and pending outbox event are inserted with one `withExclusiveTransactionAsync` callback. `status: saved` is returned only after that callback resolves.
- SQLite is configured for WAL and `synchronous = FULL`; all statements use bound parameters.
- Failure before rename, after rename and before commit leaves zero rows. On storage startup, recovery removes the one unreferenced owned file.
- Failure after a successful commit returns an error rather than a false success. Restart retains exactly one sample, asset and outbox row, exposes the original receipt/hash, and an exact retry adds nothing.
- Receipt lookup does not depend on the pending outbox row, so acknowledging/removing an outbox item cannot erase the durable local receipt.
- Retry with the same sample ID but a changed payload hash is rejected.
- Recovery deletes only UUID-named `.tmp`/`.asset` orphans. Unknown files and referenced assets remain; a missing referenced asset is reported without deleting its sample/outbox.
- Disk-full injection produces no receipt and no database row.

## Verification actually run

- `node tests/local-save.test.ts` — 7 crash/restart scenarios passed.
- Full Node matrix plus demo — 132 checks passed; capture golden runner completed.
- `services/api/.venv/Scripts/python.exe -m pytest -q` — 114 passed, 12 PostgreSQL-only tests skipped because `TEST_DATABASE_URL` was unset, 35 subtests passed.
- `services/api/.venv/Scripts/python.exe ml/quality_fixtures_run.py` — 8/8 matched, zero mismatches, one known low-texture false reject retained.
- Root and mobile `npx tsc -p tsconfig.json --noEmit` — clean.
- Android `:capture-native:testDebugUnitTest :app:assembleDebug --no-daemon` — `BUILD SUCCESSFUL` in 3m28s; 227 tasks; four native quality tests, zero failures/errors/skips; all four configured ABIs packaged.
- Debug APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 307,854,552 bytes, SHA-256 `6e1cdfd369e826f0a272d6c6ab413c1911c37345d14a266f84b956c30c74ccbe` (ignored build artifact; recreate with Gradle).
- `git diff --check` — clean apart from informational LF→CRLF notices.
- Root production audit — zero vulnerabilities. Mobile production audit — 10 moderate reports through Expo's build/config chain (`xcode` → `uuid`); no critical/high finding and no T12 runtime path. The offered forced fix downgrades Expo to 46, so it was not applied to the pinned Expo 57 stack.

## Deliberate limits and next action

- Expo FileSystem 57 exposes awaited copy/move and completed reads, but no public `fsync`; T12 verifies bytes before same-directory move and does not claim a stronger primitive. See `docs/local-recovery.md`.
- The file is in persistent app-private storage but is not encrypted. Encryption/key handling remains T32; private storage is not represented as encryption.
- The storage module is not yet connected to a production navigation/receipt screen. Its `openLocalStorage()` entry point performs recovery before returning save/receipt functions.
- No real camera asset or physical-device force-kill was available. The required boundaries were injected deterministically, including lost commit acknowledgement, and the Android implementation builds against the pinned native stack.
- The blueprint checkbox stays untouched because `jalsakshi-blueprint/` is the checked-in reference package.
- Next exact action: T13 consumes the stored `eventId`, exact `payloadJson` and `payloadHash` for idempotent server ingestion.
