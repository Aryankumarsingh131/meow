# Testing and evaluation

No tests in this document have been run on an application. Each task must provide its own focused verification and evidence; release gates are in [acceptance](../delivery/acceptance-criteria.md).

## Automated and manual coverage

| Layer | Project-specific tests | Evidence / owner |
|---|---|---|
| Unit | Protocol timing and expiry; color conversion/golden feature arrays; quality reasons; score calibration; state transitions; payload hashing; backoff | Deterministic tests with boundary inputs / respective owner |
| Persistence | File/DB recovery at every save boundary; migration old→new; disk full; outbox and cursor transaction rollback | Restart/kill traces and exact row counts / A+C |
| API integration | Schema errors; duplicate/reordered push; partial batch reject; sample correction; sync commit ordering; role/tenant matrix | Real PostgreSQL tests, not SQLite substitute / C |
| E2E mobile | Provision→airplane-mode capture/manual→save→force stop→reopen→sync; timer invalidation; permissions | Release APK video + DB/receipt assertions / A |
| E2E web | Triage→report verify→action→retest→communication→close; rejected incomplete closure;409 conflict | Browser tests + case event history / A+C |
| ML | Group splits, independent domain tests, calibrated confidence, baseline parity, unsupported domain/abstention | Versioned report/model card / B |
| Security | Cross-tenant guessing; broken object access; auth expiry/revocation; unsafe uploads; malicious CSV cells; offline data access | Negative-test matrix and reviewer signoff / C + independent reviewer |
| Performance | Device/server/network scenarios in performance plan, including overload | Raw timings, resource/error/quality counts / B+C |
| Accessibility | TalkBack, keyboard/focus,200% text,320px layout,contrast,reduce motion,language review | Automated scans plus real manual checklist / A |
| Deployment | HTTPS, auth, schema, live save/sync, job completion, restore/rollback | Environment URL/build, timestamp, sanitized evidence / C |

Regression prevention: every defect gets the smallest test reproducing the root cause at its owning boundary, plus an end-to-end test when cross-boundary behavior is involved. Seed deterministic synthetic records with explicit data_mode; never mix them into operational metrics.

## ML dataset, labels and splits

One row per physical preparation linked to captures, kit lot, operator, phone, session, illumination, timing and reference result. Establish independent ground truth from an appropriate lab/reference method; chart-reading consensus is a weaker label and must be identified separately.

Split groups before preprocessing/augmentation: proposed60% training,15% selection validation,10% calibration,15% locked test, subject to enough independent examples per class. Tiny datasets may not support five useful partitions; use grouped development cross-validation, then reserve a genuinely new locked collection before deployment. Do not hide an inadequate test set behind image multiplication.

Augment training only; keep all crops, retakes and derivative photos of one sample in its group. Fit normalization/hyperparameters on training/selection data only. Quantization calibration uses training-derived representative data, never locked test. Confidence calibration uses separate calibration labels. Include a separate held-out phone/lot/session challenge even if ordinary random-group performance looks good.

Task T24 writes split manifest hashes and automated disjointness checks. Do not inspect locked-test labels repeatedly to tune thresholds; a changed model after failed testing needs a new evaluation policy and disclosure.

## Baselines and model choice

B0 human/manual kit interpretation with recorded uncertainty; B1 raw nearest-chart color; B2 normalized deterministic ordinal matcher; B3 kNN/linear model; B4 small MLP exported with standard ONNX ops. CNN quality head is optional prototype, not automatic complexity.

Metrics: per-bin confusion matrix, macro-F1, balanced accuracy, ordinal absolute-bin error, serious-direction undercalls, coverage/abstention, capture rejection by reason, calibration reliability/ECE/Brier where applicable, latency/model size/peak memory. Report by phone, lot, operator and light. For regression only after justified: units, MAE/RMSE, bias/agreement and reportable range; never use R² alone.

“Serious undercall” is defined by approved protocol: a reference result requiring review classified as no_flag. Uncertain/rejected outputs are not false reassurance but reduce coverage and must count in user workload. Show both conditional accuracy on accepted images and end-to-end outcomes including rejected captures.

## Provisional analytical gates — require domain signoff

For one declared kit/domain: macro-F1≥0.90, accepted coverage≥0.80, and review-required sensitivity≥0.95 on independently labeled samples, with per-domain results and95% uncertainty intervals. These are initial engineering goals, not a drinking-water standard. If a domain has inadequate independent examples, classify it unvalidated; do not pool it away.

Zero observed serious undercalls is desirable but is not proof of zero risk. Approximate “rule of three” reasoning: zero errors in60 independent relevant tests still permits about5% upper error bound;300 permits roughly1%. This rough binomial heuristic requires independent trials and is not a substitute for a domain-specific statistical design.

For pilot operational assistance, reviewer approves allowable error/coverage trade-off and reference method. If gates fail, keep automation in shadow/research mode and retain manual workflow while explicitly leaving REQ-005 incomplete. A deadline does not lower the scientific gate.

## Failure taxonomy

F01 invalid preparation/timing; F02 expired/different kit/lot; F03 glare/blur/occlusion; F04 unsupported phone/lighting; F05 coordinate/color conversion bug; F06 model overconfidence; F07 missing/incorrect lab label; F08 sync loss/duplication; F09 wrong-source/report linkage; F10 unauthorized closure; F11 misleading resident communication.

Capture representative failures as redacted fixtures. Generated images may test UI branches but never prove analytical performance.

## Verification commands: policy

No app package scripts exist yet. Commands such as npm test, pytest, Android build, browser E2E and load runner are **proposed**, not runnable project commands at planning time. T03/T05 establish exact locked setup and scripts and update current-state. Prefer existing repository tools when available; do not add three test frameworks for the same layer.

Suggested future mapping: TypeScript unit tests with the chosen workspace runner; Python pytest for API/ML; Android native tests for image/crypto bridges; Playwright for web; Android instrumentation or a selected mobile runner for device E2E; one load tool selected by C. Record actual commands and exit codes in handoffs.

