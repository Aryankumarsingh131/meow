# Requirements and traceability

This is the authoritative scope. Every row is retained through final delivery; early demo omissions are sequencing, not deletion. All are currently **planned**. Requirement IDs remain stable after edits. Acceptance IDs share the same numeric suffix; detailed checks are in [acceptance criteria](delivery/acceptance-criteria.md). Task definitions are in [to-do](../to-do.md).

| ID | Required capability | Component | Delivery milestone | Tasks | Test |
|---|---|---|---|---|---|
| REQ-001 | Identify a source by bounded QR identifier or searchable cached list; retain source history | Mobile/source catalog | M1 | T07 | AC-001 |
| REQ-002 | Record kit protocol, parameter, lot, expiry and prescribed read window | Protocol registry/mobile | M1 | T01 T08 | AC-002 |
| REQ-003 | Guided capture of strip and reference, with explicit region selection | Native image module/mobile | M1 | T04 T09 | AC-003 |
| REQ-004 | Deterministic quality checks, reasons and retake path | Native image module | M1 | T10 | AC-004 |
| REQ-005 | Locally executed, kit-specific ML with calibration and abstention | ML/ONNX/mobile | M3 | T25 T26 T27 | AC-005 |
| REQ-006 | Manual interpretation with provenance and no false model confidence | Mobile/sample API | M1 | T11 | AC-006 |
| REQ-007 | Durable offline capture, interrupted-session recovery and visible local receipt | SQLite/encrypted files | M1 | T12 | AC-007 |
| REQ-008 | Idempotent synchronization with conflicts, retry, pagination and recovery | Outbox/API/changefeed | M1 | T13 T14 T15 | AC-008 |
| REQ-009 | Screening-only interpretation and honest uncertainty | Policy/mobile/web | M1 | T01 T11 T46 | AC-009 |
| REQ-010 | Triage, lab referral, owner, due date and overdue visibility | Case API/board | M2 | T17 T18 | AC-010 |
| REQ-011 | Structured laboratory report attachment, verification and lineage | Lab API/private evidence | M2 | T19 T46 | AC-011 |
| REQ-012 | Corrective-action record with owner and completion evidence | Case events | M2 | T20 | AC-012 |
| REQ-013 | Linked retest, guarded closure, repeated-issue reopening | Case state machine | M2 | T21 T46 | AC-013 |
| REQ-014 | Resident update and approved understandable summary | Communication record/export | M2/M3 | T22 T44 | AC-014 |
| REQ-015 | Supervisor queue, source history, coverage/repeat/closure metrics and exports | Next.js/API/reporting | M2 | T18 T43 | AC-015 |
| REQ-016 | Local-language, accessible, responsive interface with recovery states | Mobile/web design system | M3 | T28 T44 T48 | AC-016 |
| REQ-017 | Role and tenant authorization, offline provisioning and lease policy | Auth/API/local session | M1/M4 | T06 T31 T45 T48 | AC-017 |
| REQ-018 | Privacy, secure local storage, controlled evidence upload and retention | Crypto/private objects/retention | M4/M5 | T16 T32 T47 T48 | AC-018 |
| REQ-019 | Versioned model/protocol/data lineage and leakage-safe evaluation | ML manifests/datasets | M3 | T23 T24 T25 T27 | AC-019 |
| REQ-020 | Measured responsive performance and bounded resource use | All components | M4 | T29 T30 | AC-020 |
| REQ-021 | Useful observability without sensitive logs | API/mobile/operations | M4 | T33 | AC-021 |
| REQ-022 | Repeatable deployment, migrations, backups, rollback and operational ownership | Infrastructure/release | M5 | T35 T36 T37 T39 T47 | AC-022 |
| REQ-023 | Versioned integration/export contracts with no invented official API | Contracts/export | M2 | T05 T43 | AC-023 |
| REQ-024 | Multiple kits/languages/sites through validated configuration and bounded scaling | Protocol registry/tenant config | M6 | T40 T41 | AC-024 |
| REQ-025 | Honest, reproducible competition demonstration and evidence | Demo harness/documentation | M5 | T34 | AC-025 |
| REQ-026 | Field learning, impact metrics and startup validation | Pilot/product | M5 | T02 T38 | AC-026 |
| REQ-027 | Automated regression coverage across critical risks | Tests/CI | M4 | T05 T24 T31 T34 T48 | AC-027 |
| REQ-028 | Maintainable artifact-based agent execution and independent review | Repository/workflow | M6 | T03 T42 | AC-028 |

## Original planning-request coverage

| User request section | Artifact delivering it |
|---|---|
| 1 Context; 2 principles; 3 baseline | [Brief](project-brief.md), [assumptions](assumptions-and-open-questions.md), this traceability |
| 4 Deep research and learning | [Review](research/research-review.md), [register](research/source-register.md), [learning](research/learning-path.md) |
| 5 Current innovations | [Technology evaluation](research/technology-evaluation.md) |
| 6 Product and competition | [Competition analysis](research/competitive-analysis.md), [demo](delivery/demo-and-judging-plan.md) |
| 7 Architecture and contracts | [System](architecture/system-design.md), [schema](architecture/data-model.md), [API](architecture/api-contracts.md), linked ADRs |
| 8 Performance | [Performance plan](engineering/performance-plan.md), [capacity](engineering/cost-and-capacity.md) |
| 9 UX | [Journeys](product/user-journeys.md), [UI](product/ui-ux-specification.md) |
| 10 Quality/security/deployment | [Evaluation](engineering/testing-and-evaluation.md), [security](engineering/security-and-privacy.md), [operations](engineering/deployment-and-operations.md) |
| 11 Actual files | [Root artifact tree](../README.md) |
| 12 Dependency-aware execution | [Plan](../implementation-plan.md), [task cards](../to-do.md), [acceptance](delivery/acceptance-criteria.md) |
| 13 Agent workflow | [AGENTS](../AGENTS.md), [authority](agent-workflow/source-of-truth.md), [state](agent-workflow/current-state.md), [handoff](agent-workflow/handoff-template.md) |
| 14 Final consistency | [Blueprint validation](delivery/blueprint-validation.md) |

## Not required by the original vision

LLM advice, autonomous remediation, a public resident social network, continuous video inference, nationwide integrations, automatic SMS/WhatsApp delivery, hardware sensors and automated laboratory instruments are not committed features. Proposed improvements are labeled E01–E06 in [competitive analysis](research/competitive-analysis.md). Broader sanitation/food-safety expansion remains a business hypothesis, not hidden implementation scope.
