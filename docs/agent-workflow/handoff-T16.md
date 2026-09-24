# Handoff — T16 private evidence upload boundary

- Task: T16 / REQ-018 / AC-018. Role C (security), carried by the agent under the M2 option-A authorisation (synthetic only).
- Status: **`[~]` built and verified.** Outstanding: independent **security review** (AGENTS.md), a **malware scanner** for lab documents (PDFs cannot be released until one exists), and real-data use only after T32.

## What was built

| File | Purpose |
|---|---|
| `services/api/migrations/evidence.py` | `evidence_assets` with states `uploading/quarantined/available/rejected/deleted`, random `storage_key`, `uploaded_by`, `permission_version`, expiry |
| `services/api/app/upload_validation.py` | Judged by bytes: JPEG/PNG magic, trailing-data (polyglot) rejection, ≤16 MP from the header **before** decode, full decode, size caps; PDF magic/EOF/active-content/page checks → **quarantined `malware_scan_unavailable`** |
| `services/api/app/evidence.py` | Intent → token-scoped upload → complete (re-hash and inspect) → reauthorised access → token-scoped read |
| `services/api/app/routes_v1.py` | `POST /v1/evidence/intents`, `PUT /v1/evidence/{id}/content`, `POST /v1/evidence/{id}/complete`, `GET /v1/evidence/{id}/access`, `GET /v1/evidence/{id}/content` |
| `services/api/app/main.py` | Upload enabled **only** on the synthetic dev stack; elsewhere the routes answer 503 (AC-018 default: no upload) |
| `services/api/requirements.txt` | `pillow==12.1.0` pinned. It was already installed and unpinned; licence MIT-CMU. It is an image-decoder attack surface, so it must be kept current |
| `tests/upload_test.py` | 19 tests (inspection, tokens, HTTP, PostgreSQL) |

## Acceptance mapping

- **Wrong tenant denied.**
  - Another tenant's asset or sample is `404`, with the same body as a missing one.
  - Another tenant can't attach to, complete or read the asset.
  - A malformed id is 404, not 500, including on PostgreSQL.
- **Own captures only (authorization-matrix.md).**
  - A worker can't read a capture they didn't make, and can't attach to someone else's sample.
  - Only the uploader can complete an upload.
- **Unsafe input rejected, and its bytes deleted.**
  - Rejected at inspection: HTML as PNG, PNG as JPEG, JPEG+ZIP and PNG+HTML polyglots, truncated JPEG, a decompression-bomb header (5000×5000 in a tiny file), SVG, empty or oversize files, PDF with JavaScript, a PDF over 20 pages, and non-PDF content labelled PDF.
  - Refused at intent time: disallowed types and declared oversize.
  - A hash mismatch at completion is rejected.
- **Metadata and image states are independent.** A rejected photo leaves the accepted sample `accepted`.
- **URLs.** HMAC-scoped to tenant, asset, method and size; they expire in 5 min. Expired, forged, cross-asset and swapped-claim tokens are refused. A read URL stops working once the asset leaves `available`.
- **Cancel.** A short (aborted) or overlong upload stores nothing; a renewed intent on the same asset works. A completed original is immutable: no new upload URL, and different metadata gets `IDEMPOTENCY_MISMATCH`.
- **Served safely.** `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.

## Found and fixed

- **Real route defect.** The async upload handler used a connection opened on another thread; SQLite refused it (PostgreSQL would have hidden it). The DB work now runs in one threadpool call with its own connection.
- **Three weak tests caught by mutation and fixed:** rejected-bytes deletion wasn't asserted, read-after-state-change wasn't tested, and same-tenant completion by a non-uploader wasn't tested.
- **Wrong boundary test (mine):** a patched 1×1 PNG isn't a 16 MP image. It now uses a real 4000×4000 PNG plus a 4000×4001 header.

## Verification actually run (2026-09-24)

- `TEST_DATABASE_URL=<.env> python -m unittest tests.upload_test -v`: **19/19**, including PostgreSQL 17.6 (schema `jalsakshi_test_t16`, created and dropped).
- Mutation: **15/15** caught against a passing baseline, after the three test fixes above. The first pass was 13/15.
- `python -m pytest -q`: 227 passed. An earlier run showed 11 PostgreSQL setup errors/failures. The cause was an **orphaned `idle in transaction` session** (PID 211574) left by an interrupted run, whose locks blocked `sources_postgres_test`. I terminated it after confirming no local process owned it, and the suite then passed. This is an environment hazard of sharing one Supabase database, not a code defect.
- All Node suites pass; the frozen contract is byte-identical (the evidence routes are not in `contracts/openapi.json`).

## Not done / limits

- **No malware scanning.** Lab PDFs can't become `available`. That blocks T19's attachment path, not its structured-entry path.
- **The storage** is a private local directory, not encrypted object storage (T32/T35). The **signing key** is random per process and must be shared and configured before multi-worker or production use.
- **Inspection is synchronous** in the request (no job queue). Fine at 5–10 MiB; move it to a job when sizes or load demand.
- **No EXIF-stripped derivative** is produced; nothing shares images outside authorised access yet (T43 exports carry no images).
- **The phone does not upload.** Default no-upload is kept; phone-side opt-in upload is not wired.
- **Lab-report evidence** (context `lab_report`) is added with cases in T19.
- **Needs independent review:** security (AGENTS.md).
