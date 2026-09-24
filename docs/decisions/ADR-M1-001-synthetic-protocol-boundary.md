# ADR-M1-001 — M1 proceeds on an explicit synthetic-only protocol boundary

**Status:** Accepted — 2026-09-24
**Decided by:** project owner (explicit authorization in session, 2026-09-24)
**Scope:** Milestone M1 (T05–T15, T45) only.
**Supersedes:** nothing. **Superseded by:** the first real, signed kit protocol.

## Context

M1's entry condition is "native/protocol feasibility and frozen v1 schema".
An entry check on 2026-09-24 found:

- **Frozen v1 schema — met.** `contracts/openapi.json` and `contracts/client.ts`
  regenerate byte-identical; schema and contract suites pass.
- **Native feasibility — largely met.** The native build succeeds and the
  Kotlin feature leg matches the Python reference exactly on an Android 15
  emulator (`tests/capture-golden.json`, `native_leg`). Open: G0's "APK offline
  tensor" has never been run, and no physical device exists.
- **Protocol feasibility — NOT met.** G0 requires a *signed protocol decision*
  and a *domain review of timing/units*. Neither exists. T01 is a fictional
  template; no real kit, manufacturer, lot or read window has been selected.

The critical path runs through the protocol:
`T01 → T08 → T09 → T11 → T12 → T15 → T45`. Without a protocol that carries a
read window, the entire mobile half of M1 has no timing input.

`jalsakshi-blueprint/docs/delivery/acceptance-criteria.md` defines G0 as
requiring a "selected protocol **or explicit synthetic-only boundary**", and
M1's goal is "a worker records a real **or clearly synthetic** test". The
blueprint therefore anticipates exactly this situation.

## Decision

1. **SYN-COLOR-001 is adopted as M1's explicit synthetic-only protocol
   boundary.** Its canonical, machine-readable form is
   `protocols/SYN-COLOR-001.v1.json`, conforming to
   `jalsakshi-blueprint/docs/architecture/protocol-schema.md`.
2. **A clearly-labelled SYNTHETIC read window is added to it**:
   prepare 10 s, read at 30 s ± 15 s, invalid after 120 s.

## What the synthetic read window is — and is not

The values were **chosen by the agent**, not derived from any manufacturer
instruction, because SYN-COLOR-001 involves no chemical reaction at all — it is
a printed colour card. They exist solely so that T08's timer states
(`preparing → waiting → in_window → late → expired`) can be exercised end to
end at a pace a demo can use.

- They are **not** a read time for any kit.
- They must **never** be copied into a real protocol.
- `protocol-schema.md` line 8 ("No value in this system is invented") is
  honoured by *scoping*, not by pretending: the invention is disclosed here, in
  the protocol's own `manufacturer` / `kit` / `parameter` fields, and in
  `approved_by.role = synthetic_boundary_authorization_only`.

## What this decision does NOT do

- It is **not** a domain review. "Domain review of timing/units" remains an
  **open G0 gate**, recorded in `docs/agent-workflow/current-state.md`, and is
  never claimed as met.
- It is **not** a signed protocol decision for any real kit.
- It does **not** make any M1 output a water result. SYN-COLOR-001 "has no
  concentration, safety or potability meaning"
  (`synthetic-demo-protocol.md`).
- It does **not** close T01. T01 remains fictional and unchecked.
- `approved_by.actor` records "project owner" rather than a name or email
  address, because this repository is public.

## Consequences

- The whole of M1 can proceed, and its output is labelled **synthetic**
  throughout — never presented as validated real-world evidence.
- G0 is recorded as **satisfied only via the synthetic-boundary clause**, with
  "domain review of timing/units" and "APK offline tensor" named as open items.
- The moment a real kit is selected, this ADR is superseded. The real protocol
  **replaces** SYN-COLOR-001; it does not reinterpret it
  (`synthetic-demo-protocol.md`, final paragraph).

## Also recorded here: source of truth for state

The same session found two `current-state.md` files after the meow merge. The
project owner decided that **`docs/agent-workflow/current-state.md` at the
repository root is authoritative.** The copy under `jalsakshi-blueprint/` is a
historical record of the sibling `meow` repository and is marked as such.
