# Acceptance criteria and release gates

All checks below are **not run** against an app. Their future evidence belongs in task handoffs with commit/build/device/dataset identifiers. Passing document validation is not passing application acceptance.

| Test | Requirement | Acceptance procedure / expected result |
|---|---|---|
| AC-001 | REQ-001 | Unknown QR never navigates arbitrary URLs; selecting source shows last known test with stale timestamp. |
| AC-002 | REQ-002 | Expired/unsupported kit blocks automated interpretation; interrupted or late timer records invalid timing and requests a new test. |
| AC-003 | REQ-003 | Rotated photos normalize correctly; missing reference fails; manual corner adjustment remains available. |
| AC-004 | REQ-004 | Blur/glare/clipping/out-of-frame fixtures return reason codes; rejection never fabricates a class. |
| AC-005 | REQ-005 | Model runs in airplane mode; unsupported domain abstains; declared quality gates pass before operational use. |
| AC-006 | REQ-006 | Manual entry survives camera denial; automated and human results remain separate; reason required. |
| AC-007 | REQ-007 | After forced process death, saved sample and outbox survive; failed disk write never displays Saved. |
| AC-008 | REQ-008 | Repeated request creates one sample/case; reconnect drains queue; conflicts are visible; pull misses no committed changes. |
| AC-009 | REQ-009 | No result says potable/certified; uncertain output retains next steps; mock data visibly labeled. |
| AC-010 | REQ-010 | A flagged synced test creates one review case; supervisor assigns/refers; overdue uses server time. |
| AC-011 | REQ-011 | Unverified/inconsistent report cannot satisfy closure; authorized reviewer records method, units and source/sample link. |
| AC-012 | REQ-012 | Actions retain who/what/when and evidence; completion alone does not close a case. |
| AC-013 | REQ-013 | Closure fails if required evidence missing; two concurrent decisions cannot overwrite each other; new flagged retest reopens. |
| AC-014 | REQ-014 | Communication records channel/time/actor/content version; no claim of SMS delivery without provider evidence. |
| AC-015 | REQ-015 | Filters and pagination match server counts; exports preserve uncertainty and avoid spreadsheet formula execution. |
| AC-016 | REQ-016 | English/Hindi flows reviewed; screen reader/keyboard/large text/reduced motion checks pass on essential journeys. |
| AC-017 | REQ-017 | Cross-tenant access denied including uploads/exports; first login requires network; expired offline entitlement locks access without deleting unsynced data. |
| AC-018 | REQ-018 | Default no-upload mode sends no photos; pilot uploads require policy/permission; retention and backup deletion procedure verified. |
| AC-019 | REQ-019 | Physical-sample groups do not cross splits; model SHA and protocol version are saved per result; dataset permissions recorded. |
| AC-020 | REQ-020 | Declared benchmark matrix reports p50/p95/p99, errors, memory and quality; failed budgets create tracked remediation. |
| AC-021 | REQ-021 | Trace IDs connect failures; no tokens/photos/precise personal location logged; actionable stale-sync and overdue metrics exist. |
| AC-022 | REQ-022 | Staging smoke, restoration and rollback demonstrated; production declaration requires live environment evidence and named owner. |
| AC-023 | REQ-023 | v1 clients reject incompatible schema safely; export/import reference round trip works; WQMIS link is manual unless officially approved. |
| AC-024 | REQ-024 | Second-kit onboarding repeats validation; 10x dataset tests preserve isolation and latency or document required capacity change. |
| AC-025 | REQ-025 | Cold run succeeds twice on real device; simulated lab data and evaluation limits declared; no guaranteed-win or unmeasured accuracy claim. |
| AC-026 | REQ-026 | Baseline and pilot denominators recorded; at least one operator reviews workflow; willingness-to-pay remains interview evidence not traction. |
| AC-027 | REQ-027 | Critical scenarios in testing plan have passing evidence; no high-severity safety/data-loss/tenant isolation defect waived for release. |
| AC-028 | REQ-028 | Fresh agent can identify current state, claim a task, run documented checks and hand off without conversation history. |

## Release gates

**G0 — build/protocol feasibility:** T01–T04 provide eligibility notes, selected protocol or explicit synthetic-only boundary, actual hardware inventory, native-build and pixel-pipeline evidence. Failure changes schedule, not analytical claims.

**G1 — complete early slice:** source → valid protocol → capture/manual result → forced restart → sync → same record on web. REQ-001–REQ-009 and REQ-017 apply to the implemented slice; local AI REQ-005 remains incomplete until G3. No real-data public release at G1.

**G2 — workflow completeness:** AC-010–AC-015 and AC-023 pass, including rejecting invalid closure. Mock lab reports may demonstrate logic but cannot satisfy real pilot evidence.

**G3 — scientific and accessibility:** AC-005, AC-016, AC-019 pass under the declared supported domain; all ML thresholds follow [evaluation](../engineering/testing-and-evaluation.md). Unvalidated AI may run only in research/shadow mode, clearly labeled. Manual fallback does not mark the local-ML requirement done.

**G4 — hardening:** AC-018, AC-020, AC-021, AC-027 pass; zero open critical/high tenant-isolation, safety or data-loss defects. Negative paths receive independent review.

**G5 — deployed pilot:** AC-022, AC-025, AC-026 plus operator-approved protocol/privacy policy. Deployment-ready is not deployed; require live smoke test, restored backup and named incident owner. Real-world observations remain bounded by pilot design.

**G6 — full initial product:** all 28 checks pass, including second-kit/configuration exercise, declared scale test and independent fresh-agent handoff. Final closure requires a requirement-by-requirement evidence index; no blanket “all tests pass” without artifacts.

## Exception process

Record blocked criterion, user impact, temporary containment and owner. Human approval can change schedule or explicitly revise scope, but cannot convert an unverified scientific result into a verified one. Demo exceptions are visible in the presentation and current-state document; they do not waive pilot/production gates.

