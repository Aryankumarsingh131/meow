# Release evidence index (T42 draft)

Date 2026-09-25, commit after `3f937ec`. Status marks are those in
`jalsakshi-blueprint/to-do.md`: `[x]` done, `[~]` built but a named item is
outstanding, `[!]` blocked, `[ ]` not started.

**T42 itself is `[!]`:** its acceptance requires a *fresh* reviewer's
walkthrough, and every requirement below to link to *passing* evidence. Most
do not yet (see the right-hand column). This index is the reviewer's starting point.

| REQ | Requirement (short) | Tasks | Evidence | Gap |
|---|---|---|---|---|
| 001 | Source by QR or cached list | T07[~] | handoff-T07.md | independent review |
| 002 | Kit protocol, lot, read window | T01[!] T08[!] | handoff-T01/T08.md | no real kit |
| 003 | Guided capture | T04[!] T09[!] | handoff-T04/T09.md | no physical device |
| 004 | Quality checks and retake | T10[x] | handoff-T10.md | none |
| 005 | Local ML, calibration, abstention | T25–T27[~] | handoff-T25–T27.md; T37 kill switch (docs/compatibility-evidence.md) | synthetic data only |
| 006 | Manual interpretation, provenance | T11[x] | handoff-T11.md | none |
| 007 | Durable offline capture, recovery | T12[~] | handoff-T12.md; docs/privacy-checks.md (T32) | encryption at rest |
| 008 | Idempotent sync | T13–T15[~] | handoff-T13–T15.md; rollback replay (tests/e2e/rollback_rehearsal.py) | independent review |
| 009 | Screening-only, honest uncertainty | T01[!] T11[x] T46[!] | handoff-T11/T46.md | domain sign-off |
| 010 | Triage, referral, overdue | T17[~] T18[~] | handoff-T17/T18.md | supervisor web app separate |
| 011 | Lab report and verification | T19[~] T46[!] | handoff-T19.md | domain sign-off |
| 012 | Corrective action evidence | T20[~] | handoff-T20.md | review |
| 013 | Retest, guarded closure | T21[~] T46[!] | handoff-T21.md; tests/security/state_test.py | domain sign-off |
| 014 | Resident update | T22[~] T44[ ] | handoff-T22.md | resident wording unreviewed |
| 015 | Supervisor queue and metrics | T18[~] T43[~] | handoff-T43.md | reports UI in web app |
| 016 | Local language, accessibility | T28[ ] T44[ ] T48[!] | docs/final-review.md (a11y fixes) | Hindi, TalkBack pass |
| 017 | Tenant/role auth, offline lease | T06[!] T31[!] T45[~] T48[!] | tests/security/tenant_test.py; docs/security-review.md | **F1: RLS off, owner role** |
| 018 | Privacy, storage, retention | T16[~] T32[!] T47[~] T48[!] | docs/privacy-checks.md; docs/deletion-evidence.md | phone encryption; photo store |
| 019 | Model lineage, leakage-safe eval | T23[!] T24–T27[~] | handoff-T23–T27.md | real data |
| 020 | Performance | T29[!] T30[~] | ml/reports/device-performance.md; docs/benchmarks/server.md | physical phone; Postgres load |
| 021 | Observability | T33[~] | tests/telemetry_test.py; docs/alert-runbook.md | alerts not wired to paging |
| 022 | Deploy, migrate, backup, rollback | T35[~] T36[~] T37[~] T39[!] T47[~] | .github/workflows/ci.yml (green); docs/restore-evidence.md; docs/compatibility-evidence.md | photo backup; scheduled dump; production |
| 023 | Versioned contracts | T05[x] T43[~] | handoff-T05.md; tests/contracts.test.ts | none for T05 |
| 024 | Multiple kits/sites, capacity | T40[!] T41[~] | docs/second-kit-validation.md; docs/scale-decision.md | second kit; Postgres load |
| 025 | Honest demo evidence | T34[~] | docs/demo-evidence.md; tests/e2e/field-case.spec.ts | physical-phone journeys |
| 026 | Field learning | T02[!] T38[!] | docs/pilot-protocol.md | no pilot |
| 027 | Regression coverage | T05[x] T24[~] T31[!] T34[~] T48[!] | docs/release-test-matrix.md; CI | independent review |
| 028 | Agent execution and review | T03[!] T42[!] | this file; docs/agent-workflow/ | fresh reviewer |

## How a fresh agent resumes

1. Read `docs/agent-workflow/current-state.md` ("Next exact action").
2. Run the release matrix (docs/release-test-matrix.md): the three CI jobs
   locally, plus `python tests/e2e/staging_smoke.py` with smoke credentials.
3. Pick the first unblocked `[~]` item; `[!]` items need the named human input.
