# Deployment and operations

**Nothing is deployed.** This runbook is intended execution, not evidence of a live service. Gate definitions: [acceptance](../delivery/acceptance-criteria.md).

## Environments

| Environment | Data / infrastructure | Purpose |
|---|---|---|
| Development | Local app/API/Postgres, synthetic fixtures, private developer keys | Focused implementation and contract tests |
| Staging | Separate tenant/DB/bucket/identity app, release-like APK and TLS | Migration, upload, auth, recovery and performance gates |
| Pilot production | Approved operator/kit/domain/data policy; isolated secrets and storage | Limited real use only after G5 |
| Expanded production | Validated configuration/capacity, named support and release process | G6; not implied by deployment alone |

Build containers/artifacts ahead of deployment; avoid compiling on a small production VM. Exact dependency/container versions pinned after T03. Native library changes require a new APK; do not deliver incompatible JavaScript via over-the-air update. Keep current and previous compatible app/API/schema/model release records.

## Configuration inventory

API database URL, OIDC issuer/audience, session/cookie secrets, allowed origins, private bucket/region, signing keys, upload/retention policy IDs, worker limits and logging environment. Mobile has public API/identity configuration only, no DB/admin keys. Separate environment variables from secrets store; committed example config contains placeholders only. Startup validates required values and refuses unsafe production defaults.

## Proposed CI/CD sequence

1. Lockfile install; formatting/type checks; secret/license/dependency scan.
2. Unit/native fixture tests; OpenAPI generation and breaking-change check.
3. API integration against real Postgres; tenant and replay tests.
4. Build web/server and signed test APK; publish immutable build hashes.
5. Deploy staging; run migrations once under release lock with backup checkpoint.
6. Smoke critical field/web loop plus security negative paths; verify observability.
7. Human release owner approves based on evidence, not green compile alone.
8. Deploy production by immutable release; verify health and real synthetic smoke tenant; monitor errors/queue age.
9. Record deployed versions/time and rollback point in current-state.

No actual CI scripts exist. T35 establishes runnable commands and chosen provider details. Never state these steps ran until evidence exists.

## Migrations and compatibility

C is sole migration sequence owner. Use expand→compatible rollout→backfill→contract over separate releases. Preserve old mobile offline records during schema transition; do not drop accepted fields while supported clients can still submit. Rehearse old-database and old-client upgrades with pending outbox entries.

Migration failure stops rollout. DB down migration is not an automatic rollback if it loses evidence; prefer forward correction or restore with explicit reconciliation. Model rollback changes only future analysis; old result provenance never rewritten.

## Recovery objectives — provisional

Pilot target RPO≤24h and RTO≤4h, subject to operator approval and restore exercise. This is not zero-loss infrastructure. Nightly encrypted DB backup plus continuous/daily provider mechanisms as selected; object versioning/backup and deletion ledger included. Daily backup success/age alert. Retain30days per provisional policy.

Restore monthly during pilot and before first release into an isolated environment; compare sample/case counts, random asset checksums, role access, idempotency receipts and changefeed consistency. Test re-sync behavior after restore: client can replay acknowledged events if needed through a documented reconciliation export, without duplicates. Server rollback can invalidate cursors; RESET_REQUIRED must preserve local records.

If stricter RPO is required, price/test continuous WAL/PITR and object recovery; don't silently claim it from nightly snapshots.

## Monitoring and ownership

C owns releases/alerts/backups, B model/protocol evaluation, A operator support; every role needs an alternate. Metrics: API5xx/latency, DB pool/lock waits, failed/aged jobs, storage/budget, accepted duplicate rate, sync rejection codes, pending age reported by active clients, unowned/overdue cases and missing verification. Offline device health is unknown while disconnected.

Provisional alerts:5xx>2% for5min with meaningful request volume; oldest runnable job>10min; backup age>26h; disk>80%; repeated tenant-denial surge; severe model-domain failure increase. Low-volume pilot alerts require absolute counts to avoid percentage noise.

Logs: structured timestamp, environment, request/job ID, sanitized code, duration. Hash/pseudonymize identifiers where practical. No raw images, access tokens or free-text reports. Error-tracking vendor optional after privacy review; stdout and DB job status are enough initially.

## Rollback playbooks

- Bad server build: route back to previous schema-compatible image, smoke, reconcile jobs; no data rollback by default.
- Bad mobile/model: disable unsafe protocol/model on sync, distribute signed last-known-good model/APK, state affected offline exposure window.
- Corrupt migration/data loss: freeze writes, preserve evidence, restore isolated backup, compare/reconcile, then operator-approved cutover.
- Storage outage: metadata remains accepted with image_pending; retry does not claim complete evidence.
- Identity outage: existing authorized field captures within lease continue; privileged online actions wait.

## Deployed-and-verified evidence

Record URL/environment, build/commit, migration version, model/protocol hash, timestamped smoke result, monitoring check, backup restoration result, retention job check and owner approval. “Deployment-ready” means artifacts/config/runbook are prepared; “deployed and verified” additionally needs this evidence.

