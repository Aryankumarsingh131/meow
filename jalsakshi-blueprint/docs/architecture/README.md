# Architecture index

Read [system design](system-design.md), then [data model](data-model.md) and [API contracts](api-contracts.md) before editing code. These are proposed contracts, not implemented behavior.

Boundary specifications added to close Phase 1 review gaps:
- [Authorization matrix](authorization-matrix.md): roles, persona mapping and the endpoint permission table.
- [Case state machine](case-state-machine.md): the legal state × command × role transitions and closure guards.
- [Protocol schema](protocol-schema.md): the shape of `protocols.bins` and `quality_policy`.

Decisions:
- [ADR-001: local-first modular monolith](decisions/ADR-001-local-first-modular-monolith.md).
- [ADR-002: protocol-bound local inference](decisions/ADR-002-protocol-bound-local-inference.md).
- [ADR-003: immutable evidence and controlled closure](decisions/ADR-003-immutable-evidence-and-controlled-closure.md).

Contract owner is teammate C. One editor at a time for schemas, migrations and generated API types. Changes require version/compatibility review.

