# Synthetic demo protocol SYN-COLOR-001

Status: prototype-only, prepared before event confirmation on 22 September 2026.

**Adopted 24 September 2026 as M1's explicit synthetic-only protocol boundary**
(`docs/decisions/ADR-M1-001-synthetic-protocol-boundary.md`). Its canonical
machine-readable form, conforming to `docs/architecture/protocol-schema.md`, is
`protocols/SYN-COLOR-001.v1.json` at the repository root. That file adds a
**SYNTHETIC read window** (prepare 10 s, read at 30 s ± 15 s, invalid after
120 s) chosen solely to exercise T08's timer states — there is no chemical
reaction on a printed colour card, so these values mean nothing about any kit
and must never be copied into a real protocol. This adoption is **not** a
domain review; "domain review of timing/units" remains an open G0 gate.

This protocol exercises capture, offline persistence, sync and supervisor review. It is **not water analysis**, has no concentration, safety or potability meaning, and is not evidence that any field kit or model has been scientifically validated.

## Controlled inputs

Print the two-page reference card at `output/pdf/jalsakshi-synthetic-demo-card-v1.pdf` from the repository root at 100% on matte white paper. Page 1 contains four reference swatches and capture marks; page 2 contains cut/display tiles. Matching PNG fixtures live under `apps/mobile/assets/demo/`.

| Fixture | Intended demo label | Color value (digital source only) |
|---|---|---|
| SYN-A | SYN-A | `#3B82F6` |
| SYN-B | SYN-B | `#10B981` |
| SYN-C | SYN-C | `#F59E0B` |
| SYN-D | SYN-D | `#EF4444` |

Printer, paper, lighting and camera alter color. A mismatch is `DEMO_INVALID`, never a water result. Record phone model, Android version, RAM, available storage, printer/paper, lighting, distance, app hash, fixture ID and timestamps when testing begins.

## Prototype flow and roles

1. A synthetic worker chooses the expected fixture and captures the printed card/tile or selects its bundled controlled image.
2. The app copies the image into its document directory and commits the record plus outbox state to SQLite before showing a saved receipt.
3. Sync creates metadata idempotently, uploads the image separately, and keeps metadata and photo states distinct.
4. A synthetic supervisor refreshes the server list and records `ACCEPTED` or `REFERRED`. `ACCEPTED` means accepted into this demo workflow only.
5. Restart and airplane/reconnect testing must prove that queued records survive and acknowledgements are replay-safe.

The local roles are labels, not authentication. No real person, household, worker, supervisor or laboratory data may be entered.

## Local demo API contract

The routes below exist only when `environment=development` and `tenant_data_mode=synthetic`.

- `POST /demo/v1/records` with `Idempotency-Key: <record UUID>` creates immutable metadata. Replaying the same key and payload returns the prior effect; a changed payload returns `IDEMPOTENCY_MISMATCH`.
- `PUT /demo/v1/records/{id}/photo` accepts one JPEG or PNG up to 5 MiB with `X-Content-SHA256`. `photo_state` remains independent from metadata sync.
- `GET /demo/v1/records?after=0&limit=50` returns records ordered by server sequence with `next_cursor`.
- `POST /demo/v1/records/{id}/decisions` requires `X-Demo-Role: supervisor`, `Idempotency-Key: <command UUID>`, `expected_version`, decision and reason.

This demo surface does not satisfy T05-T18, production authorization, private object storage, encrypted local storage, protocol validation or scientific acceptance. Those remain explicit gates.

## Production/pilot gate

Before any operational use, select one commercially available colorimetric field kit and one parameter; record the manufacturer instructions and read timing, lot and expiry rules; define controlled preparation and labeling; obtain a domain/laboratory reviewer; and compare the field workflow against a laboratory reference process. Replace, do not reinterpret, this synthetic protocol.
