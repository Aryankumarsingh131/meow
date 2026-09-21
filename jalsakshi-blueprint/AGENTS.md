# Agent operating contract — JalSakshi

## Scope and minimum reading

This repository-ready package specifies a proposed product. **Do not implement the app unless the user requests implementation.** Documentation work does not authorize cloud purchases, external messages, production data access or deployment.

Every contributor reads:
1. [README](README.md).
2. [Current state](docs/agent-workflow/current-state.md).
3. [Requirements](docs/requirements.md).
4. [Implementation plan](implementation-plan.md) and selected [task card](to-do.md).
5. Relevant architecture/API/data/evaluation/security sections for the boundary being changed.

Follow [source-of-truth](docs/agent-workflow/source-of-truth.md) for authority and contradictions. Do not infer working features from slides, diagrams or unchecked plans.

## Non-negotiable domain rules

Screening is not laboratory confirmation or potability. No model-generated diagnosis/remediation. Unknown kit/domain/timing means uncertain/invalid/manual path, not fabricated precision. Preserve machine suggestion, human observation and lab result as separate provenance.

Saved means durable; synced metadata does not mean uploaded photo; uploaded report does not mean verified report; action completed does not mean case closed. No last-write-wins closure. No dropping pending records to make sync pass.

## Work selection and ownership

Coordinator assigns one task/branch or isolated worktree per contributor. Record task ID, owner, claimed time, files and dependencies in current-state. Do not edit a file claimed by another owner; agree interface changes first.

A owns mobile/web/product flows; B owns image/ML; C owns API/contracts/schema/migrations/security/releases. These are roles, not actual assigned names. One editor at a time for lockfiles, generated types, schemas, migrations and release config. Parallel work requires frozen contracts and a stated integration order.

Do not spawn extra agents or create new user-facing tasks unless authorized by applicable instructions/user request. Agent assistance is not permission to coordinate external people.

## Implementation conventions after authorization

Prefer existing patterns, stdlib/platform features and smallest tested change. TypeScript strict types; validated Python models; Kotlin/native error handling explicit. No premature service layer/factory/broker. Parameterized SQL and bounded inputs at trust boundaries. Typed discriminated states; no generic success booleans that collapse provenance.

Generated API types come from reviewed OpenAPI. Never edit generated client alone. Each migration has one owner, compatibility plan and test against old data. Pin compatible dependencies; security/native additions require license/provenance review. Secrets never committed or pasted into prompts.

Current actual app commands: **none**. T03/T05 must establish and record exact setup/build/test scripts; do not invent a passing npm/pytest result. Proposed commands in docs are intent until artifacts exist.

## Definition of done for every task

- Required behavior and negative/error states implemented without dropping scope.
- Smallest root-cause test/check passes; relevant integration/device/security checks also pass.
- Evidence records exact command or manual procedure, result, build/commit/device/dataset as relevant.
- Independent review for auth, crypto, sync ordering, state closure, data splits and release changes.
- Requirements/contracts/ADRs updated if intent changed; source citations or experiment attached to major technical change.
- Current-state, task checkbox and [handoff](docs/agent-workflow/handoff-template.md) updated with real evidence.
- No unresolved blocker hidden; no planned metric presented as measured.

Formatting/compile alone is not done. Mocked inference or synthetic lab data is not scientific validation. A feature fallback does not mark the original required feature complete.

## Blockers and instruction changes

New explicit user instructions can change intent; coordinator updates the authoritative requirement/ADR and traces affected tasks/tests. If code and docs disagree, record both and seek resolution rather than silently treating either as correct. Preserve existing user work; never reset/delete unrelated changes.

