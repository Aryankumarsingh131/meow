# API and analysis contracts — v1 proposal

All endpoints require authenticated tenant membership except liveness. Tenant is resolved from authorized session context, never trusted from a JSON field. Enforce the same scope on nested resources and object-storage access. API owner: C.

## Common rules

HTTPS JSON UTF-8; explicit schema version; UTC timestamps; UUIDs; reject unknown command types and oversize payloads. JSON maximum 256 KiB for sync batch, 50 events/batch. No floats NaN/Infinity. Text max lengths: source label 160, notes/action reason 2,000; normalize text without changing original evidence.

Errors use `application/problem+json` with `type,title,status,code,detail,request_id,field_errors,retryable`. Example: code CASE_VERSION_CONFLICT, HTTP409, retryable=false. Never include stack traces/tokens. Standard codes: VALIDATION_FAILED422, AUTH_REQUIRED401, FORBIDDEN403, NOT_FOUND404, IDEMPOTENCY_MISMATCH409, PROTOCOL_REVOKED409, PAYLOAD_TOO_LARGE413, RATE_LIMITED429, TEMPORARILY_UNAVAILABLE503. Unauthorized object IDs return indistinguishable 404 where appropriate.

Client connect budget 5 s, ordinary total request 10 s; server metadata deadline 8 s; DB statement budget 3 s, lock budget 1 s. Upload total budget 60 s; UI can cancel. A timeout/cancel does **not** prove server rollback: reconcile by same idempotency key or GET before retrying a mutation.

Retry only network failure/408/429/502/503/504 with jittered 1,2,4,8,16,30,60-second delays, honoring Retry-After; persist schedule. Pause on auth errors for sign-in; 4xx validation/conflict requires user correction. Limit automatic attempts per foreground session to eight, retain pending data. Backoff is not deletion.

Pagination uses opaque tenant/filter-bound cursor with deterministic ordering and limit default50/max100. Invalid filters/cursors return422; expired sync cursor returns410 RESET_REQUIRED with safe rebootstrap instructions. Keep pending local outbox during rebootstrap. v1 supports additive optional fields; breaking changes require v2, compatibility policy and old-client migration. Never force-update by discarding offline records.

## Endpoint inventory

| Method/path | Request / response | Role / behavior |
|---|---|---|
| GET /health/live | process status only | Public, no sensitive dependency data |
| GET /health/ready | DB/schema readiness | Internal/authenticated monitoring |
| POST /v1/session/offline-grant | device_id, client_build → signed grant, policy/version, expires_at | Online member; server grants scope, not client |
| GET /v1/bootstrap | assigned source/protocol/model pages + snapshot_cursor | Member; consistent snapshot token across pages, no giant response |
| GET /v1/sources | q, active, cursor, limit → items,next_cursor | Scoped catalog; escaped bounded search |
| GET /v1/sources/{id}/history | cursor,limit → accepted tests/cases | Scoped authorized source |
| POST /v1/sync/push | device_id, events[] → per-event results | Worker for sample creation; server validates current membership |
| GET /v1/sync/pull | cursor,limit → changes,next_cursor,has_more,server_time | Only authorized changefeed; permissions/tombstones included |
| GET /v1/samples/{id} | sample + observation + evidence status | Immutable evidence view |
| GET /v1/cases | status,owner_id,overdue,source_id,cursor,limit | Supervisor; stable sort due_at,id with explicit null order |
| GET /v1/cases/{id} | state,version,events,next_actions | Authorized role; sensitive report access scoped |
| POST /v1/cases/{id}/commands | command_id,expected_version,type,payload → updated case | Role-checked command, idempotent |
| POST /v1/lab-reports | report metadata → unverified report | lab_reviewer/supervisor per deployment |
| POST /v1/lab-reports/{id}/verify | command_id,expected_version,decision,reason → verification record | Authorized reviewer; cannot verify mismatched source silently |
| POST /v1/evidence/intents | asset_id,context,bytes,media_type,sha256 → scoped upload URL,expires_at | Permission/policy checked; private quarantine key |
| POST /v1/evidence/{id}/complete | upload checksum → queued verification state | Actual object inspected before available |
| GET /v1/evidence/{id}/access | → short-lived read URL or denied | Reauthorize every request; no public buckets |
| POST /v1/exports | filters,format,command_id → job | Supervisor, bounded authorized fields |
| GET /v1/jobs/{id} | state,progress,download_url?,error_code? | Same tenant/role as creation |
| POST /v1/jobs/{id}/cancel | command_id → cancellation requested | Cooperative cancel between items; no partial file published |
| GET /v1/metrics | date range/locality filter → counts,denominators,as_of | Supervisor; excludes non-operational records by default |

## Admin plane — v1

Fills the Phase 1 gap where nothing could create the catalogue the field app consumes. All routes are `admin` only per the [authorization matrix](authorization-matrix.md), tenant-scoped, audited, and rate-limited more tightly than field routes. There is no cross-tenant route.

| Method/path | Request / response | Behavior |
|---|---|---|
| GET /v1/admin/sources | cursor,limit,q → items | Includes inactive, unlike the field catalogue |
| POST /v1/admin/sources | label,locality,qr_code?,coordinates? → source | `qr_code` generated if absent; unique per tenant |
| PATCH /v1/admin/sources/{id} | expected_version, mutable fields → source | Bumps `version`; never hard-deletes. Deactivation is `active=false` and emits a changefeed entry so devices drop it |
| GET /v1/admin/protocols | cursor,limit → items with versions | Includes draft and revoked |
| POST /v1/admin/protocols | full protocol document → protocol v1 | Validated against [protocol schema](protocol-schema.md); `approved_by` mandatory |
| POST /v1/admin/protocols/{id}/versions | full protocol document → new version | Immutable predecessor retained |
| POST /v1/admin/protocols/{id}/revoke | reason → revoked protocol | Blocks new assisted interpretation; flags pending records on reconnect. Accepted samples keep their version |
| GET/POST /v1/admin/kit-lots | protocol_id/version, lot, expiry → kit lot | Expiry must be consistent with protocol validity |
| GET /v1/admin/memberships | cursor,limit → members with roles | |
| POST /v1/admin/memberships | user_subject, role → membership | Invites by OIDC subject; creates the `users` row on first sight |
| PATCH /v1/admin/memberships/{id} | role?, active? → membership | Deactivation takes effect online immediately; offline grants expire per lease (A08) |
| GET /v1/admin/model-manifests | → manifests with approval_status | |
| POST /v1/admin/model-manifests/{id}/approve | protocol_versions, decision, reason → manifest | Flips research → approved for named protocol versions only. Requires an attached T27 evaluation reference |
| POST /v1/admin/model-manifests/{id}/revoke | reason → manifest | Last-known-good remains; devices fall back per rollback playbook |
| GET /v1/admin/audit | filters,cursor → audit events | Read-only; never returns raw evidence |

Admin mutations are ordinary case-free writes but still allocate a changefeed entry under the tenant lock, so a provisioned device learns about a new source or revoked protocol through the same ordered pull it already uses. No separate push channel is introduced.

**Bootstrapping the first admin.** A tenant's first `admin` membership cannot be created through this API, because it would require an existing admin. It is created by an operator-run CLI command against the database under the deployment runbook, recorded in the audit log with `actor = system:bootstrap`. This is deliberately not an HTTP route.

Metadata bootstrap: server captures a committed tenant sequence under the same ordering discipline as writes, returns a snapshot token; pages are stable for that snapshot or restart safely. Do not combine changing page offsets with a newer final cursor and lose intermediate changes. A simple pilot implementation may materialize a bounded bootstrap snapshot; cap and expire it.

## Push schema and business idempotency

```json
{
  "device_id": "UUID",
  "events": [{
    "event_id": "UUID",
    "kind": "sample.create",
    "schema_version": 1,
    "payload": {"sample_id": "UUID"}
  }]
}
```

Payload is the full validated sample schema in [data model](data-model.md), abbreviated here only to show the envelope. Supported field-client event kinds initially: **sample.create** and **sample.correct**. Case decisions are online commands.

`communication.record` is **not** a field-client push event. The Phase 1 review found it listed here while [J04](../product/user-journeys.md) and T22 place resident communication on the supervisor web app. Resolution: resident communication is an online `record_communication` case command (row 13 of the [case state machine](case-state-machine.md)), because it is a supervisor-authored, template-versioned, domain-approved message tied to a case the worker may not even be able to see. Revisit only if a real deployment shows workers communicating results offline, which would additionally require offline template distribution and approval.

Response per event: `event_id,status,resource_id,resource_version,server_time,error?`. Status = accepted/duplicate/rejected/conflict. Batch HTTP200 may contain rejected items; transport success is not all-record success. Invalid envelope returns422 before processing. Process each valid event transactionally; no claim of all-batch atomicity. Client applies receipts and removes only acknowledged outbox entries atomically.

For same event UUID + same canonical payload hash, return prior receipt. Same ID + different hash returns409 and is not overwritten. Unique sample ID and trigger_sample_id protect permanent replay after receipt compaction. Rejected records remain locally exportable for support under policy.

Sync pull returns authorized entity upserts/tombstones with strictly increasing committed tenant sequence. Apply every page plus cursor in a single SQLite transaction. Do not advance on partial failure. Scope changes trigger snapshot refresh to remove revoked cached access; remote revocation cannot reach an offline phone immediately.

## Case commands

Types: assign, refer_to_lab, record_action, accept_action, link_retest, record_communication, request_closure, close, reopen, dismiss. Each has a discriminated payload schema and an allowlisted legal state/role combination — the full table is in [case state machine](case-state-machine.md), which is authoritative. `close` includes verified_report_id, retest_sample_id or authorized exemption, action IDs or exemption, communication_id, disposition and policy_version. Server recomputes prerequisites; client booleans are never proof.

A stale version returns409 plus current_version and a safe summary, not an automatic resubmit. Command UUID dedupe occurs before version conflict when replaying the same previously accepted command.

## Local analysis contract

`analyzeCapture(input, cancellationToken) -> AnalysisResult` accepts local asset reference, protocol version, corner coordinates/fiducial layout and capture/timing metadata; no external URL.

Native preprocessing returns schema-versioned float features and quality reasons. Feature schema v1 is fixed during T04: ordered named normalized patch features, color-space/whitepoint conventions, scaling, ROI coordinates and transforms. Training and mobile must share golden vectors; a vague “RGB array” is not sufficient.

Initial deployable MLP: input float32 `[1,F]`, output float32 logits `[1,K]`; F/K fixed in the manifest, standard compatible operations only. Candidate image-quality CNN has a separate `[1,3,224,224]` RGB contract; do not reuse normalization blindly. Choose either approved model path per task, not hidden model routing.

Result fields: status = accepted/retake/uncertain/manual_required/cancelled; suggested_bin nullable; calibrated_confidence nullable; quality_reasons[]; model_version; feature_schema; protocol_version; inference_ms; domain_status. No `safe_water` field. Errors: IMAGE_DECODE_FAILED, REFERENCE_MISSING, TIMING_INVALID, MODEL_UNAVAILABLE, UNSUPPORTED_DOMAIN, CANCELLED.

Cancellation stops pending work at safe checkpoints; if native inference cannot interrupt immediately, ignore stale result by capture job ID and free buffers when complete. Never attach a previous capture's output to a new photo.

## Asset and job contracts

Images: JPEG/PNG allowlist, max5MiB and 16 megapixels before decoding; lab PDF max10MiB/pages limit set and tested in T16. Validate magic bytes and decoder output, not filename/MIME alone. Original becomes immutable; derived preview has separate hash. EXIF location stripped from shared derivative unless explicitly approved. URLs expire after a provisional 5 minutes and scope one asset/method/size; renew rather than extend globally.

Jobs: queued/running/succeeded/failed/cancelled; counts may be null until total is known. Lease expiry permits idempotent recovery. Export files only available after complete generation/checksum; downloadable for 24 h under retention policy. Cancelled jobs clean partial objects. No fake percentage when work cannot be estimated.

