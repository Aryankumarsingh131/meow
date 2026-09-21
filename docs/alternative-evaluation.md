# Alternative evaluation and configure-versus-build — T02

> **STATUS: RECOMMENDATION ONLY — NOT AN APPROVED ARCHITECTURE CHANGE.**
> The competitor claims cited below are real (sourced from the existing
> blueprint research, not invented). The workflow "evidence" they are
> weighed against is the fictional walkthrough in `docs/pilot-interviews.md`,
> so the recommendation below is explicitly provisional, not evidence-based.
> No build-vs-configure decision is enacted by this document.

## Cross-check against competitor claims (verification step 1)

Source: `jalsakshi-blueprint/docs/research/competitive-analysis.md` and
`jalsakshi-blueprint/docs/research/source-register.md` (C01–C04), read
2026-09-22. Claims below are copied, not re-derived or extended:

| Alternative | Verified strength (per existing research) | What is not established (per existing research) |
|---|---|---|
| Akvo Caddisfly + Flow (C01) | Smartphone water testing, open Android repo | Current maintenance, our-kit support, local deployment quality |
| mWater (C02) | Offline collection, sources, assignments/issues, longitudinal data, portal sync | Kit-specific image quality + calibrated local inference support |
| ODK Collect/Central Entities (C03) | Linked longitudinal records, supported offline workflows | Ready-made kit interpretation/closure policy; version constraints |
| WQMIS (C04) | Official sample/mobile registration context | Full workflow coverage and public integration API not audited |

No claim in this document exceeds what those two files already assert. This
cross-check is the literal "review notes against competitor claims"
verification step required by T02 — run by direct comparison against the
existing research files rather than restated from memory.

## Configure-versus-build question

`competitive-analysis.md` already defines this gate: *"T02 gives one
teammate a time-boxed walkthrough of mWater/ODK documentation and, with user
authorization, a synthetic sandbox trial. If configuration covers the
workflow, a local capture companion/integration may be a stronger startup
than replacing the platform."*

That real walkthrough/sandbox trial has **not** been performed in this
session — no mWater or ODK account, sandbox, or documentation walkthrough
was actually done here. This document cannot honestly answer the
configure-versus-build question; it can only restate the gate and refuse to
guess.

## Recommendation

**No recommendation is made to switch platforms.** The available evidence
is insufficient on both sides:

- The fictional pilot-interview walkthrough (`docs/pilot-interviews.md`) is
  not real workflow evidence and cannot justify keeping the custom build.
- No real mWater/ODK sandbox trial has been performed and cannot justify
  switching to a configured alternative.

The honest output of this task, given the inputs actually available, is:
**the configure-versus-build question remains open**, gated on the same two
missing things `competitive-analysis.md` already names — a real workflow
observation and a real competitor sandbox trial.

## Architecture change status (verification step 2)

No architecture change is proposed or enacted by this document. If a future
task performs the real mWater/ODK trial and concludes configuration is
sufficient, that would be a genuine architecture revision requiring explicit
user approval before any implementation task acts on it — per
`competitive-analysis.md`'s own language: *"a user-approved architecture
revision, not a silent deletion of the requested product."*

## Open blockers (real, not fictional)

- No real worker/supervisor workflow has been observed.
- No real mWater/ODK sandbox trial has been performed.
- Buyer and lab-access remain unknown (see `docs/pilot-interviews.md`).
- T38 (real field learning) is the task that can actually supply the
  missing evidence on both sides.
