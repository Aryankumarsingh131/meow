# ADR-001 — Local-first field client, modular monolith server

Status: proposed; 21 September 2026 UTC. Owner C. Related REQ-007/008/017/020/022.

Context: field connectivity is unreliable, but supervisors require shared authoritative evidence. Team has three people, not an operations department.

Decision: native Android local persistence, one versioned API, PostgreSQL, private objects, one supervisor web app. Durable device outbox and server transactions implement synchronization; jobs share the server codebase.

Alternatives: browser-only app risks storage/camera constraints; configuring mWater/ODK could reduce custom work and must be evaluated before commercial commitment; microservices and a message broker add unnecessary coordination.

Consequences: explicit sync conflict handling and native build work; no guarantee of closed-app immediate delivery. Per-tenant commit ordering serializes writes briefly; measure contention.

Evidence: D01–D05, C02/C03 and R16 in [source register](../../research/source-register.md). Validation: T03/T12/T14/T15/T30. Revisit when actual device support fails or hot-tenant lock waits exceed budgets under the declared workload. Do not change platform silently.

