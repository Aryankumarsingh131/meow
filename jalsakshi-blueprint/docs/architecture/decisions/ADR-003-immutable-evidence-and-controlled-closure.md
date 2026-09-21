# ADR-003 — Immutable evidence and controlled case closure

Status: proposed. Owner C. Related REQ-008/010–REQ-015/018/023.

Decision: accepted samples and case events are append-only; corrections supersede. Case transitions use expected version and server-enforced role/evidence checks. Metadata sync and optional photo sync have separate status.

Alternatives: editable spreadsheet-style rows obscure provenance; last-write-wins can hide conflicting closure; automatic closure from a reassuring image is scientifically unjustified. General CRDT merging is unnecessary.

Consequences: conflicts need a human resolution UI; retained audit metadata must follow an approved privacy/retention policy. Hashes prove integrity of bytes, not physical truth. No-upload demo preserves local images; remote reviewers see “image not shared,” not invented evidence.

Evidence: official screening/confirmation boundary S01; engineering inference about consistency, plus D09/D10. [Register](../../research/source-register.md). Validation: T14/T16/T19/T21/T31/T32. Revisit retention/access policy with a real operator, never weaken evidence prerequisites merely to make a demo pass.

