# Current state

Updated: 22 September 2026 IST.

## Verified workspace observations and current work

The user authorized implementation on 22 September. `apps/mobile` now implements a clearly labeled synthetic Android demo: controlled bundled inputs or camera capture, document-directory image copies, SQLite records, separate metadata/photo sync state, a local synthetic supervisor view, and device facts for the test log. `services/api` exposes a development-and-synthetic-only `/demo/v1` SQLite surface with bounded image uploads, digest checks, idempotent metadata/commands and optimistic supervisor decisions. It has no production auth or operational domain routes. No cloud deployment, external messages, real people/data or purchases were used.

## User inputs and open gates

Team of 3 with strong AI-assisted coding confidence and access to Astra/Fable. Redmi/Xiaomi, OnePlus and iPhone devices are available, but none was attached during this build. Exact device facts remain pending. Kit, lab/worker/supervisor contacts and event participation/rules remain unconfirmed. M0 is **in progress**, not achieved: T01 needs kit/event answers, T02 needs a real walkthrough, T03 still needs release-APK device and airplane-mode runs, and T04 needs a selected commercial protocol. See [event](../event-confirmation.md), [protocol](../protocol-selection.md), [toolchain](../toolchain-matrix.md), [synthetic protocol](../synthetic-demo-protocol.md) and [assumptions](../assumptions-and-open-questions.md).

## Intended technical direction

Android local-first; explicit native image preprocessing; deterministic baseline plus a later validated small local model; SQLite/outbox; FastAPI/PostgreSQL; Next.js reviewer board. The current synthetic slice proves workflow plumbing only, not scientific interpretation, production authorization or operational readiness.

## Status and next action

All implementation tasks and G0 remain unchecked because this thin demo does not satisfy their production/scientific dependencies. API checks: `uv run --project services/api pytest -q` (12 passed, 2 dependency warnings) and Ruff (passed). Mobile checks: `npm run test:demo` (1 passed), `npx tsc --noEmit`, Expo Doctor (21/21), prebuild, and the final release Gradle build (318 tasks, 4m5s) passed. The 238,225,035-byte APK has SHA-256 `a277bd8547e0d2e3aa7d21a4960bb6b84dcf723190c70d57c40c00c5add58de1`, minSdk 26, targetSdk 36, four ABIs and a valid v2 debug signature. No phone was attached, so install, camera, restart, airplane/reconnect, native inference and performance checks remain unverified.

Next exact action: attach the Redmi/Xiaomi and OnePlus phones, record model/Android/RAM/storage, install the release APK, and execute the synthetic protocol's restart and airplane/reconnect checks. Separately verify event rules and choose one commercial kit, one parameter and a domain/laboratory comparison plan before any scientific implementation.

## Active claims

Codex claimed 22 September 2026 IST: `services/api/app/{main,errors,demo}.py`, API tests/lockfile, `apps/mobile/`, synthetic card/protocol generator and M0 status documents. No other owner is recorded.

## Open blockers

Exact measurement protocol/data; physical-device compatibility; domain/lab/worker/supervisor partners; budget/privacy policy; event admission/pre-event rules; production auth/storage/signing. These block M0 completion or real-data claims, not the synthetic demo.
