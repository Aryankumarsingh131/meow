# Performance model and benchmark plan

**Every number here is a provisional target or workload assumption. Nothing is measured on JalSakshi yet.** Hardware must be replaced with actual inventory in T03 before treating targets as a release commitment. Preserve quality and complete evidence processing when optimizing.

## Reference workload

Target test handset: ARM64 Android10+ with4GB RAM; include actual low/mid-range phone and a second vendor. Backend pilot:2vCPU/4GB app host, separate DB; region near users. Metadata~4KiB/sample before case events; intended evidence derivative~300KiB, never achieved by destructive compression without validation. Decode working image≤1600px long edge unless protocol ROI requires more; originals bounded by upload contract.

Pilot:30 workers ×10 tests/day=300 tests/day; up to10 concurrent active clients. Validation load:100,000 samples,10,000 cases,1,000 assigned sources/device. API tests1/10/50req/s, plus reconnection batches. Warm cache is not assumed for every run; report cold/uncached separately.

Networks: offline; Wi-Fi50ms RTT/10Mbps; constrained200ms RTT/1Mbps upload; poor500ms RTT/256kbps/2% loss. These are laboratory emulations, not measured Indian network distributions.

## User-visible budgets

| Workflow / definition | p50 | p95 | p99 | Boundary |
|---|---:|---:|---:|---|
| First tap feedback | 50ms | 100ms | 200ms | Input → visible response, no network |
| Warm cached source search | 80ms | 200ms | 400ms | Query → first usable rows |
| Warm analysis after capture file exists | 450ms | 1.5s | 3s | Decode through quality/inference/result, excludes chemistry and shutter |
| Cold analysis/model load | 1.5s | 3s | 5s | Fresh process; same complete checks |
| Durable save | 150ms | 500ms | 1s | Encrypt/commit → verified local receipt |
| Warm API metadata operation | 150ms | 400ms | 800ms | Server ingress → egress at10req/s |
| Warm web case view on Wi-Fi | 600ms | 1.2s | 2.5s | Navigation → useful authorized content |
| Reconnect metadata acknowledgment, one batch | 800ms | 2s | 5s | Healthy foreground client, Wi-Fi |
| One300KiB photo complete on1Mbps uplink | 3.5s | 6s | 12s | Upload + verification + availability, separately reported |
| Cold APK start → usable cached home | 1.5s | 3s | 5s | Actual release build |

Chemical reaction/read time is dictated by the kit and cannot be optimized away. Complete collaboration latency includes connectivity delay, optional photo transfer and human/lab work. Offline synchronization latency is unbounded until connectivity/app execution return; it has no fake p95 guarantee.

First useful result can be a valid “retake” response. First complete analysis includes all required checks and provenance; don't stop the timer before them. Data freshness goal while online/active: case board≤35s after accepted update (30s polling + processing), mutation initiator refresh≤2s p95. No closed-app mobile freshness promise.

## Critical path estimates

Warm analysis candidate budget: decode/orient100–350ms; geometry/features50–250ms; quality/model20–250ms; result assembly/render30–150ms. These are engineering ranges, not independently summable percentiles. Instrument the whole path; correlated tails matter.

Save path: encryption/file I/O50–250ms, SQLite transaction20–150ms, render20–100ms. File sync may dominate on slow storage. No success before durability.

Metadata API: network external; auth/validation5–30ms, lock/query/commit10–150ms, serialization5–20ms. Large wait queues can exceed these at saturation. Per-tenant serialization, DB connection limits and disk fsync are serial constraints.

300KiB×8/1,000,000 ≈2.46s ideal wire time; TLS, RTT, retransmission and verification add overhead. At256kbps ideal is~9.6s before overhead. Uploading50 photos in one reconnect is not a5-second task: metadata goes first and images have independent progress.

## Memory, throughput and capacity

Two1600×1200 RGBA buffers already occupy~15MB, before original decoding, runtime and UI. Avoid decoding a16MP image into several simultaneous copies. Peak resident app memory provisional target≤250MB on reference phone; no unbounded image queue. One analysis job/device, two parallel asset uploads maximum, one sync drain.

Server Little's-law illustration:10req/s×0.2s mean latency≈2 concurrent in-flight requests; at2s it is20, which can exhaust a small DB pool. Start two API workers with5 DB connections each; pool timeouts/backpressure protect DB. Do not assume adding workers multiplies capacity—CPU, memory, serial locks and DB cap remain.

Offline queue target500 records/device; warn at100 unsynced or disk free<200MB, allow operator-resolved cleanup of already-synced permitted images only. If disk insufficient, refuse a new durable save clearly; never discard queued evidence. Exact limits configurable with storage measurements, not scaled arbitrarily.

## Optimization ledger

| Technique | Mechanism / trade-off | Correctness gate / measurement |
|---|---|---|
| Preload model after home usable | Hides cold load during idle; consumes memory | Time cold and warm separately; no forced extra startup delay |
| Robust native ROI features | Reduces tensor/data transfer | Golden feature vectors, coordinate/EXIF tests; no changed analyte interpretation |
| Index queue/source/changefeed | Avoids growing scans; write overhead | EXPLAIN ANALYZE on representative data, equal results and tenant scope |
| Immutable protocol/source cache | Local reads; staleness | Version/policy invalidation, displayed as_of; revoked protocol handling |
| Metadata before images | First collaboration sooner; incomplete evidence remains | Separate states; no photo-complete claim |
| Batches≤50 events | Amortizes RTT; large batches increase tail/locks | Per-event receipts, partial failure/retry tests |
| Bounded upload concurrency | Better bandwidth use; memory/network contention | Throttle test; capture stays responsive |
| SQL connection pool | Reuses connections | Exhaustion tests, transaction tenant context reset, no cross-request leakage |
| Virtualized list/thumbnails | Lower rendering/memory cost | Screen-reader navigation and image evidence still accessible |
| int8 / alternative model | Potential size/speed gain | Paired quality gates below; revert if unsupported or no meaningful improvement |
| Background export worker | Keeps web/API responsive; delayed completion | Transactional job state, cancellation, no partial output published |

Reject speculative Redis/CDN/index proliferation until traces identify need. Progressive rendering improves perceived response, not total scientific computation.

## Benchmark procedure

T29/T30 record commit, release APK, phone model/OS/thermal/battery state, server/DB specs, dataset/model hashes and network settings. Warm-up10 runs excluded and reported; ≥200 repeated device runs per scenario, at least20 genuine cold starts, and repeat on three sessions. At200 samples p99 is unstable: report raw samples and uncertainty, not spurious precision. For server tails use≥10,000 requests per main condition plus repeated runs; don't average percentiles.

Scenarios: normal; cache miss; model unavailable; CPU throttling; low storage; app kill; offline queue of500; reconnect burst of30 clients; slow DB; exhausted pool; image malware rejection; failed upload; old-client compatibility; repeated command. Load steps1→10→50req/s with warmup/10-minute steady periods, hot-tenant mix, then bounded overload. Track accepted unique records, errors/retries/duplicates, queue depth/age, DB lock waits, memory, CPU and p50/p95/p99.

A faster run with missing checks, more abstention, reduced coverage or lost records fails. First optimize measured bottleneck; if quality-preserving implementation still misses budget, record hardware/cost/schedule changes required and obtain a decision.

## Quality-sensitive optimization gate

Model substitution/quantization requires the [evaluation](testing-and-evaluation.md) domain gates, plus no additional serious undercalls in paired test cases, macro-F1 reduction≤0.5 percentage points, accepted-coverage reduction≤2 points and calibration-error increase≤0.01. These are provisional engineering tolerances for domain-review approval, not safety certification. Require a meaningful benefit (e.g.≥15% p95 improvement or≥25% peak model-memory reduction) before taking added runtime complexity. Otherwise keep fp32.

