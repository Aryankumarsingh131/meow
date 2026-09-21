# Source of truth and coordination

## Authority table

| Question | Authority |
|---|---|
| What does the user want now? | Latest explicit user instruction, incorporated into requirements by coordinator |
| Committed scope / traceability | [Requirements](../requirements.md) |
| Why a decision was made | [ADRs](../architecture/README.md) and [research](../research/source-register.md) |
| Components / invariants | [System design](../architecture/system-design.md), [data model](../architecture/data-model.md) |
| Boundary behavior | [API contracts](../architecture/api-contracts.md) |
| What to do next | [Task cards](../../to-do.md), dependencies in [plan](../../implementation-plan.md) |
| What actually exists / works | [Current state](current-state.md) with linked test/deployment evidence |
| What counts as accepted | [Acceptance](../delivery/acceptance-criteria.md) and [evaluation](../engineering/testing-and-evaluation.md) |
| Working rules | [AGENTS](../../AGENTS.md) |

No source is allowed to overwrite explicit user intent silently. Tests establish observed behavior, not desired behavior. An implementation differing from specification is a discrepancy until resolved.

## Claim and integration protocol

Coordinator confirms prerequisites, owner and bounded file set; records claim in current-state. Contributor works in isolated branch/worktree if a real Git repository is established. Do not assume a Git repo exists or create/commit one without appropriate task scope.

Contract changes first → backend/types integration → dependent client → cross-boundary tests. C serializes schema, migration and lockfile changes. Merge only after focused checks and required review; preserve user changes.

Independent review benefits safety/auth/crypto/sync/data evaluation and release boundaries. Copy fixes, UI copy and isolated deterministic tests can use a single implementer plus normal review. The reviewer should inspect actual diff/evidence, not just trust an agent summary.

## Contradiction record

Record: observed code behavior; documented intent; affected REQ/AC/tasks; user impact; evidence; recommended resolution; owner. Do not resolve by weakening an acceptance test until it matches broken code. Update ADR when a substantive trade-off changes.

Scope additions E01–E06 require explicit selection before becoming requirements. Dates, prices and hardware assumptions are not immutable truth; reverify when executing.

## Documentation update rules

Change contracts and generated types together. Update research register only for material evidence changes, not every web visit. Keep benchmark numbers only in benchmark reports with conditions, linked from current-state. Task cards store status/evidence reference, not duplicate architecture. Current-state stays short; detailed handoffs carry history.

## Starter prompts

**Coordinator:** “Read AGENTS.md, docs/agent-workflow/current-state.md, docs/requirements.md and implementation-plan.md. Check actual files and user authorization. Identify ready tasks from to-do.md, resolve blockers and assign nonoverlapping file ownership. Do not begin app implementation unless authorized.”

**Implementer:** “Read AGENTS.md and the authoritative artifacts linked from task [TASK-ID] in to-do.md. Claim only that task's bounded scope. Implement the smallest correct slice, test success and failure paths, record actual commands/evidence and hand off. Do not change requirements to make tests pass.”

**Reviewer:** “Read AGENTS.md, task [TASK-ID], its contracts and acceptance checks. Review actual changed files and evidence independently, prioritizing water-safety wording, data loss, tenant boundaries and provenance. Report reproducible findings; do not implement unrelated fixes.”

**Tester:** “Read current-state.md and testing-and-evaluation.md. Verify task [TASK-ID] on the declared build/device/dataset, including listed negative cases. Separate tests run from blocked/not-run checks; save exact results. Never count synthetic data as analytical validation.”

