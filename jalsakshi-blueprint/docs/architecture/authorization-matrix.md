# Roles and authorization matrix — v1

Resolves the role contradiction recorded in the Phase 1 review: [project brief](../project-brief.md) named four personas, [data model](data-model.md) defined four enum roles and assumption A06 said "three user roles plus admin". This document is authoritative for role names and permissions. Owner: C.

## Role enum — v1 fixed

`memberships.role` is exactly one of: `worker`, `supervisor`, `lab_reviewer`, `admin`.

## Persona → role mapping

| Persona (brief) | Role | Note |
|---|---|---|
| Trained volunteer / Pani Samiti worker | `worker` | Field capture only |
| Lab/block supervisor | `supervisor` | Triage, referral, closure |
| Laboratory report reviewer | `lab_reviewer` | Verifies reports; cannot close cases |
| Program/campus water operator | **not a role** | An *assignment*, not an identity. Any member can be a case `owner_id` or action `owner_id` |
| Program owner (J06 reports view) | `supervisor` or `admin` | Reporting is a supervisor permission |
| Resident | **not a user** | No account, no login. Receives operator-recorded communication only |

**Rationale for not adding an `operator` role:** corrective-action ownership is already modelled as `cases.owner_id` / `actions.owner_id`. Adding a fifth role to express "the person doing the work" duplicates assignment as identity and doubles the permission matrix for no new capability. Revisit only if a real deployment needs an actor who may complete actions but may not capture samples.

**`memberships.scopes` is removed from v1.** It was declared but never defined and no requirement consumes it. Tenant membership plus role is the whole authorization input. Site-level narrowing, if ever needed, becomes a separate explicit design with its own tests — not an untyped JSON column.

## Permission matrix

`M` = any active member of the tenant. `—` = denied (404 where the ID would otherwise be enumerable, else 403).

| Endpoint | worker | supervisor | lab_reviewer | admin |
|---|:--:|:--:|:--:|:--:|
| GET /health/live | public | public | public | public |
| GET /health/ready | — | — | — | ✓ |
| POST /v1/session/offline-grant | ✓ | ✓ | ✓ | ✓ |
| GET /v1/bootstrap | ✓ | ✓ | ✓ | ✓ |
| GET /v1/sources | ✓ | ✓ | ✓ | ✓ |
| GET /v1/sources/{id}/history | ✓ | ✓ | ✓ | ✓ |
| POST /v1/sync/push | ✓ | ✓ | — | — |
| GET /v1/sync/pull | ✓ | ✓ | ✓ | ✓ |
| GET /v1/samples/{id} | ✓ | ✓ | ✓ | ✓ |
| GET /v1/cases | — | ✓ | ✓ | ✓ |
| GET /v1/cases/{id} | — | ✓ | ✓ | ✓ |
| POST /v1/cases/{id}/commands | — | per command | per command | per command |
| POST /v1/lab-reports | — | ✓ | ✓ | ✓ |
| POST /v1/lab-reports/{id}/verify | — | — | ✓ | ✓ |
| POST /v1/evidence/intents | ✓ | ✓ | ✓ | ✓ |
| POST /v1/evidence/{id}/complete | ✓ | ✓ | ✓ | ✓ |
| GET /v1/evidence/{id}/access | own captures | ✓ | ✓ | ✓ |
| POST /v1/exports | — | ✓ | — | ✓ |
| GET /v1/jobs/{id} | creator | creator | creator | ✓ |
| POST /v1/jobs/{id}/cancel | creator | creator | creator | ✓ |
| GET /v1/metrics | — | ✓ | — | ✓ |
| Admin plane (`/v1/admin/*`) | — | — | — | ✓ |

Per-command role rules are in [case state machine](case-state-machine.md). Command-level denial is checked *after* tenant membership and *before* version conflict, so an unauthorized actor never learns a case's current version.

**`lab_reviewer` cannot close a case.** Verification and disposition are deliberately separated so that the person attesting to a laboratory result is not the same person declaring the operational problem resolved. `supervisor` cannot self-verify their own uploaded report either; see [case state machine](case-state-machine.md) guard G-VERIFY-SEP.

**`admin` is a tenant administrator, not a superuser.** Admin is still tenant-scoped, is still subject to row-level security, and still cannot verify a report they uploaded. There is no cross-tenant role in v1; cross-tenant operations require direct database access under the operations runbook, which is audited separately.

## Enforcement points

1. **Transport** — authenticated OIDC session resolves `user_id`. Tenant is resolved from the membership lookup, never from a request field.
2. **Endpoint** — role check from this matrix, as a declarative dependency, not an inline `if` per handler.
3. **Object** — every query filters on `tenant_id` from session context. Nested resources re-check.
4. **Database** — PostgreSQL RLS with a non-owner application role as defence in depth (D09). RLS is a backstop for an application bug, not the primary control.

Tests for this matrix are T31's responsibility: every cell marked `—` requires a passing negative test with a real second tenant and a real second user.
