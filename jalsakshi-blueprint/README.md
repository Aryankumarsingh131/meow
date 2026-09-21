# JalSakshi — research and execution blueprint

**Status: planning complete; application not implemented or validated.** Research cutoff: 21 September 2026 UTC. Prepared for three teammates using Astra and Fable as coding assistance; their exact capabilities and costs have not been assumed.

JalSakshi helps a community water screening result become an owned, traceable follow-up: **source → kit protocol → indicative result → laboratory referral → corrective action → retest → resident update**. It is not a potability detector or a replacement for laboratory testing.

## Start here

1. Read [project brief](docs/project-brief.md), [assumptions](docs/assumptions-and-open-questions.md) and [current state](docs/agent-workflow/current-state.md).
2. Review the [requirements and traceability](docs/requirements.md).
3. Use the [implementation plan](implementation-plan.md), then claim one task in [to-do.md](to-do.md).
4. Agents must follow [AGENTS.md](AGENTS.md). Do not build until the user authorizes implementation.

## Recommendation in one minute

Use an Android-first Expo/React Native app with SQLite, a native image-preprocessing module and a small locally executed ONNX model. Keep deterministic color matching as an explicit baseline and fallback, not pretend AI. Use one FastAPI service, PostgreSQL and a Next.js supervisor board. No LLM, vector database, microservices or paid inference API is needed inside the product.

The strongest potential differentiation is **protocol-specific, uncertainty-aware evidence-to-action**, not offline forms alone. Akvo Caddisfly, mWater and ODK are meaningful prior art. See the [competitor analysis](docs/research/competitive-analysis.md).

Validate the native build and one actual kit before polishing screens. A 30-hour demonstration is a checkpoint; scientific validation, security hardening and deployed-product verification remain scheduled requirements.

## Navigation

| Need | Authoritative artifact |
|---|---|
| What must exist | [Requirements](docs/requirements.md) |
| Why these methods | [Research review](docs/research/research-review.md) and [source register](docs/research/source-register.md) |
| What to build | [System design](docs/architecture/system-design.md), [data model](docs/architecture/data-model.md), [API contracts](docs/architecture/api-contracts.md) |
| What users see | [Journeys](docs/product/user-journeys.md), [UI specification](docs/product/ui-ux-specification.md) |
| How fast and at what quality | [Performance](docs/engineering/performance-plan.md), [evaluation](docs/engineering/testing-and-evaluation.md) |
| How to operate safely | [Security](docs/engineering/security-and-privacy.md), [deployment](docs/engineering/deployment-and-operations.md), [cost](docs/engineering/cost-and-capacity.md) |
| When it is done | [Acceptance](docs/delivery/acceptance-criteria.md), [demo](docs/delivery/demo-and-judging-plan.md), [risks](docs/delivery/risk-register.md) |
| How agents coordinate | [Source of truth](docs/agent-workflow/source-of-truth.md), [handoff](docs/agent-workflow/handoff-template.md) |

## Complete artifact tree

```text
README.md
AGENTS.md
implementation-plan.md
to-do.md
scripts/
  check-blueprint.ps1
docs/
  README.md
  project-brief.md
  requirements.md
  assumptions-and-open-questions.md
  research/
    README.md
    research-review.md
    source-register.md
    technology-evaluation.md
    competitive-analysis.md
    learning-path.md
  architecture/
    README.md
    system-design.md
    data-model.md
    api-contracts.md
    decisions/
      ADR-001-local-first-modular-monolith.md
      ADR-002-protocol-bound-local-inference.md
      ADR-003-immutable-evidence-and-controlled-closure.md
  product/
    README.md
    user-journeys.md
    ui-ux-specification.md
  engineering/
    performance-plan.md
    testing-and-evaluation.md
    security-and-privacy.md
    deployment-and-operations.md
    cost-and-capacity.md
  delivery/
    acceptance-criteria.md
    demo-and-judging-plan.md
    risk-register.md
    blueprint-validation.md
  agent-workflow/
    source-of-truth.md
    current-state.md
    handoff-template.md
```

All application paths mentioned in this package are **proposed**, not existing source files. All implementation checkboxes start unchecked. There are no project performance measurements or deployment claims.

The only executable file is a documentation checker, not app code. From this package root run `powershell -NoProfile -File scripts/check-blueprint.ps1`. See [validation results](docs/delivery/blueprint-validation.md).

## Immediate decisions

Choose the exact kit, analyte, lot and timing protocol; inventory the actual phone/laptops; confirm hackathon participation and pre-event work rules; obtain a willing supervisor/lab partner. See [open questions](docs/assumptions-and-open-questions.md). These gate different tasks, not the entire planning package.
